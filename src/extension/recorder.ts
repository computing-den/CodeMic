import * as t from '../lib/types.js';
import * as path from '../lib/path.js';
import { getMp3Duration, getVideoDuration } from './get_audio_video_duration.js';
import * as misc from './misc.js';
import type Session from './session/session.js';
import type SessionRuntime from './session/session_runtime.js';
import _ from 'lodash';
import assert from 'assert';
import fs from 'fs';
import { v4 as uuid } from 'uuid';

class Recorder {
  tabId: t.RecorderTabId = 'details-view';

  constructor(public session: Session, public mustScan: boolean) {}

  get runtime(): SessionRuntime | undefined {
    return this.session.runtime;
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
    this.initRuntimesHandlers();
  }

  initRuntimesHandlers() {
    assert(this.runtime);
    this.runtime.onChangeOrProgress = this.runtimeChangeOrProgressHandler.bind(this);
    this.runtime.onChange = this.runtimeChangeHandler.bind(this);
    this.runtime.onError = this.runtimeErrorHandler.bind(this);
  }

  runtimeChangeOrProgressHandler() {
    this.session.context.updateFrontend?.();
  }

  runtimeChangeHandler() {
    this.dirty = true;
  }

  runtimeErrorHandler(error: Error) {
    // TODO show error to user
    console.error(error);
  }

  async record() {
    assert(this.runtime);
    if (this.runtime.clock !== this.session.head.duration) {
      // await this.session.runtime!.workspacePlayer.seek(this.session.head.duration);
      await this.runtime.seek(this.session.head.duration, { noUpdate: false });
      // await new Promise(resolve => setTimeout(resolve, 3000));
    }
    await this.runtime.record();
    this.saveHistoryOpenClose().catch(console.error);
  }

  async play() {
    assert(this.runtime);
    await this.runtime.play();
    this.saveHistoryOpenClose().catch(console.error);
  }

  pause() {
    assert(this.runtime);
    this.runtime.pause();
  }

  seek(clock: number) {
    assert(this.runtime);
    this.runtime.seek(clock);
  }

  dispose() {
    // this.runtime.dispose();
  }

  isSessionEmpty(): boolean {
    return Boolean(
      this.session.runtime?.internalWorkspace.eventContainer.isEmpty() &&
        this.session.runtime?.audioTrackCtrls.length === 0,
    );
  }

  updateState(changes: t.RecorderUpdate) {
    if (changes.title !== undefined) this.session.head.title = changes.title;
    if (changes.description !== undefined) this.session.head.description = changes.description;
    // if (changes.clock !== undefined) this.sessionHead.duration = this.runtime.clock = changes.clock;
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
    assert(this.runtime);
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
    this.runtime.insertAudioAndLoad(audioTrack);

    this.dirty = true;
  }

  async deleteAudio(id: string) {
    assert(this.runtime);
    this.runtime.deleteAudio(id);
    this.dirty = true;
  }

  async updateAudio(audio: Partial<t.AudioTrack>) {
    assert(this.session.runtime);
    const trackCtrl = this.session.runtime.audioTrackCtrls.find(c => c.audioTrack.id === audio.id);
    if (trackCtrl) Object.assign(trackCtrl.audioTrack, audio);
    this.dirty = true;
  }

  async insertVideo(uri: t.Uri, clock: number) {
    assert(this.runtime);
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
    this.runtime.insertVideoAndLoad(videoTrack);
    this.dirty = true;
  }

  async deleteVideo(id: string) {
    assert(this.runtime);
    this.runtime.deleteVideo(id);
    this.dirty = true;
  }

  async updateVideo(video: Partial<t.VideoTrack>) {
    assert(this.session.runtime);
    const track = this.session.runtime.videoTracks.find(t => t.id === video.id);
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
