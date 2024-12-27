import fs from 'fs';
import { getMp3Duration, getVideoDuration } from '../get_audio_video_duration.js';
import * as misc from '../misc.js';
import * as t from '../../lib/types.js';
import * as storage from '../storage.js';
import assert from '../../lib/assert.js';
import { Session } from './session.js';
import _ from 'lodash';
import { v4 as uuid } from 'uuid';
import { calcClockAfterRangeSpeedChange } from '../../lib/lib.js';
import { URI } from 'vscode-uri';
import * as path from 'path';

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

  undo(): t.SessionCmd[] {
    const cmds: t.SessionCmd[] = [];

    while (this.canUndo && this.undoHistory[this.undoHistoryIndex].coalescing) {
      cmds.push(this.undoHistory[this.undoHistoryIndex--]);
    }
    if (this.canUndo) {
      cmds.push(this.undoHistory[this.undoHistoryIndex--]);
    }

    for (const cmd of cmds) this.unapplyCmd(cmd);
    return cmds;
  }

  redo(): t.SessionCmd[] {
    const cmds: t.SessionCmd[] = [];

    while (this.canRedo && this.undoHistory[this.undoHistoryIndex + 1].coalescing) {
      cmds.push(this.undoHistory[++this.undoHistoryIndex]);
    }
    if (this.canRedo) {
      cmds.push(this.undoHistory[++this.undoHistoryIndex]);
    }

    for (const cmd of cmds) this.applyCmd(cmd);
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

  private unapplyInsertFocus(cmd: t.InsertFocusSessionCmd) {
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

  async insertAudioTrack(uri: string, clock: number): Promise<t.AudioTrack> {
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

    this.session.body.audioTracks.push(audioTrack);
    this.session.head.duration = Math.max(this.session.head.duration, audioTrack.clockRange.end);
    this.changed();
    return audioTrack;
  }

  deleteAudioTrack(id: string) {
    assert(this.session.isLoaded());
    const i = this.session.body.audioTracks.findIndex(t => t.id === id);
    if (i !== -1) this.session.body.audioTracks.splice(i, 1);
    this.changed();
  }

  updateAudioTrack(partial: Partial<t.AudioTrack>) {
    assert(this.session.isLoaded());
    const audioTrack = this.session.body.audioTracks.find(t => t.id == partial.id);
    if (!audioTrack) return;

    if (partial.title !== undefined) audioTrack.title = partial.title;
    if (partial.clockRange !== undefined) audioTrack.clockRange = partial.clockRange;
    this.changed();
  }

  async insertVideoTrack(uri: string, clock: number): Promise<t.VideoTrack> {
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

    this.session.body.videoTracks.push(videoTrack);
    this.session.head.duration = Math.max(this.session.head.duration, videoTrack.clockRange.end);
    this.changed();
    return videoTrack;
  }

  deleteVideoTrack(id: string) {
    assert(this.session.isLoaded());
    const i = this.session.body.videoTracks.findIndex(t => t.id === id);
    if (i !== -1) this.session.body.videoTracks.splice(i, 1);
    this.changed();
  }

  updateVideoTrack(partial: Partial<t.VideoTrack>) {
    assert(this.session.isLoaded());
    const videoTrack = this.session.body.videoTracks.find(t => t.id == partial.id);
    if (!videoTrack) return;

    if (partial.title !== undefined) videoTrack.title = partial.title;
    if (partial.clockRange !== undefined) videoTrack.clockRange = partial.clockRange;
    this.changed();
  }

  updateHead(partial: Partial<t.SessionHead>) {
    Object.assign(this.session.head, partial);
    this.changed();
  }

  updateFromUI(update: t.SessionUIStateUpdate) {
    if (update.workspace !== undefined) this.session.workspace = update.workspace;
    if (update.title !== undefined) this.session.head.title = update.title;
    if (update.description !== undefined) this.session.head.description = update.description;
    if (update.duration !== undefined) this.session.head.duration = update.duration;
    if (update.handle !== undefined) this.session.head.handle = update.handle;

    this.changed();
  }

  async setCover(uri: string) {
    // Copy file and set head.
    await fs.promises.copyFile(URI.parse(uri).fsPath, path.join(this.session.core.dataPath, 'cover'));
    this.session.head.hasCover = true;

    // Update cover cache.
    await this.session.context.cache.updateCoverFromLocal(this.session.head.id, this.session.core.dataPath);

    this.changed();
  }

  async deleteCover() {
    await fs.promises.rm(path.join(this.session.core.dataPath, 'cover'), { force: true });
    await this.session.context.cache.deleteCover(this.session.head.id);
    this.session.head.hasCover = false;
    this.changed();
  }

  async changeSpeed(range: t.ClockRange, factor: number) {
    assert(this.session.isLoaded());
    const { head, body } = this.session;

    // Update events.
    body.eventContainer.forEachExc(
      body.eventContainer.getIndexAfterClock(range.start),
      body.eventContainer.getSize(),
      (e, i) => {
        e.event.clock = calcClockAfterRangeSpeedChange(e.event.clock, range, factor);
      },
    );

    // Reindex the event container.
    body.eventContainer.reindexStableOrder();

    // Update focus timeline.
    for (const f of body.focusTimeline) {
      f.clock = calcClockAfterRangeSpeedChange(f.clock, range, factor);
    }

    // Update session duration.
    head.duration = calcClockAfterRangeSpeedChange(head.duration, range, factor);

    this.changed();
  }

  async merge(range: t.ClockRange) {
    await this.changeSpeed(range, Infinity);
  }

  insertGap(clock: number, dur: number) {
    assert(this.session.isLoaded());
    const { head, body } = this.session;

    // Update events.
    body.eventContainer.forEachExc(
      body.eventContainer.getIndexAfterClock(clock),
      body.eventContainer.getSize(),
      e => void (e.event.clock += dur),
    );

    // Reindex the event container.
    body.eventContainer.reindexStableOrder();

    // Update focus timeline.
    for (const f of body.focusTimeline) {
      if (f.clock > clock) f.clock += dur;
    }

    // Update session duration.
    head.duration += dur;

    this.changed();
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

  private insertSessionCmd(cmd: t.SessionCmd) {
    this.undoHistoryIndex++;
    this.undoHistory.length = this.undoHistoryIndex;
    this.undoHistory.push(cmd);
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
