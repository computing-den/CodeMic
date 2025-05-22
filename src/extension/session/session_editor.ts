import fs from 'fs';
import { getMp4MetaData, getMp3Duration } from '../get_media_metadata.js';
import * as misc from '../misc.js';
import * as t from '../../lib/types.js';
import assert from '../../lib/assert.js';
import { Session } from './session.js';
import _ from 'lodash';
import { v4 as uuid } from 'uuid';
import * as lib from '../../lib/lib.js';
import { URI } from 'vscode-uri';
import * as path from 'path';
import cache from '../cache.js';

const SAVE_TIMEOUT_MS = 5_000;

export default class SessionEditor {
  dirty = false;
  selection: t.RecorderSelection | undefined;

  private sessionSnapshots: t.SessionSnapshot[] = [];
  // The index of the last update whose effects are visible.
  private sessionSnapshotIndex: number = -1;

  constructor(public session: Session) {}

  /**
   * Disallows undoing the very first snapshot (initial events).
   */
  get canUndo(): boolean {
    return this.sessionSnapshotIndex > 0;
  }

  get canRedo(): boolean {
    return this.sessionSnapshotIndex < this.sessionSnapshots.length - 1;
  }

  undo(): t.SessionChange | undefined {
    if (!this.canUndo) return;

    const cur = this.sessionSnapshots[this.sessionSnapshotIndex];
    this.sessionSnapshotIndex--;
    const next = this.sessionSnapshots[this.sessionSnapshotIndex];

    this.applySessionSnapshot(next);
    return { cur, next, direction: t.Direction.Backwards, isTriggeredByUndoRedo: true };
  }

  redo(): t.SessionChange | undefined {
    if (!this.canRedo) return;

    const cur = this.sessionSnapshots[this.sessionSnapshotIndex];
    this.sessionSnapshotIndex++;
    const next = this.sessionSnapshots[this.sessionSnapshotIndex];
    this.applySessionSnapshot(next);
    return { cur, next, direction: t.Direction.Forwards, isTriggeredByUndoRedo: true };
  }

  initialize(body: t.SessionBody) {
    assert(!this.session.isLoaded());
    this.session.body = body;
    this.sessionSnapshotIndex = 0;
    this.sessionSnapshots = [{ head: this.session.head, body, effects: [] }];
  }

  setSelection(selection?: t.RecorderSelection) {
    this.selection = selection;
  }

  /**
   * Since selection is stored on the backend, updating the selection from the
   * frontend is an async operation. So when quickly selecting a region by
   * clicking and dragging the mouse, the mouse-move handler is called before
   * the initial click is handled and the selection updated. This will make it
   * hard to detect where the anchor should be. That's why we have the
   * extendSelection method which will not touch the anchor but only update the
   * focus.
   */
  extendSelection(clock: number) {
    if (this.selection?.type === 'editor') {
      this.selection.focus = clock;
    }
  }

  updateDetails(patch: t.SessionDetailsUpdate) {
    this.updateSessionDetailsDirectly(patch);
  }

  insertEvent(e: t.EditorEvent, opts: { coalescing: boolean }): number {
    assert(this.session.isLoaded());
    const i = lib.lastSortedIndex(this.session.body.editorEvents, e.clock, x => x.clock);
    const editorEvents = lib.spliceImmutable(this.session.body.editorEvents, i, 0, e);
    this.insertApplySessionPatch(
      { body: { editorEvents }, effects: [{ type: 'insertEditorEvent', event: e, index: i }] },
      opts,
    );
    return i;
  }

  insertScannedEvents(editorEvents: t.EditorEvent[]) {
    assert(this.session.isLoaded());
    assert(this.session.body.editorEvents.length === 0);
    assert(this.sessionSnapshots.length === 1, 'Editor must be just initialized before inserting scanned events');
    this.insertApplySessionPatch({ body: { editorEvents } }, { coalescing: true });
  }

  /**
   * Must not update clock of event.
   */
  updateEventAt(update: Partial<t.EditorEvent>, at: number) {
    assert(this.session.isLoaded());
    assert(!('clock' in update));

    const e = this.session.body.editorEvents[at];
    assert(e);

    const newEvent = { ...e, ...update } as t.EditorEvent;
    if (_.isEqual(e, newEvent)) return;

    this.insertApplySessionPatch(
      {
        body: { editorEvents: lib.spliceImmutable(this.session.body.editorEvents, at, 1, newEvent) },
        effects: [{ type: 'updateEditorEvent', eventBefore: e, eventAfter: newEvent, index: at }],
      },
      { coalescing: true },
    );
  }

  setFocus(focus: t.Focus, isDocumentEmpty: boolean) {
    assert(this.session.isLoaded());
    const lastFocusIndex = this.session.body.focusTimeline.length - 1;
    const lastFocus = this.session.body.focusTimeline[lastFocusIndex];

    // Try to update the last one. Otherwise, insert a new focus.
    if (
      lastFocus &&
      (focus.clock - lastFocus.clock < 1 || (lastFocus.uri === focus.uri && lastFocus.number === focus.number))
    ) {
      // In the last moment before closing an untitled document, we empty its content to avoid
      // the saving confirmation dialog. This must not affect the focus.
      if (isDocumentEmpty && URI.parse(focus.uri).scheme === 'untitled') return;

      const newFocus = { ...lastFocus, uri: focus.uri, number: focus.number, text: focus.text };
      if (!_.isEqual(lastFocus, newFocus)) {
        const focusTimeline = lib.spliceImmutable(this.session.body.focusTimeline, lastFocusIndex, 1, newFocus);
        this.insertApplySessionPatch({ body: { focusTimeline } }, { coalescing: true });
      }
    } else {
      const i = lib.lastSortedIndex(this.session.body.focusTimeline, focus.clock, x => x.clock);
      const focusTimeline = lib.spliceImmutable(this.session.body.focusTimeline, i, 0, focus);
      this.insertApplySessionPatch({ body: { focusTimeline } }, { coalescing: true });
    }
  }

  async insertAudioTrack(uri: string, clock: number): Promise<t.SessionChange> {
    assert(this.session.isLoaded());
    const fsPath = URI.parse(uri).fsPath;
    const data = await fs.promises.readFile(fsPath);
    const duration = getMp3Duration(data);
    const sha1 = await misc.computeSHA1(data);
    await this.session.core.copyToBlob(fsPath, sha1);
    const id = uuid();
    const audioTrack: t.AudioTrack = {
      id,
      type: 'audio',
      clockRange: { start: clock, end: clock + duration },
      file: { type: 'local', sha1: sha1 },
      title: path.basename(fsPath),
    };

    let { audioTracks } = this.session.body;
    audioTracks = lib.spliceImmutable(audioTracks, audioTracks.length, 0, audioTrack);
    const sessionDuration = Math.max(this.session.head.duration, audioTrack.clockRange.end);
    return this.insertApplySessionPatch({
      body: { audioTracks },
      head: { duration: sessionDuration },
      effects: [{ type: 'setSelection', after: { type: 'track', trackType: 'audio', id } }],
    });
  }

  deleteAudioTrack(id: string): t.SessionChange {
    assert(this.session.isLoaded());
    const audioTracks = this.session.body.audioTracks.filter(t => t.id !== id);
    return this.insertApplySessionPatch({
      body: { audioTracks },
      effects: [{ type: 'setSelection', before: { type: 'track', trackType: 'audio', id } }],
    });
  }

  updateAudioTrack(update: Partial<t.AudioTrack>): t.SessionChange | undefined {
    assert(this.session.isLoaded());
    assert(update.id);
    const audioTracks = this.session.body.audioTracks.map(t => (t.id === update.id ? { ...t, ...update } : t));
    if (_.isEqual(audioTracks, this.session.body.audioTracks)) return;
    return this.insertApplySessionPatch({
      body: { audioTracks },
      effects: [
        {
          type: 'setSelection',
          before: { type: 'track', trackType: 'audio', id: update.id },
          after: { type: 'track', trackType: 'audio', id: update.id },
        },
      ],
    });
  }

  async insertVideoTrack(uri: string, clock: number): Promise<t.SessionChange> {
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
    const id = uuid();
    const videoTrack: t.VideoTrack = {
      id,
      type: 'video',
      clockRange: { start: clock, end: clock + duration },
      file: { type: 'local', sha1: sha1 },
      title: path.basename(fsPath),
    };

    let { videoTracks } = this.session.body;
    videoTracks = lib.spliceImmutable(videoTracks, videoTracks.length, 0, videoTrack);
    const sessionDuration = Math.max(this.session.head.duration, videoTrack.clockRange.end);
    return this.insertApplySessionPatch({
      body: { videoTracks },
      head: { duration: sessionDuration },
      effects: [{ type: 'setSelection', after: { type: 'track', trackType: 'video', id } }],
    });
  }

  deleteVideoTrack(id: string): t.SessionChange {
    assert(this.session.isLoaded());
    const videoTracks = this.session.body.videoTracks.filter(t => t.id !== id);
    return this.insertApplySessionPatch({
      body: { videoTracks },
      effects: [{ type: 'setSelection', before: { type: 'track', trackType: 'video', id } }],
    });
  }

  updateVideoTrack(update: Partial<t.VideoTrack>): t.SessionChange | undefined {
    assert(this.session.isLoaded());
    assert(update.id);
    const videoTracks = this.session.body.videoTracks.map(t => (t.id === update.id ? { ...t, ...update } : t));
    if (_.isEqual(videoTracks, this.session.body.videoTracks)) return;
    return this.insertApplySessionPatch({
      body: { videoTracks },
      effects: [
        {
          type: 'setSelection',
          before: { type: 'track', trackType: 'video', id: update.id },
          after: { type: 'track', trackType: 'video', id: update.id },
        },
      ],
    });
  }

  updateDuration(duration: number, opts?: { coalescing?: boolean }) {
    this.insertApplySessionPatch({ head: { duration } }, opts);
  }

  async setCover(uri: string) {
    await fs.promises.copyFile(URI.parse(uri).fsPath, path.join(this.session.core.dataPath, 'cover'));
    await cache.copyCover(this.session.core.dataPath, this.session.head.id);
    this.updateSessionDetailsDirectly({ hasCover: true });
  }

  async deleteCover() {
    await fs.promises.rm(path.join(this.session.core.dataPath, 'cover'), { force: true });
    await cache.deleteCover(this.session.head.id);
    this.updateSessionDetailsDirectly({ hasCover: false });
  }

  changeSpeed(range: t.ClockRange, factor: number): t.SessionChange {
    assert(this.session.isLoaded());

    function withUpdatedClock<T extends { clock: number }>(x: T): T {
      return { ...x, clock: lib.calcClockAfterSpeedChange(x.clock, range, factor) };
    }

    const editorEvents = this.session.body.editorEvents.map(withUpdatedClock);
    const focusTimeline = this.session.body.focusTimeline.map(withUpdatedClock);
    const toc = this.session.head.toc.map(withUpdatedClock);
    const duration = lib.calcClockAfterSpeedChange(this.session.head.duration, range, factor);
    const inverse = lib.invertSpeedChange(range, factor);
    return this.insertApplySessionPatch({
      head: { toc, duration },
      body: { editorEvents, focusTimeline },
      effects: [
        { type: 'changeSpeed', range, factor, rrClock: this.session.rr.clock },
        {
          type: 'setSelection',
          before: { type: 'editor', anchor: range.start, focus: range.end },
          after: { type: 'editor', anchor: inverse.range.start, focus: inverse.range.end },
        },
      ],
    });
  }

  merge(range: t.ClockRange): t.SessionChange {
    assert(this.session.isLoaded());

    function withUpdatedClock<T extends { clock: number }>(x: T): T {
      return { ...x, clock: lib.calcClockAfterMerge(x.clock, range) };
    }

    const editorEvents = this.session.body.editorEvents.map(withUpdatedClock);
    const focusTimeline = this.session.body.focusTimeline.map(withUpdatedClock);
    const toc = this.session.head.toc.map(withUpdatedClock);
    const duration = lib.calcClockAfterMerge(this.session.head.duration, range);

    return this.insertApplySessionPatch({
      head: { toc, duration },
      body: { editorEvents, focusTimeline },
      effects: [
        { type: 'merge', range, rrClock: this.session.rr.clock },
        {
          type: 'setSelection',
          before: { type: 'editor', anchor: range.start, focus: range.end },
          after: { type: 'editor', anchor: range.start, focus: range.start },
        },
      ],
    });
  }

  insertGap(clock: number, gapDuration: number): t.SessionChange {
    assert(this.session.isLoaded());

    function withUpdatedClock<T extends { clock: number }>(x: T): T {
      return { ...x, clock: lib.calcClockAfterInsertGap(x.clock, clock, gapDuration) };
    }

    const editorEvents = this.session.body.editorEvents.map(withUpdatedClock);
    const focusTimeline = this.session.body.focusTimeline.map(withUpdatedClock);
    const toc = this.session.head.toc.map(withUpdatedClock);
    const duration = lib.calcClockAfterInsertGap(this.session.head.duration, clock, gapDuration);
    return this.insertApplySessionPatch({
      head: { toc, duration },
      body: { editorEvents, focusTimeline },
      effects: [
        { type: 'insertGap', clock, duration: gapDuration, rrClock: this.session.rr.clock },
        {
          type: 'setSelection',
          before: { type: 'editor', anchor: clock, focus: clock },
          after: { type: 'editor', anchor: clock, focus: clock + gapDuration },
        },
      ],
    });
  }

  insertChapter(clock: number, title: string): t.SessionChange {
    const item: t.TocItem = { clock: clock, title: title };
    const i = lib.lastSortedIndex(this.session.head.toc, clock, x => x.clock);
    const toc = lib.spliceImmutable(this.session.head.toc, i, 0, item);
    return this.insertApplySessionPatch({
      head: { toc },
      effects: [{ type: 'setSelection', after: { type: 'chapter', index: i } }],
    });
  }

  updateChapter(index: number, patch: Partial<t.TocItem>): t.SessionChange {
    assert(this.session.head.toc[index]);
    const chapter = { ...this.session.head.toc[index], ...patch };
    const toc = lib.spliceImmutable(this.session.head.toc, index, 1, chapter);
    return this.insertApplySessionPatch({
      head: { toc },
      effects: [{ type: 'setSelection', before: { type: 'chapter', index }, after: { type: 'chapter', index } }],
    });
  }

  deleteChapter(index: number): t.SessionChange {
    assert(this.session.head.toc[index]);
    const toc = lib.spliceImmutable(this.session.head.toc, index, 1);
    return this.insertApplySessionPatch({
      head: { toc },
      effects: [{ type: 'setSelection', before: { type: 'chapter', index } }],
    });
  }

  crop(clock: number): t.SessionChange {
    assert(this.session.isLoaded());

    function pred<T extends { clock: number }>(x: T): boolean {
      return x.clock < clock;
    }

    const [editorEvents, croppedEvents] = _.partition(this.session.body.editorEvents, pred);
    const focusTimeline = this.session.body.focusTimeline.filter(pred);
    const toc = this.session.head.toc.filter(pred);
    const duration = clock;

    return this.insertApplySessionPatch({
      head: { toc, duration },
      body: { editorEvents, focusTimeline },
      effects: [
        {
          type: 'cropEditorEvents',
          events: croppedEvents,
          index: editorEvents.length,
          clock,
          rrClock: this.session.rr.clock,
        },
        {
          type: 'setSelection',
          before: { type: 'editor', anchor: clock, focus: clock },
          after: { type: 'editor', anchor: clock, focus: clock },
        },
      ],
    });
  }

  /**
   * Called by Session.Core when session is saved.
   */
  saved() {
    this.dirty = false;
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
      // inside recorder and closing recorder calls write which cancels the
      // throttle queue.
      this.write({ ifDirty: true }).catch(console.error);
    },
    SAVE_TIMEOUT_MS,
    { leading: false },
  );

  finishEditing() {
    this.writeThrottled.cancel();
  }

  private insertApplySessionSnapshot(patch: t.SessionPatch, opts?: { coalescing?: boolean }): t.SessionChange {
    assert(this.session.isLoaded());
    const cur = this.sessionSnapshots[this.sessionSnapshotIndex];
    const next = this.createSessionSnapshot(patch);
    this.insertSessionSnapshot(next, opts);
    this.applySessionSnapshot(next);
    return { cur, next, direction: t.Direction.Forwards, isTriggeredByUndoRedo: false };
  }

  private insertApplySessionPatch(patch: t.SessionPatch, opts?: { coalescing?: boolean }): t.SessionChange {
    assert(this.session.isLoaded());
    return this.insertApplySessionSnapshot(this.createSessionSnapshot(patch), opts);
  }

  private insertSessionSnapshot(snapshot: t.SessionSnapshot, opts?: { coalescing?: boolean }) {
    assert(this.session.isLoaded());
    if (!opts?.coalescing || this.sessionSnapshotIndex === -1) {
      this.sessionSnapshotIndex++;
      this.sessionSnapshots.length = this.sessionSnapshotIndex;
      this.sessionSnapshots.push(snapshot);
    } else {
      // Merge snapshots.
      this.sessionSnapshots.length = this.sessionSnapshotIndex + 1;
      const old = this.sessionSnapshots[this.sessionSnapshotIndex];
      const effects = old.effects.concat(snapshot.effects);
      this.sessionSnapshots[this.sessionSnapshotIndex] = { ...snapshot, effects };
    }
  }

  private createSessionSnapshot(patch: t.SessionPatch): t.SessionSnapshot {
    assert(this.session.isLoaded());
    let body = this.session.body;
    if (patch.body) {
      body = { ...this.session.body, ...patch.body };
    }

    const head = {
      duration: patch.head?.duration ?? this.session.head.duration,
      modificationTimestamp: patch.head?.modificationTimestamp ?? this.session.head.modificationTimestamp,
      toc: patch.head?.toc ?? this.session.head.toc,
    };

    const effects = patch.effects ?? [];

    return { head, body, effects };
  }

  private applySessionSnapshot(snapshot: t.SessionSnapshot) {
    assert(this.session.isLoaded());
    this.session.head = { ...this.session.head, ...snapshot.head, modificationTimestamp: new Date().toISOString() };
    this.session.body = snapshot.body;
    this.dirty = true;
    this.session.onChange?.();
  }

  private updateSessionDetailsDirectly(patch: Partial<t.SessionHead> & { workspace?: string }) {
    const { workspace, ...head } = patch;
    if (workspace !== undefined) this.session.workspace = workspace;
    this.session.head = { ...this.session.head, ...head, modificationTimestamp: new Date().toISOString() };
    this.dirty = true;
    this.session.onChange?.();
  }
}
