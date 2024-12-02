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

  constructor(public session: Session) {}

  // isSessionBodyEmpty(): boolean {
  //   if (!this.session.isLoaded()) return true;
  //   return Boolean(
  //     this.session.body.eventContainer.isEmpty() &&
  //       this.session.body.audioTracks.length === 0 &&
  //       this.session.body.videoTracks.length === 0,
  //   );
  // }

  insertEvents(events: t.EditorEventWithUri[]) {
    assert(this.session.isLoaded());
    this.session.body.eventContainer.insertMany(events);
    this.changed();
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

  private changed() {
    this.dirty = true;
    this.session.head.modificationTimestamp = new Date().toISOString();
    this.session.onChange?.();
  }
}
