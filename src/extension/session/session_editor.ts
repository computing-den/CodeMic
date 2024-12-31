import fs from 'fs';
import { getMp3Duration, getVideoDuration } from '../get_audio_video_duration.js';
import * as misc from '../misc.js';
import * as t from '../../lib/types.js';
import assert from '../../lib/assert.js';
import { Session } from './session.js';
import _ from 'lodash';
import { v4 as uuid } from 'uuid';
import { calcClockAfterRangeSpeedChange } from '../../lib/lib.js';
import { URI } from 'vscode-uri';
import * as path from 'path';
import cache from '../cache.js';

// type HistoryPosition = [number, number];

export default class SessionEditor {
  dirty = false;

  private undoHistory: t.SessionCmd[][] = [];
  // The index of the last SessionCmd group whose effects are visible.
  private undoIndex: number = -1;

  constructor(public session: Session) {}

  get canUndo(): boolean {
    return this.undoIndex > -1;
  }

  get canRedo(): boolean {
    return this.undoIndex < this.undoHistory.length - 1;
  }

  get curUndoHistoryGroup(): t.SessionCmd[] | undefined {
    return this.undoHistory[this.undoIndex];
  }

  undo(): t.SessionCmd[] {
    if (!this.canUndo) return [];

    // Collect session commands and unapply them in reverse order.
    const cmds = Array.from(this.undoHistory[this.undoIndex--]).reverse();
    for (const cmd of cmds) this.unapplyCmd(cmd);

    this.changed();
    return cmds;
  }

  redo(): t.SessionCmd[] {
    if (!this.canRedo) return [];

    // Collect session commands and apply them.
    const cmds = Array.from(this.undoHistory[++this.undoIndex]);
    for (const cmd of cmds) this.applyCmd(cmd);

    this.changed();
    return cmds;
  }

  /**
   * Will not add to undo list.
   */
  insertInitialEvents(events: t.EditorEventWithUri[]) {
    assert(this.session.isLoaded());
    this.session.body.eventContainer.insertMany(events);
    this.changed();
  }

  insertEvent(e: t.EditorEvent, uri: string, opts: { coalescing: boolean }): t.SessionCmd {
    assert(this.session.isLoaded());
    const i = this.session.body.eventContainer.getIndexAfterClock(e.clock);
    return this.applyAndInsertSessionCmd({ type: 'insertEvent', index: i, uri, event: e }, opts);
  }

  private applyInsertEvent(cmd: t.InsertEventSessionCmd) {
    assert(this.session.isLoaded());
    this.session.body.eventContainer.insert(cmd.uri, cmd.event);
  }

  private unapplyInsertEvent(cmd: t.InsertEventSessionCmd) {
    assert(this.session.isLoaded());
    this.session.body.eventContainer.deleteAt(cmd.index);
  }

  updateTrackLastEvent<T extends t.EditorEvent>(uri: string, update: Partial<T>) {
    assert(this.session.isLoaded());
    const track = this.session.body.eventContainer.getTrack(uri);
    const lastEvent = track.at(-1);
    assert(lastEvent);

    if (_.isEqual({ ...lastEvent, ...update }, lastEvent)) return;

    const revUpdate = _.pick(lastEvent, _.keys(update));
    this.applyAndInsertSessionCmd({ type: 'updateTrackLastEvent', uri, update, revUpdate }, { coalescing: true });
  }

  private applyUpdateTrackLastEvent(cmd: t.UpdateTrackLastEventSessionCmd) {
    assert(this.session.isLoaded());
    const e = this.session.body.eventContainer.getTrack(cmd.uri).at(-1);
    assert(e);
    Object.assign(e, cmd.update);
  }

  private unapplyUpdateTrackLastEvent(cmd: t.UpdateTrackLastEventSessionCmd) {
    assert(this.session.isLoaded());
    const e = this.session.body.eventContainer.getTrack(cmd.uri).at(-1);
    assert(e);
    Object.assign(e, cmd.revUpdate);
  }

  setFocus(focus: t.Focus) {
    assert(this.session.isLoaded());
    const lastFocus = this.session.body.focusTimeline.at(-1);

    // Try to update the last one. Otherwise, insert a new focus.
    if (
      lastFocus &&
      (focus.clock - lastFocus.clock < 1 || (lastFocus.uri === focus.uri && lastFocus.number === focus.number))
    ) {
      const keys: Array<keyof t.Focus> = ['uri', 'number', 'text'];
      const keyDiffs = keys.filter(k => focus[k] !== lastFocus[k]);
      if (keyDiffs.length > 0) {
        const update = _.pick(focus, keyDiffs);
        const revUpdate = _.pick(lastFocus, keyDiffs);
        this.applyAndInsertSessionCmd({ type: 'updateLastFocus', update, revUpdate }, { coalescing: true });
      }
    } else {
      this.applyAndInsertSessionCmd({ type: 'insertFocus', focus }, { coalescing: true });
    }
  }

  private applyInsertFocus(cmd: t.InsertFocusSessionCmd) {
    assert(this.session.isLoaded());
    this.session.body.focusTimeline.push(cmd.focus);
  }

  private unapplyInsertFocus(_cmd: t.InsertFocusSessionCmd) {
    assert(this.session.isLoaded());
    this.session.body.focusTimeline.pop();
  }

  private applyUpdateLastFocus(cmd: t.UpdateLastFocusSessionCmd) {
    assert(this.session.isLoaded());
    const lastFocus = this.session.body.focusTimeline.at(-1);
    assert(lastFocus);
    Object.assign(lastFocus, cmd.update);
  }

  private unapplyUpdateLastFocus(cmd: t.UpdateLastFocusSessionCmd) {
    assert(this.session.isLoaded());
    const lastFocus = this.session.body.focusTimeline.at(-1);
    assert(lastFocus);
    Object.assign(lastFocus, cmd.revUpdate);
  }

  async insertAudioTrack(uri: string, clock: number): Promise<t.SessionCmd> {
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

    return this.applyAndInsertSessionCmd({
      type: 'insertAudioTrack',
      audioTrack,
      sessionDuration: Math.max(this.session.head.duration, audioTrack.clockRange.end),
      revSessionDuration: this.session.head.duration,
    });
  }

  private applyInsertAudioTrack(cmd: t.InsertAudioTrackSessionCmd) {
    assert(this.session.isLoaded());
    this.session.body.audioTracks.push(cmd.audioTrack);
    this.session.head.duration = cmd.sessionDuration;
  }

  private unapplyInsertAudioTrack(cmd: t.InsertAudioTrackSessionCmd) {
    assert(this.session.isLoaded());
    const i = this.session.body.audioTracks.findIndex(t => t.id === cmd.audioTrack.id);
    assert(i !== -1);
    this.session.body.audioTracks.splice(i, 1);
    this.session.head.duration = cmd.sessionDuration;
  }

  deleteAudioTrack(id: string): t.SessionCmd {
    assert(this.session.isLoaded());
    const audioTrack = this.session.body.audioTracks.find(t => t.id === id);
    assert(audioTrack);
    return this.applyAndInsertSessionCmd({ type: 'deleteAudioTrack', audioTrack });
  }

  private applyDeleteAudioTrack(cmd: t.DeleteAudioTrackSessionCmd) {
    assert(this.session.isLoaded());
    const i = this.session.body.audioTracks.findIndex(t => t.id === cmd.audioTrack.id);
    assert(i !== -1);
    this.session.body.audioTracks.splice(i, 1);
  }

  private unapplyDeleteAudioTrack(cmd: t.DeleteAudioTrackSessionCmd) {
    assert(this.session.isLoaded());
    this.session.body.audioTracks.push(cmd.audioTrack);
  }

  updateAudioTrack(update: Partial<t.AudioTrack>): t.SessionCmd | undefined {
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
      return this.applyAndInsertSessionCmd({ type: 'updateAudioTrack', id, update, revUpdate });
    }
  }

  private applyUpdateAudioTrack(cmd: t.UpdateAudioTrackSessionCmd) {
    assert(this.session.isLoaded());
    const audioTrack = this.session.body.audioTracks.find(t => t.id === cmd.id);
    assert(audioTrack);
    Object.assign(audioTrack, cmd.update);
  }

  private unapplyUpdateAudioTrack(cmd: t.UpdateAudioTrackSessionCmd) {
    assert(this.session.isLoaded());
    const audioTrack = this.session.body.audioTracks.find(t => t.id === cmd.id);
    assert(audioTrack);
    Object.assign(audioTrack, cmd.revUpdate);
  }

  async insertVideoTrack(uri: string, clock: number): Promise<t.SessionCmd> {
    assert(this.session.isLoaded());
    const fsPath = URI.parse(uri).fsPath;
    const data = await fs.promises.readFile(fsPath);
    const duration = getVideoDuration(data);
    const sha1 = await misc.computeSHA1(data);
    await this.session.core.copyToBlob(fsPath, sha1);
    const videoTrack: t.VideoTrack = {
      id: uuid(),
      type: 'video',
      clockRange: { start: clock, end: clock + duration },
      file: { type: 'local', sha1: sha1 },
      title: path.basename(fsPath),
    };
    return this.applyAndInsertSessionCmd({
      type: 'insertVideoTrack',
      videoTrack,
      sessionDuration: Math.max(this.session.head.duration, videoTrack.clockRange.end),
      revSessionDuration: this.session.head.duration,
    });
  }

  private applyInsertVideoTrack(cmd: t.InsertVideoTrackSessionCmd) {
    assert(this.session.isLoaded());
    this.session.body.videoTracks.push(cmd.videoTrack);
    this.session.head.duration = cmd.sessionDuration;
  }

  private unapplyInsertVideoTrack(cmd: t.InsertVideoTrackSessionCmd) {
    assert(this.session.isLoaded());
    const i = this.session.body.videoTracks.findIndex(t => t.id === cmd.videoTrack.id);
    assert(i !== -1);
    this.session.body.videoTracks.splice(i, 1);
    this.session.head.duration = cmd.revSessionDuration;
  }

  deleteVideoTrack(id: string): t.SessionCmd {
    assert(this.session.isLoaded());
    const videoTrack = this.session.body.videoTracks.find(t => t.id === id);
    assert(videoTrack);
    return this.applyAndInsertSessionCmd({ type: 'deleteVideoTrack', videoTrack });
  }

  private applyDeleteVideoTrack(cmd: t.DeleteVideoTrackSessionCmd) {
    assert(this.session.isLoaded());
    const i = this.session.body.videoTracks.findIndex(t => t.id === cmd.videoTrack.id);
    assert(i !== -1);
    this.session.body.videoTracks.splice(i, 1);
  }

  private unapplyDeleteVideoTrack(cmd: t.DeleteVideoTrackSessionCmd) {
    assert(this.session.isLoaded());
    this.session.body.videoTracks.push(cmd.videoTrack);
  }

  updateVideoTrack(update: Partial<t.VideoTrack>): t.SessionCmd | undefined {
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
      return this.applyAndInsertSessionCmd({ type: 'updateVideoTrack', id, update, revUpdate });
    }
  }

  private applyUpdateVideoTrack(cmd: t.UpdateVideoTrackSessionCmd) {
    assert(this.session.isLoaded());
    const videoTrack = this.session.body.videoTracks.find(t => t.id === cmd.id);
    assert(videoTrack);
    Object.assign(videoTrack, cmd.update);
  }

  private unapplyUpdateVideoTrack(cmd: t.UpdateVideoTrackSessionCmd) {
    assert(this.session.isLoaded());
    const videoTrack = this.session.body.videoTracks.find(t => t.id === cmd.id);
    assert(videoTrack);
    Object.assign(videoTrack, cmd.revUpdate);
  }

  updateHead(partial: Partial<t.SessionHead>) {
    Object.assign(this.session.head, partial);
    this.changed();
  }

  updateFromUI(update: t.SessionDetailsUpdate) {
    if (update.workspace !== undefined) this.session.workspace = update.workspace;
    if (update.title !== undefined) this.session.head.title = update.title;
    if (update.description !== undefined) this.session.head.description = update.description;
    if (update.handle !== undefined) this.session.head.handle = update.handle;

    this.changed();
  }

  updateDuration(duration: number, opts?: { coalescing?: boolean }): t.SessionCmd {
    // const coalescing = opts?.coalescing || this.curUndoHistoryGroup?.at(-1)?.type === 'updateDuration';
    return this.applyAndInsertSessionCmd(
      { type: 'updateDuration', duration, revDuration: this.session.head.duration },
      opts,
    );
  }

  private applyUpdateDuration(cmd: t.UpdateDurationSessionCmd) {
    this.session.head.duration = cmd.duration;
  }

  private unapplyUpdateDuration(cmd: t.UpdateDurationSessionCmd) {
    this.session.head.duration = cmd.revDuration;
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

  changeSpeed(range: t.ClockRange, factor: number): t.SessionCmd {
    assert(this.session.isLoaded());
    const { body } = this.session;

    // Store the original clocks of events within range. Event though events
    // after the range will be affected too, it's only a simple addition or
    // subtraction without much loss of precision.
    const firstEventIndex = body.eventContainer.getIndexAfterClock(range.start);
    const endEventIndex = body.eventContainer.getIndexAfterClock(range.end);
    const revEventClocksInRange = body.eventContainer
      .collectExc(firstEventIndex, endEventIndex)
      .map(e => e.event.clock);

    // Store original clocks of focus items within range.
    const firstFocusIndex = Math.max(
      0,
      body.focusTimeline.findIndex(f => f.clock >= range.start),
    );
    const endFocusIndex = Math.max(
      0,
      body.focusTimeline.findIndex(f => f.clock >= range.end),
    );
    const revFocusClocksInRange: number[] = body.focusTimeline.slice(firstFocusIndex, endFocusIndex).map(f => f.clock);

    return this.applyAndInsertSessionCmd({
      type: 'changeSpeed',
      range,
      factor,
      firstEventIndex,
      firstFocusIndex,
      revEventClocksInRange,
      revFocusClocksInRange,
    });
  }

  private applyChangeSpeed(cmd: t.ChangeSpeedSessionCmd) {
    assert(this.session.isLoaded());
    const { head, body } = this.session;

    // Update events.
    body.eventContainer.forEachExc(cmd.firstEventIndex, body.eventContainer.getSize(), e => {
      e.event.clock = calcClockAfterRangeSpeedChange(e.event.clock, cmd.range, cmd.factor);
    });

    // Reindex the event container.
    body.eventContainer.reindexStableOrder();

    // Update focus timeline.
    for (const f of body.focusTimeline.slice(cmd.firstFocusIndex)) {
      f.clock = calcClockAfterRangeSpeedChange(f.clock, cmd.range, cmd.factor);
    }

    // Update session duration.
    head.duration = calcClockAfterRangeSpeedChange(head.duration, cmd.range, cmd.factor);
  }

  private unapplyChangeSpeed(cmd: t.ChangeSpeedSessionCmd) {
    assert(this.session.isLoaded());
    const { head, body } = this.session;

    const factor = 1 / cmd.factor;
    const range: t.ClockRange = {
      start: cmd.range.start,
      end: calcClockAfterRangeSpeedChange(cmd.range.end, cmd.range, cmd.factor),
    };

    // Update events.
    body.eventContainer.forEachExc(cmd.firstEventIndex, body.eventContainer.getSize(), (e, i) => {
      e.event.clock =
        cmd.revEventClocksInRange[i - cmd.firstEventIndex] ??
        calcClockAfterRangeSpeedChange(e.event.clock, range, factor);
    });

    // Reindex the event container.
    body.eventContainer.reindexStableOrder();

    // Update focus timeline.
    for (const [i, f] of body.focusTimeline.slice(cmd.firstFocusIndex).entries()) {
      f.clock = cmd.revFocusClocksInRange[i] ?? calcClockAfterRangeSpeedChange(f.clock, range, factor);
    }

    // Update session duration.
    head.duration = calcClockAfterRangeSpeedChange(head.duration, range, factor);
  }

  merge(range: t.ClockRange): t.ChangeSpeedSessionCmd {
    throw new Error('TODO');
    // return this.changeSpeed(range, Infinity);
  }

  insertGap(clock: number, duration: number): t.SessionCmd {
    assert(this.session.isLoaded());
    return this.applyAndInsertSessionCmd({ type: 'insertGap', clock, duration });
  }

  private applyInsertGap(cmd: t.InsertGapSessionCmd) {
    assert(this.session.isLoaded());
    const { head, body } = this.session;

    // Update events.
    body.eventContainer.forEachExc(
      body.eventContainer.getIndexAfterClock(cmd.clock),
      body.eventContainer.getSize(),
      e => void (e.event.clock += cmd.duration),
    );

    // Reindex the event container.
    body.eventContainer.reindexStableOrder();

    // Update focus timeline.
    for (const f of body.focusTimeline) {
      if (f.clock > cmd.clock) f.clock += cmd.duration;
    }

    // Update session duration.
    head.duration += cmd.duration;
  }

  private unapplyInsertGap(cmd: t.InsertGapSessionCmd) {
    assert(this.session.isLoaded());
    const { head, body } = this.session;

    // Update events.
    body.eventContainer.forEachExc(
      body.eventContainer.getIndexAfterClock(cmd.clock),
      body.eventContainer.getSize(),
      e => void (e.event.clock -= cmd.duration),
    );

    // Reindex the event container.
    body.eventContainer.reindexStableOrder();

    // Update focus timeline.
    for (const f of body.focusTimeline) {
      if (f.clock > cmd.clock) f.clock -= cmd.duration;
    }

    // Update session duration.
    head.duration -= cmd.duration;
  }

  /**
   * Crops the session to clock.
   */
  crop(clock: number): t.SessionCmd {
    assert(this.session.isLoaded());
    return this.applyAndInsertSessionCmd({ type: 'crop', clock });
  }

  private applyCrop(cmd: t.CropSessionCmd) {
    // TODO
  }

  private unapplyCrop(cmd: t.CropSessionCmd) {
    // TODO
  }

  cut(clock: number) {
    assert(this.session.isLoaded());

    throw new Error('TODO');
    // // Cut events
    // {
    //   const i = this.editorTrack.events.findIndex(e => e.clock > clock);
    //   assert(this.eventIndex < i);
    //   if (i >= 0) this.editorTrack.events.length = i;
    // }

    // // Cut focusTimeline
    // {
    //   this.cutFocusItems(this.editorTrack.focusTimeline.documents, clock);
    //   this.cutFocusItems(this.editorTrack.focusTimeline.lines, clock);
    // }

    // this.changed();
  }

  /**
   * Called by Session.Core when session is saved.
   */
  saved() {
    this.dirty = false;
    // this.session.onChange?.();
  }

  private applyCmd(cmd: t.SessionCmd) {
    switch (cmd.type) {
      case 'insertEvent':
        return this.applyInsertEvent(cmd);
      case 'updateTrackLastEvent':
        return this.applyUpdateTrackLastEvent(cmd);
      case 'insertFocus':
        return this.applyInsertFocus(cmd);
      case 'updateLastFocus':
        return this.applyUpdateLastFocus(cmd);
      case 'insertAudioTrack':
        return this.applyInsertAudioTrack(cmd);
      case 'deleteAudioTrack':
        return this.applyDeleteAudioTrack(cmd);
      case 'updateAudioTrack':
        return this.applyUpdateAudioTrack(cmd);
      case 'insertVideoTrack':
        return this.applyInsertVideoTrack(cmd);
      case 'deleteVideoTrack':
        return this.applyDeleteVideoTrack(cmd);
      case 'updateVideoTrack':
        return this.applyUpdateVideoTrack(cmd);
      case 'changeSpeed':
        return this.applyChangeSpeed(cmd);
      // case 'merge':
      // return this.applyMerge(cmd);
      case 'insertGap':
        return this.applyInsertGap(cmd);
      case 'crop':
        return this.applyCrop(cmd);
      case 'updateDuration':
        return this.applyUpdateDuration(cmd);

      default:
        throw new Error(`unknown cmd type: ${(cmd as any).type}`);
    }
  }

  private unapplyCmd(cmd: t.SessionCmd) {
    switch (cmd.type) {
      case 'insertEvent':
        return this.unapplyInsertEvent(cmd);
      case 'updateTrackLastEvent':
        return this.unapplyUpdateTrackLastEvent(cmd);
      case 'insertFocus':
        return this.unapplyInsertFocus(cmd);
      case 'updateLastFocus':
        return this.unapplyUpdateLastFocus(cmd);
      case 'insertAudioTrack':
        return this.unapplyInsertAudioTrack(cmd);
      case 'deleteAudioTrack':
        return this.unapplyDeleteAudioTrack(cmd);
      case 'updateAudioTrack':
        return this.unapplyUpdateAudioTrack(cmd);
      case 'insertVideoTrack':
        return this.unapplyInsertVideoTrack(cmd);
      case 'deleteVideoTrack':
        return this.unapplyDeleteVideoTrack(cmd);
      case 'updateVideoTrack':
        return this.unapplyUpdateVideoTrack(cmd);
      case 'changeSpeed':
        return this.unapplyChangeSpeed(cmd);
      // case 'merge':
      // return this.unapplyMerge(cmd);
      case 'insertGap':
        return this.unapplyInsertGap(cmd);
      case 'crop':
        return this.unapplyCrop(cmd);
      case 'updateDuration':
        return this.unapplyUpdateDuration(cmd);
      default:
        throw new Error(`unknown cmd type: ${(cmd as any).type}`);
    }
  }

  private insertSessionCmd(cmd: t.SessionCmd, opts?: { coalescing?: boolean }) {
    if (!opts?.coalescing || this.undoIndex === -1) {
      this.undoIndex++;
      this.undoHistory.length = this.undoIndex;
      this.undoHistory.push([cmd]);
    } else {
      this.undoHistory.length = this.undoIndex + 1;
      this.curUndoHistoryGroup!.push(cmd);
    }
  }

  private applyAndInsertSessionCmd(cmd: t.SessionCmd, opts?: { coalescing?: boolean }): t.SessionCmd {
    this.applyCmd(cmd);
    this.insertSessionCmd(cmd, opts);
    this.changed();
    return cmd;
  }

  private changed() {
    this.dirty = true;
    this.session.head.modificationTimestamp = new Date().toISOString();
    this.session.onChange?.();
  }
}
