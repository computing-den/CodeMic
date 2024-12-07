import fs from 'fs';
import { getMp3Duration, getVideoDuration } from '../get_audio_video_duration.js';
import * as misc from '../misc.js';
import * as path from '../../lib/path.js';
import * as t from '../../lib/types.js';
import assert from '../../lib/assert.js';
import { Session, LoadedSession } from './session.js';
import _ from 'lodash';
import { v4 as uuid } from 'uuid';
import { calcClockAfterRangeSpeedChange } from '../../lib/lib.js';

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

  undo(): t.SessionCmd | undefined {
    if (this.canUndo) {
      const cmd = this.undoHistory[this.undoHistoryIndex];
      this.unapplyCmd(cmd);
      this.undoHistoryIndex--;
      return cmd;
    }
  }

  redo(): t.SessionCmd | undefined {
    if (this.canRedo) {
      this.undoHistoryIndex++;
      const cmd = this.undoHistory[this.undoHistoryIndex];
      this.applyCmd(cmd);
      return cmd;
    }
  }

  /**
   * Will not add to undo list.
   */
  insertInitialEvents(events: t.EditorEventWithUri[]) {
    assert(this.session.isLoaded());
    this.session.body.eventContainer.insertMany(events);
    this.changed();
  }

  insertEvent(uri: t.Uri, e: t.EditorEvent): t.SessionCmd {
    assert(this.session.isLoaded());
    const i = this.session.body.eventContainer.getIndexAfterClock(e.clock);
    const cmd: t.InsertEventSessionCmd = { type: 'insertEvent', index: i, uri, event: e };
    this.applyInsertEvent(cmd);
    this.insertSessionCmd(cmd);
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

  updateEvent<T extends t.EditorEvent>(uri: t.Uri, e: T, update: Partial<T>): t.SessionCmd {
    assert(this.session.isLoaded());
    const i = this.session.body.eventContainer.indexOfEvent(e);
    const cmd: t.UpdateEventSessionCmd = {
      type: 'updateEvent',
      index: i,
      uri,
      update,
      revUpdate: _.pick(e, _.keys(update)),
    };
    this.applyUpdateEvent(cmd);
    this.insertSessionCmd(cmd);
    return cmd;
  }

  private applyUpdateEvent(cmd: t.UpdateEventSessionCmd) {
    assert(this.session.isLoaded());
    const e = this.session.body.eventContainer.at(cmd.index);
    assert(e);
    Object.assign(e.event, cmd.update);
  }

  private unapplyUpdateEvent(cmd: t.UpdateEventSessionCmd) {
    assert(this.session.isLoaded());
    const e = this.session.body.eventContainer.at(cmd.index);
    assert(e);
    Object.assign(e.event, cmd.revUpdate);
  }

  insertLineFocus(lineFocus: t.LineFocus): t.SessionCmd {
    assert(this.session.isLoaded());
    const cmd: t.InsertLineFocusSessionCmd = { type: 'insertLineFocus', lineFocus };
    this.applyInsertLineFocus(cmd);
    this.insertSessionCmd(cmd);
    return cmd;
  }

  private applyInsertLineFocus(cmd: t.InsertLineFocusSessionCmd) {
    assert(this.session.isLoaded());
    this.session.body.focusTimeline.lines.push(cmd.lineFocus);
  }

  private unapplyInsertLineFocus(cmd: t.InsertLineFocusSessionCmd) {
    assert(this.session.isLoaded());
    this.session.body.focusTimeline.lines.pop();
  }

  updateLineFocusAt(i: number, update: Partial<t.LineFocus>): t.SessionCmd {
    assert(this.session.isLoaded());
    const lineFocus = this.session.body.focusTimeline.lines.at(i);
    assert(lineFocus);
    const cmd: t.UpdateLineFocusSessionCmd = {
      type: 'updateLineFocus',
      index: i,
      update,
      revUpdate: _.pick(lineFocus, _.keys(update)),
    };
    this.applyUpdateLineFocus(cmd);
    this.insertSessionCmd(cmd);
    return cmd;
  }

  private applyUpdateLineFocus(cmd: t.UpdateLineFocusSessionCmd) {
    assert(this.session.isLoaded());
    Object.assign(this.session.body.focusTimeline.lines[cmd.index], cmd.update);
  }

  private unapplyUpdateLineFocus(cmd: t.UpdateLineFocusSessionCmd) {
    assert(this.session.isLoaded());
    Object.assign(this.session.body.focusTimeline.lines[cmd.index], cmd.revUpdate);
  }

  deleteLineFocusAt(i: number): t.SessionCmd {
    assert(this.session.isLoaded());
    const lineFocus = this.session.body.focusTimeline.lines.at(i);
    assert(lineFocus);
    const cmd: t.DeleteLineFocusSessionCmd = { type: 'deleteLineFocus', index: i, lineFocus };
    this.applyDeleteLineFocus(cmd);
    this.insertSessionCmd(cmd);
    return cmd;
  }

  private applyDeleteLineFocus(cmd: t.DeleteLineFocusSessionCmd) {
    assert(this.session.isLoaded());
    this.session.body.focusTimeline.lines.splice(cmd.index, 1);
  }

  private unapplyDeleteLineFocus(cmd: t.DeleteLineFocusSessionCmd) {
    assert(this.session.isLoaded());
    this.session.body.focusTimeline.lines.splice(cmd.index, 0, cmd.lineFocus);
  }

  insertDocumentFocus(documentFocus: t.DocumentFocus): t.SessionCmd {
    assert(this.session.isLoaded());
    const cmd: t.InsertDocumentFocusSessionCmd = { type: 'insertDocumentFocus', documentFocus };
    this.applyInsertDocumentFocus(cmd);
    this.insertSessionCmd(cmd);
    return cmd;
  }

  private applyInsertDocumentFocus(cmd: t.InsertDocumentFocusSessionCmd) {
    assert(this.session.isLoaded());
    this.session.body.focusTimeline.documents.push(cmd.documentFocus);
  }

  private unapplyInsertDocumentFocus(cmd: t.InsertDocumentFocusSessionCmd) {
    assert(this.session.isLoaded());
    this.session.body.focusTimeline.documents.pop();
  }

  updateDocumentFocusAt(i: number, update: Partial<t.DocumentFocus>): t.SessionCmd {
    assert(this.session.isLoaded());
    const documentFocus = this.session.body.focusTimeline.documents.at(i);
    assert(documentFocus);
    const cmd: t.UpdateDocumentFocusSessionCmd = {
      type: 'updateDocumentFocus',
      index: i,
      update,
      revUpdate: _.pick(documentFocus, _.keys(update)),
    };
    this.applyUpdateDocumentFocus(cmd);
    this.insertSessionCmd(cmd);
    return cmd;
  }

  private applyUpdateDocumentFocus(cmd: t.UpdateDocumentFocusSessionCmd) {
    assert(this.session.isLoaded());
    Object.assign(this.session.body.focusTimeline.documents[cmd.index], cmd.update);
  }

  private unapplyUpdateDocumentFocus(cmd: t.UpdateDocumentFocusSessionCmd) {
    assert(this.session.isLoaded());
    Object.assign(this.session.body.focusTimeline.documents[cmd.index], cmd.revUpdate);
  }

  deleteDocumentFocusAt(i: number): t.SessionCmd {
    assert(this.session.isLoaded());
    const documentFocus = this.session.body.focusTimeline.documents.at(i);
    assert(documentFocus);
    const cmd: t.DeleteDocumentFocusSessionCmd = { type: 'deleteDocumentFocus', index: i, documentFocus };
    this.applyDeleteDocumentFocus(cmd);
    this.insertSessionCmd(cmd);
    return cmd;
  }

  private applyDeleteDocumentFocus(cmd: t.DeleteDocumentFocusSessionCmd) {
    assert(this.session.isLoaded());
    this.session.body.focusTimeline.documents.splice(cmd.index, 1);
  }

  private unapplyDeleteDocumentFocus(cmd: t.DeleteDocumentFocusSessionCmd) {
    assert(this.session.isLoaded());
    this.session.body.focusTimeline.documents.splice(cmd.index, 0, cmd.documentFocus);
  }

  async insertAudioTrack(uri: t.Uri, clock: number): Promise<t.AudioTrack> {
    assert(this.session.isLoaded());
    const absPath = path.getFileUriPath(uri);
    const data = await fs.promises.readFile(absPath);
    const duration = getMp3Duration(data);
    const sha1 = await misc.computeSHA1(data);
    await this.session.core.copyToBlob(absPath, sha1);
    const audioTrack: t.AudioTrack = {
      id: uuid(),
      type: 'audio',
      clockRange: { start: clock, end: clock + duration },
      file: { type: 'local', sha1: sha1 },
      title: path.basename(absPath, { omitExt: true }),
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

  async insertVideoTrack(uri: t.Uri, clock: number): Promise<t.VideoTrack> {
    assert(this.session.isLoaded());
    const absPath = path.getFileUriPath(uri);
    const data = await fs.promises.readFile(absPath);
    const duration = getVideoDuration(data);
    const sha1 = await misc.computeSHA1(data);
    await this.session.core.copyToBlob(absPath, sha1);
    const videoTrack: t.VideoTrack = {
      id: uuid(),
      type: 'video',
      clockRange: { start: clock, end: clock + duration },
      file: { type: 'local', sha1: sha1 },
      title: path.basename(absPath, { omitExt: true }),
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
    if (partial.title !== undefined) this.session.head.title = partial.title;
    if (partial.handle !== undefined) this.session.head.handle = partial.handle;
    if (partial.description !== undefined) this.session.head.description = partial.description;
    if (partial.duration) this.session.head.duration = partial.duration;

    this.changed();
  }

  async setCoverPhoto(uri: t.Uri) {
    await fs.promises.copyFile(path.getFileUriPath(uri), path.abs(this.session.core.sessionDataPath, 'cover_photo'));
    this.session.head.hasCoverPhoto = true;
    this.changed();
  }

  async deleteCoverPhoto() {
    await fs.promises.rm(path.abs(this.session.core.sessionDataPath, 'cover_photo'), { force: true });
    this.session.head.hasCoverPhoto = false;
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
    for (const focusItems of [body.focusTimeline.documents, body.focusTimeline.lines]) {
      for (const f of focusItems) {
        f.clockRange.start = calcClockAfterRangeSpeedChange(f.clockRange.start, range, factor);
        f.clockRange.end = calcClockAfterRangeSpeedChange(f.clockRange.end, range, factor);
      }
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
    for (const focusItems of [body.focusTimeline.documents, body.focusTimeline.lines]) {
      for (const f of focusItems) {
        if (f.clockRange.start > clock) f.clockRange.start += dur;
        if (f.clockRange.end > clock) f.clockRange.end += dur;
      }
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
  }

  saved() {
    this.dirty = false;
    this.session.onChange?.();
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
      case 'updateEvent':
        return this.applyUpdateEvent(cmd);
      case 'insertLineFocus':
        return this.applyInsertLineFocus(cmd);
      case 'updateLineFocus':
        return this.applyUpdateLineFocus(cmd);
      case 'deleteLineFocus':
        return this.applyDeleteLineFocus(cmd);
      case 'insertDocumentFocus':
        return this.applyInsertDocumentFocus(cmd);
      case 'updateDocumentFocus':
        return this.applyUpdateDocumentFocus(cmd);
      case 'deleteDocumentFocus':
        return this.applyDeleteDocumentFocus(cmd);
      default:
        throw new Error(`unknown cmd type: ${(cmd as any).type}`);
    }
  }

  private unapplyCmd(cmd: t.SessionCmd) {
    switch (cmd.type) {
      case 'insertEvent':
        return this.unapplyInsertEvent(cmd);
      case 'updateEvent':
        return this.unapplyUpdateEvent(cmd);
      case 'insertLineFocus':
        return this.unapplyInsertLineFocus(cmd);
      case 'updateLineFocus':
        return this.unapplyUpdateLineFocus(cmd);
      case 'deleteLineFocus':
        return this.unapplyDeleteLineFocus(cmd);
      case 'insertDocumentFocus':
        return this.unapplyInsertDocumentFocus(cmd);
      case 'updateDocumentFocus':
        return this.unapplyUpdateDocumentFocus(cmd);
      case 'deleteDocumentFocus':
        return this.unapplyDeleteDocumentFocus(cmd);
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
