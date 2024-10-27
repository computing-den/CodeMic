import * as t from '../lib/types.js';
import * as path from '../lib/path.js';
import { getMp3Duration, getVideoDuration } from './get_audio_video_duration.js';
import * as misc from './misc.js';
import type { SessionCtrls } from './types.js';
import type Session from './session/session.js';
import type SessionRuntime from './session/session_runtime.js';
import _ from 'lodash';
import assert from 'assert';
import fs from 'fs';
import { v4 as uuid } from 'uuid';

class Recorder {
  tabId: t.RecorderTabId = 'details-view';

  constructor(public session: Session, public mustScan: boolean) {}

  get sessionRuntime(): SessionRuntime | undefined {
    return this.session.ctrls?.sessionRuntime;
  }

  dirty: boolean = false;

  // private lastSavedClock: number;

  async load(options?: { seekClock?: number; cutClock?: number }) {
    // let clock = setup.sessionHead.duration;
    // if (setup.fork) {
    //   clock = setup.fork.clock;
    //   assert(setup.baseSessionHead);
    //   await db.copySessionDir(setup.baseSessionHead, setup.sessionHead);
    // }

    if (this.mustScan) {
      await this.session.scan();
      this.mustScan = false;
    } else {
      await this.session.load(options);
    }
    await this.save(); // session may have changed due to options.cutClock and must be saved.
    this.initSessionRuntimesHandlers();
  }

  initSessionRuntimesHandlers() {
    assert(this.sessionRuntime);
    this.sessionRuntime.onChangeOrProgress = this.sessionCtrlChangeOrProgressHandler.bind(this);
    this.sessionRuntime.onChange = this.sessionCtrlChangeHandler.bind(this);
    this.sessionRuntime.onError = this.sessionCtrlErrorHandler.bind(this);
  }

  sessionCtrlChangeOrProgressHandler() {
    this.session.context.updateFrontend?.();
  }

  sessionCtrlChangeHandler() {
    this.dirty = true;
  }

  sessionCtrlErrorHandler(error: Error) {
    // TODO show error to user
    console.error(error);
  }

  async record() {
    assert(this.sessionRuntime);
    if (this.sessionRuntime.clock !== this.session.head.duration) {
      // await this.session.ctrls!.workspacePlayer.seek(this.session.head.duration);
      // this.session.ctrls?.internalWorkspace.
      await this.sessionRuntime.seek(this.session.head.duration, { noUpdate: false });
      // await new Promise(resolve => setTimeout(resolve, 3000));
    }
    await this.sessionRuntime.record();
    this.saveHistoryOpenClose().catch(console.error);
  }

  async play() {
    assert(this.sessionRuntime);
    await this.sessionRuntime.play();
    this.saveHistoryOpenClose().catch(console.error);
  }

  pause() {
    assert(this.sessionRuntime);
    this.sessionRuntime.pause();
  }

  seek(clock: number) {
    assert(this.sessionRuntime);
    this.sessionRuntime.seek(clock);
  }

  dispose() {
    // this.sessionRuntime.dispose();
  }

  isSessionEmpty(): boolean {
    return this.session.body?.editorTrack.events.length === 0 && this.session.ctrls?.audioTrackCtrls.length === 0;
  }

  updateState(changes: t.RecorderUpdate) {
    if (changes.title !== undefined) this.session.head.title = changes.title;
    if (changes.description !== undefined) this.session.head.description = changes.description;
    // if (changes.clock !== undefined) this.sessionHead.duration = this.sessionRuntime.clock = changes.clock;
    if (changes.workspace !== undefined)
      throw new Error('Recorder.updateState cannot change workspace after initialization');
    if (changes.duration) this.session.head.duration = changes.duration;

    this.dirty = true;
  }

  /**
   * May be called without pause().
   */
  async save() {
    this.session.head.modificationTimestamp = new Date().toISOString();
    await this.session.write();
    await this.saveHistoryOpenClose();
    this.dirty = false;
  }

  async insertAudio(uri: t.Uri, clock: number) {
    assert(this.sessionRuntime);
    const absPath = path.getFileUriPath(uri);
    const data = await fs.promises.readFile(absPath);
    const duration = getMp3Duration(data);
    const sha1 = await misc.computeSHA1(data);
    await this.session.copyToBlob(absPath, sha1);
    const audioTrack: t.AudioTrack = {
      id: uuid(),
      type: 'audio',
      clockRange: { start: clock, end: clock + duration },
      file: { type: 'local', sha1: sha1 },
      title: path.basename(absPath, { omitExt: true }),
    };
    this.sessionRuntime.insertAudioAndLoad(audioTrack);

    this.dirty = true;
  }

  async deleteAudio(id: string) {
    assert(this.sessionRuntime);
    this.sessionRuntime.deleteAudio(id);
    this.dirty = true;
  }

  async updateAudio(audio: Partial<t.AudioTrack>) {
    assert(this.session.body);
    const track = this.session.body.audioTracks.find(t => t.id === audio.id);
    if (track) Object.assign(track, audio);
    this.dirty = true;
  }

  async insertVideo(uri: t.Uri, clock: number) {
    assert(this.sessionRuntime);
    const absPath = path.getFileUriPath(uri);
    const data = await fs.promises.readFile(absPath);
    const duration = getVideoDuration(data);
    const sha1 = await misc.computeSHA1(data);
    await this.session.copyToBlob(absPath, sha1);
    const videoTrack: t.VideoTrack = {
      id: uuid(),
      type: 'video',
      clockRange: { start: clock, end: clock + duration },
      file: { type: 'local', sha1: sha1 },
      title: path.basename(absPath, { omitExt: true }),
    };
    this.sessionRuntime.insertVideoAndLoad(videoTrack);
    this.dirty = true;
  }

  async deleteVideo(id: string) {
    assert(this.sessionRuntime);
    this.sessionRuntime.deleteVideo(id);
    this.dirty = true;
  }

  async updateVideo(video: Partial<t.VideoTrack>) {
    assert(this.session.body);
    const track = this.session.body.videoTracks.find(t => t.id === video.id);
    if (track) Object.assign(track, video);
    this.dirty = true;
  }

  async setCoverPhoto(uri: t.Uri) {
    await fs.promises.copyFile(path.getFileUriPath(uri), this.session.sessionDataPaths.coverPhoto);
    this.session.head.hasCoverPhoto = true;
    this.dirty = true;
  }

  async deleteCoverPhoto() {
    await fs.promises.rm(this.session.sessionDataPaths.coverPhoto, { force: true });
    this.session.head.hasCoverPhoto = false;
    this.dirty = true;
  }

  private async saveHistoryOpenClose() {
    await this.session.writeHistory(history => ({
      ...history,
      lastRecordedTimestamp: new Date().toISOString(),
      workspace: this.session.workspace,
    }));
  }
}

export default Recorder;
