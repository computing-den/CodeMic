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

export default class SessionEditor {
  dirty = false;

  private undoHistory: t.SessionCmd[] = [];
  // The index of the last SessionCmd whose effects are visible.
  private undoHistoryIndex: number = -1;

  constructor(public session: Session) {}

  get canUndo(): boolean {
    return this.undoHistoryIndex > -1;
  }

  get canRedo(): boolean {
    return this.undoHistoryIndex < this.undoHistory.length - 1;
  }

  async undo(): Promise<t.SessionCmd[]> {
    const cmds: t.SessionCmd[] = [];

    // Collect session commands.
    while (this.canUndo && this.undoHistory[this.undoHistoryIndex].coalescing) {
      cmds.push(this.undoHistory[this.undoHistoryIndex--]);
    }
    if (this.canUndo) {
      cmds.push(this.undoHistory[this.undoHistoryIndex--]);
    }

    // Unapply session commands.
    for (const cmd of cmds) await this.unapplyCmd(cmd);

    this.changed();
    return cmds;
  }

  async redo(): Promise<t.SessionCmd[]> {
    const cmds: t.SessionCmd[] = [];

    // Collect session commands.
    while (this.canRedo && this.undoHistory[this.undoHistoryIndex + 1].coalescing) {
      cmds.push(this.undoHistory[++this.undoHistoryIndex]);
    }
    if (this.canRedo) {
      cmds.push(this.undoHistory[++this.undoHistoryIndex]);
    }

    // Apply session commands.
    for (const cmd of cmds) await this.applyCmd(cmd);

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

  insertEvent(e: t.EditorEvent, uri: string, opts: { coalescing: boolean }) {
    assert(this.session.isLoaded());
    const i = this.session.body.eventContainer.getIndexAfterClock(e.clock);
    const cmd: t.InsertEventSessionCmd = {
      type: 'insertEvent',
      index: i,
      uri,
      event: e,
      coalescing: opts.coalescing,
    };
    this.applyInsertEvent(cmd);
    this.insertSessionCmd(cmd);
    this.changed();
    return cmd;
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

    const cmd: t.UpdateTrackLastEventSessionCmd = {
      type: 'updateTrackLastEvent',
      uri,
      update,
      revUpdate: _.pick(lastEvent, _.keys(update)),
      coalescing: true,
    };
    this.applyUpdateTrackLastEvent(cmd);
    this.insertSessionCmd(cmd);
    this.changed();
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

    // Try to update the last one. Otherwise, insert.
    if (
      lastFocus &&
      (focus.clock - lastFocus.clock < 1 || (lastFocus.uri === focus.uri && lastFocus.number === focus.number))
    ) {
      const keys: Array<keyof t.Focus> = ['uri', 'number', 'text'];
      const keyDiffs = keys.filter(k => focus[k] !== lastFocus[k]);
      if (keyDiffs.length > 0) {
        const update = _.pick(focus, keyDiffs);
        const revUpdate = _.pick(lastFocus, keyDiffs);
        const cmd: t.UpdateLastFocusSessionCmd = { type: 'updateLastFocus', update, revUpdate, coalescing: true };
        this.applyUpdateLastFocus(cmd);
        this.insertSessionCmd(cmd);
      }
    } else {
      const cmd: t.InsertFocusSessionCmd = { type: 'insertFocus', focus, coalescing: true };
      this.applyInsertFocus(cmd);
      this.insertSessionCmd(cmd);
    }
    this.changed();
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

  async insertAudioTrack(uri: string, clock: number): Promise<t.InsertAudioTrackSessionCmd> {
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

    const cmd: t.InsertAudioTrackSessionCmd = {
      type: 'insertAudioTrack',
      coalescing: false,
      audioTrack,
      sessionDuration: Math.max(this.session.head.duration, audioTrack.clockRange.end),
      revSessionDuration: this.session.head.duration,
    };

    this.applyInsertAudioTrack(cmd);
    this.insertSessionCmd(cmd);
    this.changed();
    return cmd;
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

  deleteAudioTrack(id: string): t.DeleteAudioTrackSessionCmd {
    assert(this.session.isLoaded());
    const audioTrack = this.session.body.audioTracks.find(t => t.id === id);
    assert(audioTrack);
    const cmd: t.DeleteAudioTrackSessionCmd = { type: 'deleteAudioTrack', coalescing: false, audioTrack };
    this.applyDeleteAudioTrack(cmd);
    this.insertSessionCmd(cmd);
    this.changed();
    return cmd;
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

  updateAudioTrack(update: Partial<t.AudioTrack>): t.UpdateAudioTrackSessionCmd | undefined {
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
      const cmd: t.UpdateAudioTrackSessionCmd = { type: 'updateAudioTrack', coalescing: false, id, update, revUpdate };
      this.applyUpdateAudioTrack(cmd);
      this.insertSessionCmd(cmd);
      this.changed();
      return cmd;
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

  async insertVideoTrack(uri: string, clock: number): Promise<t.InsertVideoTrackSessionCmd> {
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
    const cmd: t.InsertVideoTrackSessionCmd = {
      type: 'insertVideoTrack',
      coalescing: false,
      videoTrack,
      sessionDuration: Math.max(this.session.head.duration, videoTrack.clockRange.end),
      revSessionDuration: this.session.head.duration,
    };
    this.applyInsertVideoTrack(cmd);
    this.insertSessionCmd(cmd);
    this.changed();
    return cmd;
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

  deleteVideoTrack(id: string): t.DeleteVideoTrackSessionCmd {
    assert(this.session.isLoaded());
    const videoTrack = this.session.body.videoTracks.find(t => t.id === id);
    assert(videoTrack);
    const cmd: t.DeleteVideoTrackSessionCmd = { type: 'deleteVideoTrack', coalescing: false, videoTrack };
    this.applyDeleteVideoTrack(cmd);
    this.insertSessionCmd(cmd);
    this.changed();
    return cmd;
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

  updateVideoTrack(update: Partial<t.VideoTrack>): t.UpdateVideoTrackSessionCmd | undefined {
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
      const cmd: t.UpdateVideoTrackSessionCmd = { type: 'updateVideoTrack', coalescing: false, id, update, revUpdate };
      this.applyUpdateVideoTrack(cmd);
      this.insertSessionCmd(cmd);
      this.changed();
      return cmd;
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

  updateDuration(duration: number, opts?: { coalescing?: boolean }) {
    const lastCmd = this.undoHistory[this.undoHistoryIndex];
    // const replace = lastCmd?.type === 'updateDuration';

    const cmd: t.UpdateDurationSessionCmd = {
      type: 'updateDuration',
      coalescing: Boolean(opts?.coalescing),
      duration,
      revDuration: this.session.head.duration,
      // revDuration: replace ? lastCmd.revDuration : this.session.head.duration,
    };
    this.applyUpdateDuration(cmd);
    this.insertSessionCmd(cmd /*, { replace }*/);
    this.changed();
    return cmd;
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

  changeSpeed(range: t.ClockRange, factor: number): t.ChangeSpeedSessionCmd {
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

    const cmd: t.ChangeSpeedSessionCmd = {
      type: 'changeSpeed',
      coalescing: false,
      range,
      factor,
      firstEventIndex,
      firstFocusIndex,
      revEventClocksInRange,
      revFocusClocksInRange,
    };

    this.applyChangeSpeed(cmd);
    this.insertSessionCmd(cmd);
    this.changed();
    return cmd;
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

  insertGap(clock: number, duration: number): t.InsertGapSessionCmd {
    assert(this.session.isLoaded());
    // const { head, body } = this.session;

    // const firstEventIndex = body.eventContainer.getIndexAfterClock(clock);
    // const firstFocusIndex = Math.max(
    //   0,
    //   body.focusTimeline.findIndex(f => f.clock >= clock),
    // );

    const cmd: t.InsertGapSessionCmd = {
      type: 'insertGap',
      coalescing: false,
      clock,
      duration,
      // firstEventIndex,
      // firstFocusIndex,
    };

    this.applyInsertGap(cmd);
    this.insertSessionCmd(cmd);
    this.changed();
    return cmd;
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
   * Cuts the sessions at clock.
   * Current clock must be < cut clock.
   */
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

  private insertSessionCmd(cmd: t.SessionCmd /*, opts?: { replace?: boolean }*/) {
    // if (!opts?.replace)
    this.undoHistoryIndex++;
    this.undoHistory.length = this.undoHistoryIndex;
    this.undoHistory.push(cmd);
  }

  private async applyCmd(cmd: t.SessionCmd) {
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
      case 'updateDuration':
        return this.applyUpdateDuration(cmd);

      default:
        throw new Error(`unknown cmd type: ${(cmd as any).type}`);
    }
  }

  private async unapplyCmd(cmd: t.SessionCmd) {
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
      case 'updateDuration':
        return this.unapplyUpdateDuration(cmd);
      default:
        throw new Error(`unknown cmd type: ${(cmd as any).type}`);
    }
  }

  private changed() {
    this.dirty = true;
    this.session.head.modificationTimestamp = new Date().toISOString();
    this.session.onChange?.();
  }
}
