import fs from 'fs';
import { getMp4MetaData, getMp3Duration } from '../get_media_metadata.js';
import * as misc from '../misc.js';
import * as t from '../../lib/types.js';
import assert from '../../lib/assert.js';
import { Session } from './session.js';
import _ from 'lodash';
import { v4 as uuid } from 'uuid';
import {
  calcClockAfterMerge,
  calcClockAfterRangeSpeedChange,
  getClockRangeDur,
  insertIntoArray,
  unreachable,
} from '../../lib/lib.js';
import { URI } from 'vscode-uri';
import * as path from 'path';
import cache from '../cache.js';

type TimelineRange = {
  eventIndex: number;
  focusIndex: number;
  tocIndex: number;
  events: t.EditorEventWithUri[];
  focusTimeline: t.Focus[];
  toc: t.TocItem[];
};

const SAVE_TIMEOUT_MS = 5_000;

export default class SessionEditor {
  dirty = false;

  private undoHistory: t.Cmd[][] = [];
  // The index of the last Cmd group whose effects are visible.
  private undoIndex: number = -1;

  constructor(public session: Session) {}

  get canUndo(): boolean {
    return this.undoIndex > -1;
  }

  get canRedo(): boolean {
    return this.undoIndex < this.undoHistory.length - 1;
  }

  get curUndoHistoryGroup(): t.Cmd[] | undefined {
    return this.undoHistory[this.undoIndex];
  }

  undoHistoryPop(): t.Cmd[] {
    return this.canUndo ? this.undoHistory[this.undoIndex--] : [];
  }

  undoHistoryForward(): t.Cmd[] {
    return this.canRedo ? this.undoHistory[++this.undoIndex] : [];
  }

  /**
   * Will not add to undo list.
   */
  insertInitialEvents(events: t.EditorEventWithUri[]) {
    assert(this.session.isLoaded());
    this.session.body.eventContainer.insertMany(events);
    this.changed();
  }

  createInsertEvent(e: t.EditorEvent, uri: string, opts: { coalescing: boolean }): t.InsertEventCmd {
    assert(this.session.isLoaded());
    const i = this.session.body.eventContainer.getIndexAfterClock(e.clock);
    return this.insertCmd({ type: 'insertEvent', index: i, uri, event: e }, opts);
  }

  applyInsertEvent(cmd: t.InsertEventCmd) {
    assert(this.session.isLoaded());
    this.session.body.eventContainer.insert(cmd.uri, cmd.event);
    this.changed();
  }

  unapplyInsertEvent(cmd: t.InsertEventCmd) {
    assert(this.session.isLoaded());
    this.session.body.eventContainer.deleteAt(cmd.index);
    this.changed();
  }

  /**
   * Must not update clock of event.
   */
  createUpdateTrackLastEvent<T extends t.EditorEvent>(
    uri: string,
    update: Partial<T>,
  ): t.UpdateTrackLastEventCmd | undefined {
    assert(this.session.isLoaded());
    assert(!('clock' in update));
    const track = this.session.body.eventContainer.getTrack(uri);
    const lastEvent = track?.at(-1);
    assert(lastEvent);

    if (_.isEqual({ ...lastEvent, ...update }, lastEvent)) return;

    const revUpdate = _.pick(lastEvent, _.keys(update));
    return this.insertCmd({ type: 'updateTrackLastEvent', uri, update, revUpdate }, { coalescing: true });
  }

  applyUpdateTrackLastEvent(cmd: t.UpdateTrackLastEventCmd) {
    assert(this.session.isLoaded());
    const track = this.session.body.eventContainer.getTrack(cmd.uri);
    const e = track?.at(-1);
    assert(track && e);
    const newEvent = Object.assign({}, e, cmd.update);
    this.session.body.eventContainer.replaceInTrackAt(cmd.uri, newEvent, track.length - 1);
    this.changed();
  }

  unapplyUpdateTrackLastEvent(cmd: t.UpdateTrackLastEventCmd) {
    assert(this.session.isLoaded());
    const track = this.session.body.eventContainer.getTrack(cmd.uri);
    const e = track?.at(-1);
    assert(track && e);
    const newEvent = Object.assign({}, e, cmd.revUpdate);
    this.session.body.eventContainer.replaceInTrackAt(cmd.uri, newEvent, track.length - 1);
    this.changed();
  }

  createSetFocus(focus: t.Focus, isDocumentEmpty: boolean): t.UpdateLastFocusCmd | t.InsertFocusCmd | undefined {
    assert(this.session.isLoaded());
    const lastFocus = this.session.body.focusTimeline.at(-1);

    // Try to update the last one. Otherwise, insert a new focus.
    if (
      lastFocus &&
      (focus.clock - lastFocus.clock < 1 || (lastFocus.uri === focus.uri && lastFocus.number === focus.number))
    ) {
      // In the last moment before closing an untitled document, we empty its content to avoid
      // the saving confirmation dialog. This must not affect the focus.
      if (isDocumentEmpty && URI.parse(focus.uri).scheme === 'untitled') return;

      const keys: Array<keyof t.Focus> = ['uri', 'number', 'text'];
      const keyDiffs = keys.filter(k => focus[k] !== lastFocus[k]);
      if (keyDiffs.length > 0) {
        const update = _.pick(focus, keyDiffs);
        const revUpdate = _.pick(lastFocus, keyDiffs);
        return this.insertCmd({ type: 'updateLastFocus', update, revUpdate }, { coalescing: true });
      }
    } else {
      return this.insertCmd({ type: 'insertFocus', focus }, { coalescing: true });
    }
  }

  applySetFocus(cmd: t.UpdateLastFocusCmd | t.InsertFocusCmd) {
    switch (cmd.type) {
      case 'updateLastFocus':
        return this.applyUpdateLastFocus(cmd);
      case 'insertFocus':
        return this.applyInsertFocus(cmd);
      default:
        unreachable(cmd);
    }
  }

  unapplySetFocus(cmd: t.UpdateLastFocusCmd | t.InsertFocusCmd) {
    switch (cmd.type) {
      case 'updateLastFocus':
        return this.unapplyUpdateLastFocus(cmd);
      case 'insertFocus':
        return this.unapplyInsertFocus(cmd);
      default:
        unreachable(cmd);
    }
  }

  applyInsertFocus(cmd: t.InsertFocusCmd) {
    assert(this.session.isLoaded());
    this.session.body.focusTimeline.push(cmd.focus);
    this.changed();
  }

  unapplyInsertFocus(_cmd: t.InsertFocusCmd) {
    assert(this.session.isLoaded());
    this.session.body.focusTimeline.pop();
    this.changed();
  }

  applyUpdateLastFocus(cmd: t.UpdateLastFocusCmd) {
    assert(this.session.isLoaded());
    const { focusTimeline } = this.session.body;
    assert(focusTimeline.length > 0);
    focusTimeline[focusTimeline.length - 1] = Object.assign({}, focusTimeline.at(-1)!, cmd.update);
    this.changed();
  }

  unapplyUpdateLastFocus(cmd: t.UpdateLastFocusCmd) {
    assert(this.session.isLoaded());
    const { focusTimeline } = this.session.body;
    assert(focusTimeline.length > 0);
    focusTimeline[focusTimeline.length - 1] = Object.assign({}, focusTimeline.at(-1)!, cmd.revUpdate);
    this.changed();
  }

  async createInsertAudioTrack(uri: string, clock: number): Promise<t.InsertAudioTrackCmd> {
    assert(this.session.isLoaded());
    const fsPath = URI.parse(uri).fsPath;
    const data = await fs.promises.readFile(fsPath);
    const duration = getMp3Duration(data);
    const sha1 = await misc.computeSHA1(data);
    await this.session.core.copyToBlob(fsPath, sha1);
    const audioTrack: t.AudioTrack = {
      id: uuid(),
      type: 'audio',
      clockRange: { start: clock, end: clock + duration },
      file: { type: 'local', sha1: sha1 },
      title: path.basename(fsPath),
    };

    return this.insertCmd({
      type: 'insertAudioTrack',
      index: this.session.body.audioTracks.length,
      audioTrack,
      sessionDuration: Math.max(this.session.head.duration, audioTrack.clockRange.end),
      revSessionDuration: this.session.head.duration,
    });
  }

  applyInsertAudioTrack(cmd: t.InsertAudioTrackCmd) {
    assert(this.session.isLoaded());
    assert(cmd.index <= this.session.body.audioTracks.length);
    this.session.body.audioTracks.splice(cmd.index, 0, cmd.audioTrack);
    this.session.head.duration = cmd.sessionDuration;
    this.changed();
  }

  unapplyInsertAudioTrack(cmd: t.InsertAudioTrackCmd) {
    assert(this.session.isLoaded());
    assert(cmd.index <= this.session.body.audioTracks.length);
    this.session.body.audioTracks.splice(cmd.index, 1);
    this.session.head.duration = cmd.sessionDuration;
    this.changed();
  }

  createDeleteAudioTrack(id: string): t.DeleteAudioTrackCmd {
    assert(this.session.isLoaded());
    const index = this.session.body.audioTracks.findIndex(t => t.id === id);
    assert(index !== -1);
    return this.insertCmd({ type: 'deleteAudioTrack', index, audioTrack: this.session.body.audioTracks[index] });
  }

  applyDeleteAudioTrack(cmd: t.DeleteAudioTrackCmd) {
    assert(this.session.isLoaded());
    assert(cmd.index < this.session.body.audioTracks.length);
    this.session.body.audioTracks.splice(cmd.index, 1);
    this.changed();
  }

  unapplyDeleteAudioTrack(cmd: t.DeleteAudioTrackCmd) {
    assert(this.session.isLoaded());
    assert(cmd.index <= this.session.body.audioTracks.length);
    this.session.body.audioTracks.splice(cmd.index, 0, cmd.audioTrack);
    this.changed();
  }

  createUpdateAudioTrack(update: Partial<t.AudioTrack>): t.UpdateAudioTrackCmd | undefined {
    assert(this.session.isLoaded());
    assert(update.id);
    const id = update.id;
    const audioTrack = this.session.body.audioTracks.find(t => t.id === id);
    assert(audioTrack);
    const keys = ['clockRange', 'title'] as const;
    const keyDiffs = keys.filter(k => k in update && update[k] !== audioTrack[k]);
    if (keyDiffs.length > 0) {
      update = _.pick(update, keyDiffs);
      const revUpdate = _.pick(audioTrack, keyDiffs);
      // const coalescing = this.curUndoHistoryGroup?.at(-1)?.type === 'updateAudioTrack';
      return this.insertCmd({ type: 'updateAudioTrack', id, update, revUpdate });
    }
  }

  applyUpdateAudioTrack(cmd: t.UpdateAudioTrackCmd) {
    assert(this.session.isLoaded());
    const { audioTracks } = this.session.body;
    const i = audioTracks.findIndex(t => t.id === cmd.id);
    assert(i !== -1);
    audioTracks[i] = Object.assign({}, audioTracks[i], cmd.update);
    this.changed();
  }

  unapplyUpdateAudioTrack(cmd: t.UpdateAudioTrackCmd) {
    assert(this.session.isLoaded());
    const { audioTracks } = this.session.body;
    const i = audioTracks.findIndex(t => t.id === cmd.id);
    assert(i !== -1);
    audioTracks[i] = Object.assign({}, audioTracks[i], cmd.revUpdate);
    this.changed();
  }

  async createInsertVideoTrack(uri: string, clock: number): Promise<t.InsertVideoTrackCmd> {
    assert(this.session.isLoaded());
    const fsPath = URI.parse(uri).fsPath;
    const data = await fs.promises.readFile(fsPath);
    const metadata = await getMp4MetaData(data);

    // Supported video codec example (h264): 'avc1.64001f'
    // Supported audio codec example (mp3): 'mp4a.6b'
    // Unsupported video codec example (h265): 'hev1.1.6.L90.90'
    // Unsupported audio codec example (aac): 'mp4a.40.2'
    if (metadata.videoTracks.some((t: any) => !t.codec.startsWith('avc1'))) {
      throw new Error(
        `Unsupported video codec. Please use H264 + MP3 codecs. Try: ffmpeg -i input.mp4 -c:v libx264 -c:a libmp3lame output.mp4`,
      );
    }
    if (metadata.audioTracks.some((t: any) => !t.codec.startsWith('mp4a.6b'))) {
      throw new Error(
        `Unsupported audio codec. Please use H264 + MP3 codecs. Try: ffmpeg -i input.mp4 -c:v libx264 -c:a libmp3lame output.mp4`,
      );
    }

    const duration = metadata.duration / metadata.timescale;
    const sha1 = await misc.computeSHA1(data);
    await this.session.core.copyToBlob(fsPath, sha1);
    const videoTrack: t.VideoTrack = {
      id: uuid(),
      type: 'video',
      clockRange: { start: clock, end: clock + duration },
      file: { type: 'local', sha1: sha1 },
      title: path.basename(fsPath),
    };
    return this.insertCmd({
      type: 'insertVideoTrack',
      index: this.session.body.videoTracks.length,
      videoTrack,
      sessionDuration: Math.max(this.session.head.duration, videoTrack.clockRange.end),
      revSessionDuration: this.session.head.duration,
    });
  }

  applyInsertVideoTrack(cmd: t.InsertVideoTrackCmd) {
    assert(this.session.isLoaded());
    assert(cmd.index <= this.session.body.videoTracks.length);
    this.session.body.videoTracks.splice(cmd.index, 0, cmd.videoTrack);
    this.session.head.duration = cmd.sessionDuration;
    this.changed();
  }

  unapplyInsertVideoTrack(cmd: t.InsertVideoTrackCmd) {
    assert(this.session.isLoaded());
    assert(cmd.index <= this.session.body.videoTracks.length);
    this.session.body.videoTracks.splice(cmd.index, 1);
    this.session.head.duration = cmd.sessionDuration;
    this.changed();
  }

  createDeleteVideoTrack(id: string): t.DeleteVideoTrackCmd {
    assert(this.session.isLoaded());
    const index = this.session.body.videoTracks.findIndex(t => t.id === id);
    assert(index !== -1);
    return this.insertCmd({ type: 'deleteVideoTrack', index, videoTrack: this.session.body.videoTracks[index] });
  }

  applyDeleteVideoTrack(cmd: t.DeleteVideoTrackCmd) {
    assert(this.session.isLoaded());
    assert(cmd.index < this.session.body.videoTracks.length);
    this.session.body.videoTracks.splice(cmd.index, 1);
    this.changed();
  }

  unapplyDeleteVideoTrack(cmd: t.DeleteVideoTrackCmd) {
    assert(this.session.isLoaded());
    assert(cmd.index <= this.session.body.videoTracks.length);
    this.session.body.videoTracks.splice(cmd.index, 0, cmd.videoTrack);
    this.changed();
  }

  createUpdateVideoTrack(update: Partial<t.VideoTrack>): t.UpdateVideoTrackCmd | undefined {
    assert(this.session.isLoaded());
    assert(update.id);
    const id = update.id;
    const videoTrack = this.session.body.videoTracks.find(t => t.id === id);
    assert(videoTrack);
    const keys = ['clockRange', 'title'] as const;
    const keyDiffs = keys.filter(k => k in update && update[k] !== videoTrack[k]);
    if (keyDiffs.length > 0) {
      update = _.pick(update, keyDiffs);
      const revUpdate = _.pick(videoTrack, keyDiffs);
      // const coalescing = this.curUndoHistoryGroup?.at(-1)?.type === 'updateVideoTrack';
      return this.insertCmd({ type: 'updateVideoTrack', id, update, revUpdate });
    }
  }

  applyUpdateVideoTrack(cmd: t.UpdateVideoTrackCmd) {
    assert(this.session.isLoaded());
    const { videoTracks } = this.session.body;
    const i = videoTracks.findIndex(t => t.id === cmd.id);
    assert(i !== -1);
    videoTracks[i] = Object.assign({}, videoTracks[i], cmd.update);
    this.changed();
  }

  unapplyUpdateVideoTrack(cmd: t.UpdateVideoTrackCmd) {
    assert(this.session.isLoaded());
    const { videoTracks } = this.session.body;
    const i = videoTracks.findIndex(t => t.id === cmd.id);
    assert(i !== -1);
    videoTracks[i] = Object.assign({}, videoTracks[i], cmd.revUpdate);
    this.changed();
  }

  updateHead(partial: Partial<t.SessionHead>) {
    Object.assign(this.session.head, partial);
    this.changed();
  }

  updateDetails(update: t.SessionDetailsUpdate) {
    if (update.workspace !== undefined) this.session.workspace = update.workspace;
    if (update.title !== undefined) this.session.head.title = update.title;
    if (update.description !== undefined) this.session.head.description = update.description;
    if (update.handle !== undefined) this.session.head.handle = update.handle;
    if (update.ignorePatterns !== undefined) this.session.head.ignorePatterns = update.ignorePatterns;

    this.changed();
  }

  updateDuration(duration: number, opts?: { coalescing?: boolean }): t.UpdateDurationCmd {
    // const coalescing = opts?.coalescing || this.curUndoHistoryGroup?.at(-1)?.type === 'updateDuration';
    const cmd: t.UpdateDurationCmd = {
      type: 'updateDuration',
      duration,
      revDuration: this.session.head.duration,
    };
    this.applyUpdateDuration(cmd);
    return this.insertCmd(cmd, opts);
  }

  applyUpdateDuration(cmd: t.UpdateDurationCmd) {
    this.session.head.duration = cmd.duration;
    this.changed();
  }

  unapplyUpdateDuration(cmd: t.UpdateDurationCmd) {
    this.session.head.duration = cmd.revDuration;
    this.changed();
  }

  async setCover(uri: string) {
    // Copy file and set head.
    await fs.promises.copyFile(URI.parse(uri).fsPath, path.join(this.session.core.dataPath, 'cover'));
    this.session.head.hasCover = true;

    // Update cover cache.
    await cache.copyCover(this.session.core.dataPath, this.session.head.id);

    this.changed();
  }

  async deleteCover() {
    await fs.promises.rm(path.join(this.session.core.dataPath, 'cover'), { force: true });
    await cache.deleteCover(this.session.head.id);
    this.session.head.hasCover = false;
    this.changed();
  }

  createChangeSpeed(range: t.ClockRange, factor: number): t.ChangeSpeedCmd {
    assert(this.session.isLoaded());
    const timeline = this.collectTimelineRange(range);
    return this.insertCmd({
      type: 'changeSpeed',
      range,
      factor,
      revRrClock: this.session.rr.clock,
      firstEventIndex: timeline.eventIndex,
      firstFocusIndex: timeline.focusIndex,
      firstTocIndex: timeline.tocIndex,
      revEventClocks: timeline.events.map(e => e.event.clock),
      revFocusClocks: timeline.focusTimeline.map(f => f.clock),
      revTocClocks: timeline.toc.map(x => x.clock),
    });
  }

  applyChangeSpeed(cmd: t.ChangeSpeedCmd) {
    assert(this.session.isLoaded());
    const { head, body } = this.session;

    // Update events.
    body.eventContainer.forEachExc(cmd.firstEventIndex, body.eventContainer.getSize(), (e, _i, replace) =>
      replace({ ...e.event, clock: calcClockAfterRangeSpeedChange(e.event.clock, cmd.range, cmd.factor) }),
    );

    // Reindex the event container.
    body.eventContainer.reindexStableOrder();

    // Update focus timeline.
    for (const [i, f] of body.focusTimeline.slice(cmd.firstFocusIndex).entries()) {
      body.focusTimeline[i + cmd.firstFocusIndex] = {
        ...f,
        clock: calcClockAfterRangeSpeedChange(f.clock, cmd.range, cmd.factor),
      };
    }

    // Update toc.
    for (const [i, x] of head.toc.slice(cmd.firstTocIndex).entries()) {
      head.toc[i + cmd.firstTocIndex] = { ...x, clock: calcClockAfterRangeSpeedChange(x.clock, cmd.range, cmd.factor) };
    }

    // Update session duration.
    head.duration = calcClockAfterRangeSpeedChange(head.duration, cmd.range, cmd.factor);
    this.changed();
  }

  unapplyChangeSpeed(cmd: t.ChangeSpeedCmd) {
    assert(this.session.isLoaded());
    const { head, body } = this.session;

    const factor = 1 / cmd.factor;
    const range: t.ClockRange = {
      start: cmd.range.start,
      end: calcClockAfterRangeSpeedChange(cmd.range.end, cmd.range, cmd.factor),
    };

    // Update events.
    body.eventContainer.forEachExc(cmd.firstEventIndex, body.eventContainer.getSize(), (e, i, replace) =>
      replace({
        ...e.event,
        clock:
          cmd.revEventClocks[i - cmd.firstEventIndex] ?? calcClockAfterRangeSpeedChange(e.event.clock, range, factor),
      }),
    );

    // Reindex the event container.
    body.eventContainer.reindexStableOrder();

    // Update focus timeline.
    for (const [i, f] of body.focusTimeline.slice(cmd.firstFocusIndex).entries()) {
      const clock = cmd.revFocusClocks[i] ?? calcClockAfterRangeSpeedChange(f.clock, range, factor);
      body.focusTimeline[i + cmd.firstFocusIndex] = { ...f, clock };
    }

    // Update toc.
    for (const [i, x] of head.toc.slice(cmd.firstTocIndex).entries()) {
      const clock = cmd.revTocClocks[i] ?? calcClockAfterRangeSpeedChange(x.clock, range, factor);
      head.toc[i + cmd.firstTocIndex] = { ...x, clock };
    }

    // Update session duration.
    head.duration = calcClockAfterRangeSpeedChange(head.duration, range, factor);
    this.changed();
  }

  createMerge(range: t.ClockRange): t.MergeCmd {
    assert(this.session.isLoaded());
    const timeline = this.collectTimelineRange(range);
    return this.insertCmd({
      type: 'merge',
      range,
      revRrClock: this.session.rr.clock,
      firstEventIndex: timeline.eventIndex,
      firstFocusIndex: timeline.focusIndex,
      firstTocIndex: timeline.tocIndex,
      revEventClocks: timeline.events.map(e => e.event.clock),
      revFocusClocks: timeline.focusTimeline.map(f => f.clock),
      revTocClocks: timeline.toc.map(x => x.clock),
    });
  }

  applyMerge(cmd: t.MergeCmd) {
    assert(this.session.isLoaded());
    const { head, body } = this.session;

    // Update events.
    body.eventContainer.forEachExc(cmd.firstEventIndex, body.eventContainer.getSize(), (e, _i, replace) =>
      replace({ ...e.event, clock: calcClockAfterMerge(e.event.clock, cmd.range) }),
    );

    // Reindex the event container.
    body.eventContainer.reindexStableOrder();

    // Update focus timeline.
    for (const [i, f] of body.focusTimeline.slice(cmd.firstFocusIndex).entries()) {
      body.focusTimeline[i + cmd.firstFocusIndex] = { ...f, clock: calcClockAfterMerge(f.clock, cmd.range) };
    }

    // Update toc.
    for (const [i, x] of head.toc.slice(cmd.firstTocIndex).entries()) {
      head.toc[i + cmd.firstTocIndex] = { ...x, clock: calcClockAfterMerge(x.clock, cmd.range) };
    }

    // Update session duration.
    head.duration -= getClockRangeDur(cmd.range);
    this.changed();
  }

  unapplyMerge(cmd: t.MergeCmd) {
    assert(this.session.isLoaded());
    const { head, body } = this.session;
    const rangeDur = getClockRangeDur(cmd.range);

    // Update events.
    body.eventContainer.forEachExc(cmd.firstEventIndex, body.eventContainer.getSize(), (e, i, replace) =>
      replace({ ...e.event, clock: cmd.revEventClocks[i - cmd.firstEventIndex] ?? e.event.clock + rangeDur }),
    );

    // Reindex the event container.
    body.eventContainer.reindexStableOrder();

    // Update focus timeline.
    for (const [i, f] of body.focusTimeline.slice(cmd.firstFocusIndex).entries()) {
      body.focusTimeline[i + cmd.firstFocusIndex] = { ...f, clock: cmd.revFocusClocks[i] ?? f.clock + rangeDur };
    }

    // Update toc.
    for (const [i, x] of head.toc.slice(cmd.firstTocIndex).entries()) {
      head.toc[i + cmd.firstTocIndex] = { ...x, clock: cmd.revTocClocks[i] ?? x.clock + rangeDur };
    }

    // Update session duration.
    head.duration += rangeDur;
    this.changed();
  }

  createInsertGap(clock: number, duration: number): t.InsertGapCmd {
    assert(this.session.isLoaded());
    return this.insertCmd({ type: 'insertGap', clock, duration });
  }

  applyInsertGap(cmd: t.InsertGapCmd) {
    assert(this.session.isLoaded());
    const { head, body } = this.session;

    // Update events.
    body.eventContainer.forEachExc(
      body.eventContainer.getIndexAfterClock(cmd.clock),
      body.eventContainer.getSize(),
      (e, _i, replace) => replace({ ...e.event, clock: e.event.clock + cmd.duration }),
    );

    // Reindex the event container.
    body.eventContainer.reindexStableOrder();

    // Update focus timeline.
    for (const f of body.focusTimeline) {
      if (f.clock > cmd.clock) f.clock += cmd.duration;
    }

    // Update toc.
    for (const x of head.toc) {
      if (x.clock > cmd.clock) x.clock += cmd.duration;
    }

    // Update session duration.
    head.duration += cmd.duration;
    this.changed();
  }

  unapplyInsertGap(cmd: t.InsertGapCmd) {
    assert(this.session.isLoaded());
    const { head, body } = this.session;

    // Update events.
    body.eventContainer.forEachExc(
      body.eventContainer.getIndexAfterClock(cmd.clock),
      body.eventContainer.getSize(),
      (e, _i, replace) => replace({ ...e.event, clock: e.event.clock - cmd.duration }),
    );

    // Reindex the event container.
    body.eventContainer.reindexStableOrder();

    // Update focus timeline.
    for (const f of body.focusTimeline) {
      if (f.clock > cmd.clock) f.clock -= cmd.duration;
    }

    // Update toc.
    for (const x of head.toc) {
      if (x.clock > cmd.clock) x.clock -= cmd.duration;
    }

    // Update session duration.
    head.duration -= cmd.duration;
    this.changed();
  }

  createInsertChapter(clock: number, title: string): t.InsertChapterCmd {
    return this.insertCmd({ type: 'insertChapter', clock, title });
  }

  applyInsertChapter(cmd: t.InsertChapterCmd) {
    this.session.head.toc.push({ clock: cmd.clock, title: cmd.title });
    this.session.head.toc.sort((a, b) => a.clock - b.clock);
  }

  unapplyInsertChapter(cmd: t.InsertChapterCmd) {
    const i = this.session.head.toc.findIndex(x => x.clock === cmd.clock);
    assert(i !== -1);
    this.session.head.toc.splice(i, 1);
  }

  createUpdateChapter(index: number, update: Partial<t.TocItem>): t.UpdateChapterCmd {
    const chapter = this.session.head.toc[index];
    assert(chapter);
    const revUpdate = _.pick(chapter, Object.keys(update));
    // const coalescing = _.last(this.curUndoHistoryGroup)?.type === 'updateChapter';
    return this.insertCmd({ type: 'updateChapter', index, update, revUpdate });
  }

  applyUpdateChapter(cmd: t.UpdateChapterCmd) {
    this.session.head.toc[cmd.index] = { ...this.session.head.toc[cmd.index], ...cmd.update };
    // cannot sort because the index will change
    // this.session.head.toc.sort((a, b) => a.clock - b.clock);
  }

  unapplyUpdateChapter(cmd: t.UpdateChapterCmd) {
    this.session.head.toc[cmd.index] = { ...this.session.head.toc[cmd.index], ...cmd.revUpdate };
    // cannot sort because the index will change
    // this.session.head.toc.sort((a, b) => a.clock - b.clock);
  }

  createDeleteChapter(index: number): t.DeleteChapterCmd {
    const chapter = this.session.head.toc[index];
    assert(chapter);
    return this.insertCmd({ type: 'deleteChapter', index, chapter });
  }

  applyDeleteChapter(cmd: t.DeleteChapterCmd) {
    this.session.head.toc.splice(cmd.index, 1);
  }

  unapplyDeleteChapter(cmd: t.DeleteChapterCmd) {
    this.session.head.toc.splice(cmd.index, 0, cmd.chapter);
  }

  /**
   * Crops the session to clock.
   */
  createCrop(clock: number): t.CropCmd {
    assert(this.session.isLoaded());
    const { head } = this.session;

    const timeline = this.collectTimelineRange({ start: clock, end: head.duration });
    return this.insertCmd({
      type: 'crop',
      clock,
      firstEventIndex: timeline.eventIndex,
      firstFocusIndex: timeline.focusIndex,
      firstTocIndex: timeline.tocIndex,
      revEvents: timeline.events,
      revFocusTimeline: timeline.focusTimeline,
      revToc: timeline.toc,
      revDuration: head.duration,
      revRrClock: this.session.rr.clock,
    });
  }

  applyCrop(cmd: t.CropCmd) {
    assert(this.session.isLoaded());
    const { head, body } = this.session;

    // Delete events.
    while (cmd.firstEventIndex < body.eventContainer.getSize()) {
      body.eventContainer.deleteAt(body.eventContainer.getSize() - 1);
    }

    // Delete focus.
    body.focusTimeline.length = cmd.firstFocusIndex;

    // Delete toc.
    head.toc.length = cmd.firstTocIndex;

    // Update session duration.
    head.duration = cmd.clock;
    this.changed();
  }

  unapplyCrop(cmd: t.CropCmd) {
    assert(this.session.isLoaded());
    const { head, body } = this.session;

    // Insert events.
    body.eventContainer.insertMany(cmd.revEvents);

    // Insert focus.
    insertIntoArray(body.focusTimeline, cmd.revFocusTimeline);

    // Insert toc.
    insertIntoArray(head.toc, cmd.revToc);

    // Update session duration.
    head.duration = cmd.revDuration;
    this.changed();
  }

  /**
   * Called by Session.Core when session is saved.
   */
  saved() {
    this.dirty = false;
    // this.session.onChange?.();
  }

  /**
   * Session may not be loaded in which case only its head is written.
   */
  async write(opts?: { pause?: boolean; ifDirty?: boolean }) {
    assert(this.session);
    assert(!this.session.temp);
    this.writeThrottled.cancel();

    if (opts?.pause && this.session.rr?.running) {
      this.session.rr.pause();
    }

    if (!opts?.ifDirty || this.dirty) {
      await this.session.core.write();
      await this.session.core.writeHistoryRecording();
    }
  }

  writeThrottled = _.throttle(
    () => {
      // The session has not changed because writeThrottled is only called
      // inside recorder and closing recorder calls writeSession which cancels the
      // throttle queue.
      this.write({ ifDirty: true }).catch(console.error);
    },
    SAVE_TIMEOUT_MS,
    { leading: false },
  );

  finishEditing() {
    this.writeThrottled.cancel();
  }

  private insertCmd<T extends t.Cmd>(cmd: T, opts?: { coalescing?: boolean }): T {
    if (!opts?.coalescing || this.undoIndex === -1) {
      this.undoIndex++;
      this.undoHistory.length = this.undoIndex;
      this.undoHistory.push([cmd]);
    } else {
      this.undoHistory.length = this.undoIndex + 1;
      this.curUndoHistoryGroup!.push(cmd);
    }
    return cmd;
  }

  /**
   * Return the original clocks of events and focus timeline within range.
   * Use this to avoid having to calculate the clocks for speed change and merge
   * every time because doing the calculations back and forth is not reliable due
   * to floating point precision loss.
   */
  private collectTimelineRange(range: t.ClockRange): TimelineRange {
    assert(this.session.isLoaded());
    const { body, head } = this.session;

    const eventIndex = body.eventContainer.getIndexAfterClock(range.start);
    const eventIndexEnd = body.eventContainer.getIndexAfterClock(range.end);
    const events = body.eventContainer.collectExc(eventIndex, eventIndexEnd);

    let focusIndex = body.focusTimeline.findIndex(f => f.clock >= range.start);
    if (focusIndex === -1) focusIndex = body.focusTimeline.length;
    let focusIndexEnd = body.focusTimeline.findIndex(f => f.clock > range.end);
    if (focusIndexEnd === -1) focusIndexEnd = body.focusTimeline.length;
    const focusTimeline = body.focusTimeline.slice(focusIndex, focusIndexEnd);

    let tocIndex = head.toc.findIndex(x => x.clock >= range.start);
    if (tocIndex === -1) tocIndex = head.toc.length;
    let tocIndexEnd = head.toc.findIndex(x => x.clock > range.end);
    if (tocIndexEnd === -1) tocIndexEnd = head.toc.length;
    const toc = head.toc.slice(tocIndex, tocIndexEnd);

    return { eventIndex, focusIndex, tocIndex, events, focusTimeline, toc };
  }

  private changed() {
    this.dirty = true;
    this.session.head.modificationTimestamp = new Date().toISOString();
    this.session.onChange?.();
  }
}
