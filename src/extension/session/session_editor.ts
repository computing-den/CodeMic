import fs from 'fs';
import { getMp3Duration, getVideoDuration } from '../get_audio_video_duration.js';
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
  isClockInRange,
  unreachable,
} from '../../lib/lib.js';
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

  undoHistoryPop(): t.SessionCmd[] {
    return this.canUndo ? this.undoHistory[this.undoIndex--] : [];
  }

  undoHistoryForward(): t.SessionCmd[] {
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

  createInsertEvent(e: t.EditorEvent, uri: string, opts: { coalescing: boolean }): t.InsertEventSessionCmd {
    assert(this.session.isLoaded());
    const i = this.session.body.eventContainer.getIndexAfterClock(e.clock);
    return this.insertSessionCmd({ type: 'insertEvent', index: i, uri, event: e }, opts);
  }

  applyInsertEvent(cmd: t.InsertEventSessionCmd) {
    assert(this.session.isLoaded());
    this.session.body.eventContainer.insert(cmd.uri, cmd.event);
    this.changed();
  }

  unapplyInsertEvent(cmd: t.InsertEventSessionCmd) {
    assert(this.session.isLoaded());
    this.session.body.eventContainer.deleteAt(cmd.index);
    this.changed();
  }

  createUpdateTrackLastEvent<T extends t.EditorEvent>(
    uri: string,
    update: Partial<T>,
  ): t.UpdateTrackLastEventSessionCmd | undefined {
    assert(this.session.isLoaded());
    const track = this.session.body.eventContainer.getTrack(uri);
    const lastEvent = track.at(-1);
    assert(lastEvent);

    if (_.isEqual({ ...lastEvent, ...update }, lastEvent)) return;

    const revUpdate = _.pick(lastEvent, _.keys(update));
    return this.insertSessionCmd({ type: 'updateTrackLastEvent', uri, update, revUpdate }, { coalescing: true });
  }

  applyUpdateTrackLastEvent(cmd: t.UpdateTrackLastEventSessionCmd) {
    assert(this.session.isLoaded());
    const e = this.session.body.eventContainer.getTrack(cmd.uri).at(-1);
    assert(e);
    Object.assign(e, cmd.update);
    this.changed();
  }

  unapplyUpdateTrackLastEvent(cmd: t.UpdateTrackLastEventSessionCmd) {
    assert(this.session.isLoaded());
    const e = this.session.body.eventContainer.getTrack(cmd.uri).at(-1);
    assert(e);
    Object.assign(e, cmd.revUpdate);
    this.changed();
  }

  createSetFocus(focus: t.Focus): t.UpdateLastFocusSessionCmd | t.InsertFocusSessionCmd | undefined {
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
        return this.insertSessionCmd({ type: 'updateLastFocus', update, revUpdate }, { coalescing: true });
      }
    } else {
      return this.insertSessionCmd({ type: 'insertFocus', focus }, { coalescing: true });
    }
  }

  applySetFocus(cmd: t.UpdateLastFocusSessionCmd | t.InsertFocusSessionCmd) {
    switch (cmd.type) {
      case 'updateLastFocus':
        return this.applyUpdateLastFocus(cmd);
      case 'insertFocus':
        return this.applyInsertFocus(cmd);
      default:
        unreachable(cmd);
    }
  }

  unapplySetFocus(cmd: t.UpdateLastFocusSessionCmd | t.InsertFocusSessionCmd) {
    switch (cmd.type) {
      case 'updateLastFocus':
        return this.unapplyUpdateLastFocus(cmd);
      case 'insertFocus':
        return this.unapplyInsertFocus(cmd);
      default:
        unreachable(cmd);
    }
  }

  applyInsertFocus(cmd: t.InsertFocusSessionCmd) {
    assert(this.session.isLoaded());
    this.session.body.focusTimeline.push(cmd.focus);
    this.changed();
  }

  unapplyInsertFocus(_cmd: t.InsertFocusSessionCmd) {
    assert(this.session.isLoaded());
    this.session.body.focusTimeline.pop();
    this.changed();
  }

  applyUpdateLastFocus(cmd: t.UpdateLastFocusSessionCmd) {
    assert(this.session.isLoaded());
    const lastFocus = this.session.body.focusTimeline.at(-1);
    assert(lastFocus);
    Object.assign(lastFocus, cmd.update);
    this.changed();
  }

  unapplyUpdateLastFocus(cmd: t.UpdateLastFocusSessionCmd) {
    assert(this.session.isLoaded());
    const lastFocus = this.session.body.focusTimeline.at(-1);
    assert(lastFocus);
    Object.assign(lastFocus, cmd.revUpdate);
    this.changed();
  }

  async createInsertAudioTrack(uri: string, clock: number): Promise<t.InsertAudioTrackSessionCmd> {
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

    return this.insertSessionCmd({
      type: 'insertAudioTrack',
      audioTrack,
      sessionDuration: Math.max(this.session.head.duration, audioTrack.clockRange.end),
      revSessionDuration: this.session.head.duration,
    });
  }

  applyInsertAudioTrack(cmd: t.InsertAudioTrackSessionCmd) {
    assert(this.session.isLoaded());
    this.session.body.audioTracks.push(cmd.audioTrack);
    this.session.head.duration = cmd.sessionDuration;
    this.changed();
  }

  unapplyInsertAudioTrack(cmd: t.InsertAudioTrackSessionCmd) {
    assert(this.session.isLoaded());
    const i = this.session.body.audioTracks.findIndex(t => t.id === cmd.audioTrack.id);
    assert(i !== -1);
    this.session.body.audioTracks.splice(i, 1);
    this.session.head.duration = cmd.sessionDuration;
    this.changed();
  }

  createDeleteAudioTrack(id: string): t.DeleteAudioTrackSessionCmd {
    assert(this.session.isLoaded());
    const audioTrack = this.session.body.audioTracks.find(t => t.id === id);
    assert(audioTrack);
    return this.insertSessionCmd({ type: 'deleteAudioTrack', audioTrack });
  }

  applyDeleteAudioTrack(cmd: t.DeleteAudioTrackSessionCmd) {
    assert(this.session.isLoaded());
    const i = this.session.body.audioTracks.findIndex(t => t.id === cmd.audioTrack.id);
    assert(i !== -1);
    this.session.body.audioTracks.splice(i, 1);
    this.changed();
  }

  unapplyDeleteAudioTrack(cmd: t.DeleteAudioTrackSessionCmd) {
    assert(this.session.isLoaded());
    this.session.body.audioTracks.push(cmd.audioTrack);
    this.changed();
  }

  createUpdateAudioTrack(update: Partial<t.AudioTrack>): t.UpdateAudioTrackSessionCmd | undefined {
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
      return this.insertSessionCmd({ type: 'updateAudioTrack', id, update, revUpdate });
    }
  }

  applyUpdateAudioTrack(cmd: t.UpdateAudioTrackSessionCmd) {
    assert(this.session.isLoaded());
    const audioTrack = this.session.body.audioTracks.find(t => t.id === cmd.id);
    assert(audioTrack);
    Object.assign(audioTrack, cmd.update);
    this.changed();
  }

  unapplyUpdateAudioTrack(cmd: t.UpdateAudioTrackSessionCmd) {
    assert(this.session.isLoaded());
    const audioTrack = this.session.body.audioTracks.find(t => t.id === cmd.id);
    assert(audioTrack);
    Object.assign(audioTrack, cmd.revUpdate);
    this.changed();
  }

  async createInsertVideoTrack(uri: string, clock: number): Promise<t.InsertVideoTrackSessionCmd> {
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
    return this.insertSessionCmd({
      type: 'insertVideoTrack',
      videoTrack,
      sessionDuration: Math.max(this.session.head.duration, videoTrack.clockRange.end),
      revSessionDuration: this.session.head.duration,
    });
  }

  applyInsertVideoTrack(cmd: t.InsertVideoTrackSessionCmd) {
    assert(this.session.isLoaded());
    this.session.body.videoTracks.push(cmd.videoTrack);
    this.session.head.duration = cmd.sessionDuration;
    this.changed();
  }

  unapplyInsertVideoTrack(cmd: t.InsertVideoTrackSessionCmd) {
    assert(this.session.isLoaded());
    const i = this.session.body.videoTracks.findIndex(t => t.id === cmd.videoTrack.id);
    assert(i !== -1);
    this.session.body.videoTracks.splice(i, 1);
    this.session.head.duration = cmd.revSessionDuration;
    this.changed();
  }

  createDeleteVideoTrack(id: string): t.DeleteVideoTrackSessionCmd {
    assert(this.session.isLoaded());
    const videoTrack = this.session.body.videoTracks.find(t => t.id === id);
    assert(videoTrack);
    return this.insertSessionCmd({ type: 'deleteVideoTrack', videoTrack });
  }

  applyDeleteVideoTrack(cmd: t.DeleteVideoTrackSessionCmd) {
    assert(this.session.isLoaded());
    const i = this.session.body.videoTracks.findIndex(t => t.id === cmd.videoTrack.id);
    assert(i !== -1);
    this.session.body.videoTracks.splice(i, 1);
    this.changed();
  }

  unapplyDeleteVideoTrack(cmd: t.DeleteVideoTrackSessionCmd) {
    assert(this.session.isLoaded());
    this.session.body.videoTracks.push(cmd.videoTrack);
    this.changed();
  }

  createUpdateVideoTrack(update: Partial<t.VideoTrack>): t.UpdateVideoTrackSessionCmd | undefined {
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
      return this.insertSessionCmd({ type: 'updateVideoTrack', id, update, revUpdate });
    }
  }

  applyUpdateVideoTrack(cmd: t.UpdateVideoTrackSessionCmd) {
    assert(this.session.isLoaded());
    const videoTrack = this.session.body.videoTracks.find(t => t.id === cmd.id);
    assert(videoTrack);
    Object.assign(videoTrack, cmd.update);
    this.changed();
  }

  unapplyUpdateVideoTrack(cmd: t.UpdateVideoTrackSessionCmd) {
    assert(this.session.isLoaded());
    const videoTrack = this.session.body.videoTracks.find(t => t.id === cmd.id);
    assert(videoTrack);
    Object.assign(videoTrack, cmd.revUpdate);
    this.changed();
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

  updateDuration(duration: number, opts?: { coalescing?: boolean }): t.UpdateDurationSessionCmd {
    // const coalescing = opts?.coalescing || this.curUndoHistoryGroup?.at(-1)?.type === 'updateDuration';
    const cmd: t.UpdateDurationSessionCmd = {
      type: 'updateDuration',
      duration,
      revDuration: this.session.head.duration,
    };
    this.applyUpdateDuration(cmd);
    return this.insertSessionCmd(cmd, opts);
  }

  applyUpdateDuration(cmd: t.UpdateDurationSessionCmd) {
    this.session.head.duration = cmd.duration;
    this.changed();
  }

  unapplyUpdateDuration(cmd: t.UpdateDurationSessionCmd) {
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

  createChangeSpeed(range: t.ClockRange, factor: number): t.ChangeSpeedSessionCmd {
    assert(this.session.isLoaded());
    return this.insertSessionCmd({
      type: 'changeSpeed',
      range,
      factor,
      revRrClock: this.session.rr.clock,
      ...this.collectEventAndFocusClocks(range),
    });
  }

  applyChangeSpeed(cmd: t.ChangeSpeedSessionCmd) {
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
    this.changed();
  }

  unapplyChangeSpeed(cmd: t.ChangeSpeedSessionCmd) {
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
    this.changed();
  }

  createMerge(range: t.ClockRange): t.MergeSessionCmd {
    assert(this.session.isLoaded());
    return this.insertSessionCmd({
      type: 'merge',
      range,
      revRrClock: this.session.rr.clock,
      ...this.collectEventAndFocusClocks(range),
    });
  }

  applyMerge(cmd: t.MergeSessionCmd) {
    assert(this.session.isLoaded());
    const { head, body } = this.session;

    // Update events.
    body.eventContainer.forEachExc(cmd.firstEventIndex, body.eventContainer.getSize(), e => {
      e.event.clock = calcClockAfterMerge(e.event.clock, cmd.range);
    });

    // Reindex the event container.
    body.eventContainer.reindexStableOrder();

    // Update focus timeline.
    for (const f of body.focusTimeline.slice(cmd.firstFocusIndex)) {
      f.clock = calcClockAfterMerge(f.clock, cmd.range);
    }

    // Update session duration.
    head.duration -= getClockRangeDur(cmd.range);
    this.changed();
  }

  unapplyMerge(cmd: t.MergeSessionCmd) {
    assert(this.session.isLoaded());
    const { head, body } = this.session;
    const rangeDur = getClockRangeDur(cmd.range);

    // Update events.
    body.eventContainer.forEachExc(cmd.firstEventIndex, body.eventContainer.getSize(), (e, i) => {
      e.event.clock = cmd.revEventClocksInRange[i - cmd.firstEventIndex] ?? e.event.clock + rangeDur;
    });

    // Reindex the event container.
    body.eventContainer.reindexStableOrder();

    // Update focus timeline.
    for (const [i, f] of body.focusTimeline.slice(cmd.firstFocusIndex).entries()) {
      f.clock = cmd.revFocusClocksInRange[i] ?? f.clock + rangeDur;
    }

    // Update session duration.
    head.duration += rangeDur;
    this.changed();
  }

  createInsertGap(clock: number, duration: number): t.InsertGapSessionCmd {
    assert(this.session.isLoaded());
    return this.insertSessionCmd({ type: 'insertGap', clock, duration });
  }

  applyInsertGap(cmd: t.InsertGapSessionCmd) {
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
    this.changed();
  }

  unapplyInsertGap(cmd: t.InsertGapSessionCmd) {
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
    this.changed();
  }

  /**
   * Crops the session to clock.
   */
  createCrop(clock: number): t.CropSessionCmd {
    assert(this.session.isLoaded());
    const { head, body } = this.session;

    const firstEventIndex = body.eventContainer.getIndexAfterClock(clock);
    const revEvents = body.eventContainer.collectExc(firstEventIndex, body.eventContainer.getSize());

    const firstFocusIndex = Math.max(
      0,
      body.focusTimeline.findIndex(f => f.clock >= clock),
    );
    const revFocusTimeline = body.focusTimeline.slice(firstFocusIndex);

    return this.insertSessionCmd({
      type: 'crop',
      clock,
      firstEventIndex,
      firstFocusIndex,
      revEvents,
      revFocusTimeline,
      revDuration: head.duration,
      revRrClock: this.session.rr.clock,
    });
  }

  applyCrop(cmd: t.CropSessionCmd) {
    assert(this.session.isLoaded());
    const { head, body } = this.session;

    // Delete events.
    while (cmd.firstEventIndex < body.eventContainer.getSize()) {
      body.eventContainer.deleteAt(body.eventContainer.getSize() - 1);
    }

    // Delete focus.
    body.focusTimeline.length = cmd.firstFocusIndex;

    // Update session duration.
    head.duration = cmd.clock;
    this.changed();
  }

  unapplyCrop(cmd: t.CropSessionCmd) {
    assert(this.session.isLoaded());
    const { head, body } = this.session;

    // Insert events.
    body.eventContainer.insertMany(cmd.revEvents);

    // Insert focus.
    insertIntoArray(body.focusTimeline, cmd.revFocusTimeline);

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

  private insertSessionCmd<T extends t.SessionCmd>(cmd: T, opts?: { coalescing?: boolean }): T {
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
  private collectEventAndFocusClocks(range: t.ClockRange): {
    firstEventIndex: number;
    firstFocusIndex: number;
    revEventClocksInRange: number[];
    revFocusClocksInRange: number[];
  } {
    assert(this.session.isLoaded());
    const { body } = this.session;

    const firstEventIndex = body.eventContainer.getIndexAfterClock(range.start);
    const endEventIndex = body.eventContainer.getIndexAfterClock(range.end);
    const revEventClocksInRange = body.eventContainer
      .collectExc(firstEventIndex, endEventIndex)
      .map(e => e.event.clock);

    const firstFocusIndex = Math.max(
      0,
      body.focusTimeline.findIndex(f => f.clock >= range.start),
    );
    const endFocusIndex = Math.max(
      0,
      body.focusTimeline.findIndex(f => f.clock >= range.end),
    );
    const revFocusClocksInRange: number[] = body.focusTimeline.slice(firstFocusIndex, endFocusIndex).map(f => f.clock);

    return { firstEventIndex, firstFocusIndex, revEventClocksInRange, revFocusClocksInRange };
  }

  private changed() {
    this.dirty = true;
    this.session.head.modificationTimestamp = new Date().toISOString();
    this.session.onChange?.();
  }
}
