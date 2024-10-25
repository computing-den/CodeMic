import * as t from '../../lib/types.js';
import * as lib from '../../lib/lib.js';
import assert from '../../lib/assert.js';
import type { Session } from './session.js';
import config from '../config.js';
import type { SessionCtrls } from '../types.js';
import AudioTrackCtrl from './audio_track_ctrl.js';
import _ from 'lodash';

export enum SessionTracksCtrlStatus {
  Init,
  Error,
  Running,
  Paused,
}

export type SessionTracksCtrlMode = {
  status: SessionTracksCtrlStatus;
  recordingEditor: boolean;
};

export default class SessionTracksCtrl {
  clock = 0;
  mode: SessionTracksCtrlMode = {
    status: SessionTracksCtrlStatus.Init,
    recordingEditor: false,
  };

  onChangeOrProgress?: () => any;
  onChange?: () => any;
  onError?: (error: Error) => any;

  private session: Session;
  private timeout: any;
  private timeoutTimestamp = 0;

  get running(): boolean {
    return this.mode.status === SessionTracksCtrlStatus.Running;
  }

  get ctrls(): SessionCtrls {
    return this.session.ctrls!;
  }

  get videoTracks(): t.VideoTrack[] {
    return this.session.body!.videoTracks;
  }

  constructor(session: Session) {
    this.session = session;
  }

  init() {
    for (const c of this.ctrls.audioTrackCtrls) this.initAudioCtrl(c);
    this.initVideoCtrl();
    this.ctrls.combinedEditorTrackPlayer.onError = this.gotError.bind(this);
    this.ctrls.combinedEditorTrackRecorder.onChange = this.combinedEditorTrackRecorderChangeHandler.bind(this);
    this.ctrls.combinedEditorTrackRecorder.onError = this.gotError.bind(this);
  }

  load() {
    // Load media tracks so that they're ready to play when they come into range.
    for (const c of this.ctrls.audioTrackCtrls) c.load();

    const videoTrack = this.findInRangeVideoTrack();
    if (videoTrack) this.ctrls.videoTrackCtrl.loadTrack(videoTrack);
  }

  async play() {
    assert(!this.running);

    this.mode.recordingEditor = false;
    this.mode.status = SessionTracksCtrlStatus.Running;

    if (this.isAlmostAtTheEnd()) {
      this.seek(0, { noUpdate: true });
    }

    await this.ctrls.combinedEditorTrackPlayer.play();
    this.update();
  }

  async record() {
    assert(!this.running);

    assert(this.clock === this.session.head.duration);

    this.mode.recordingEditor = true;
    this.mode.status = SessionTracksCtrlStatus.Running;

    await this.ctrls.combinedEditorTrackRecorder.record();

    this.update();
  }

  pause() {
    this.clearTimeout();
    this.mode.status = SessionTracksCtrlStatus.Paused;
    this.pauseAudios();
    this.pauseVideo();
    this.pauseEditor();
  }

  /**
   * If in recorder mode, it will pause and switch to player mode.
   */
  async seek(clock: number, options?: { noUpdate: boolean }) {
    const noUpdate = options?.noUpdate ?? false;

    if (this.mode.recordingEditor) {
      this.pause();
      this.mode.recordingEditor = false;
    }

    this.clock = clock;
    this.seekInRangeAudios();
    this.loadInRangeVideoAndSeek();
    await this.seekEditor();

    if (!noUpdate) await this.update(); // Will clear previous timeouts.
  }

  insertAudioAndLoad(audioTrack: t.AudioTrack) {
    const audioTrackCtrl = new AudioTrackCtrl(this.session, audioTrack);
    this.session.head.duration = Math.max(this.session.head.duration, audioTrack.clockRange.end);
    this.session.body!.audioTracks.push(audioTrack);
    this.ctrls.audioTrackCtrls.push(audioTrackCtrl);
    this.initAudioCtrl(audioTrackCtrl);
    this.onChange?.();
  }

  deleteAudio(id: string) {
    const i = this.ctrls.audioTrackCtrls.findIndex(c => c.audioTrack.id === id);
    if (i === -1) {
      console.error(`SessionTracksCtrl deleteAudio did not find audio track with id ${id}`);
      return;
    }

    const j = this.session.body!.audioTracks.findIndex(t => t.id === id);
    if (j !== -1) {
      this.session.body!.audioTracks.splice(j, 1);
    }

    this.ctrls.audioTrackCtrls[i].pause();
    this.ctrls.audioTrackCtrls.splice(i, 1);
    this.onChange?.();
  }

  insertVideoAndLoad(videoTrack: t.VideoTrack) {
    // const videoTrackCtrl = new VideoTrackCtrl(this.session, videoTrack);
    this.session.head.duration = Math.max(this.session.head.duration, videoTrack.clockRange.end);
    this.session.body!.videoTracks.push(videoTrack);
    // this.ctrls.videoTrackCtrl.insert(videoTrackCtrl);
    this.initVideoCtrl();
    this.onChange?.();
  }

  deleteVideo(id: string) {
    const j = this.session.body!.videoTracks.findIndex(t => t.id === id);
    if (j !== -1) {
      this.session.body!.videoTracks.splice(j, 1);
    }

    this.ctrls.videoTrackCtrl.pause();
    this.onChange?.();
  }

  handleFrontendAudioEvent(e: t.FrontendMediaEvent) {
    const audioCtrl = this.ctrls.audioTrackCtrls.find(a => a.audioTrack.id === e.id);
    if (audioCtrl) {
      audioCtrl.handleAudioEvent(e);
    } else {
      console.error(`handleFrontendAudioEvent audio track player with id ${e.id} not found`);
    }
  }

  handleFrontendVideoEvent(e: t.FrontendMediaEvent) {
    this.ctrls.videoTrackCtrl.handleVideoEvent(e);
  }

  private initAudioCtrl(c: AudioTrackCtrl) {
    c.onError = this.gotError.bind(this);
  }

  private initVideoCtrl() {
    this.ctrls.videoTrackCtrl.onError = this.gotError.bind(this);
  }

  private async seekEditor() {
    this.ctrls.combinedEditorTrackRecorder.setClock(this.clock);

    if (this.mode.recordingEditor) {
      this.ctrls.combinedEditorTrackPlayer.setClock(this.clock);
    } else {
      await this.ctrls.combinedEditorTrackPlayer.seek(this.clock);
    }
  }

  private pauseEditor() {
    if (this.mode.recordingEditor) {
      this.ctrls.combinedEditorTrackRecorder.pause();
    } else {
      this.ctrls.combinedEditorTrackPlayer.pause();
    }
  }

  private seekInRangeAudios() {
    for (const c of this.ctrls.audioTrackCtrls) {
      if (this.isTrackInRange(c.audioTrack)) this.seekAudio(c);
    }
  }

  private seekInRangeAudiosThatAreNotRunning() {
    for (const c of this.ctrls.audioTrackCtrls) {
      if (!c.running && this.isTrackInRange(c.audioTrack)) this.seekAudio(c);
    }
  }

  private seekAudio(c: AudioTrackCtrl) {
    c.seek(this.globalClockToTrackLocal(c.audioTrack));
  }

  private playInRangeAudios() {
    for (const c of this.ctrls.audioTrackCtrls) {
      if (!c.running && this.isTrackInRange(c.audioTrack)) c.play();
    }
  }

  private pauseAudios() {
    for (const c of this.ctrls.audioTrackCtrls) {
      if (c.running) c.pause();
    }
  }

  private pauseOutOfRangeAudios() {
    for (const c of this.ctrls.audioTrackCtrls) {
      if (c.running && !this.isTrackInRange(c.audioTrack)) c.pause();
    }
  }

  private stopOutOfRangeVideo() {
    const c = this.ctrls.videoTrackCtrl;
    if (c.videoTrack && !this.isTrackInRange(c.videoTrack)) c.stop();
  }

  private pauseVideo() {
    this.ctrls.videoTrackCtrl.pause();
  }

  private loadInRangeVideoAndSeek() {
    const videoTrack = this.findInRangeVideoTrack();
    if (videoTrack) {
      this.ctrls.videoTrackCtrl.loadTrack(videoTrack);
      this.ctrls.videoTrackCtrl.seek(this.globalClockToTrackLocal(videoTrack));
    }
  }

  private loadInRangeVideoAndSeekIfDifferent() {
    const videoTrack = this.findInRangeVideoTrack();
    // console.log('loadInRangeVideoAndSeekIfDifferent videoTrack', videoTrack);
    if (videoTrack && (this.ctrls.videoTrackCtrl.videoTrack !== videoTrack || !this.ctrls.videoTrackCtrl.running)) {
      this.ctrls.videoTrackCtrl.loadTrack(videoTrack);
      this.ctrls.videoTrackCtrl.seek(this.globalClockToTrackLocal(videoTrack));
    }
  }

  private findInRangeVideoTrack(): t.VideoTrack | undefined {
    return _.findLast(this.videoTracks, t => this.isTrackInRange(t));
  }

  private playInRangeVideo() {
    if (
      !this.ctrls.videoTrackCtrl.running &&
      this.ctrls.videoTrackCtrl.videoTrack &&
      this.isTrackInRange(this.ctrls.videoTrackCtrl.videoTrack)
    ) {
      this.ctrls.videoTrackCtrl.play();
    }
  }

  private clearTimeout() {
    clearTimeout(this.timeout);
    this.timeout = 0;
  }

  private isAlmostAtTheEnd() {
    return this.clock > this.session.head.duration - 1;
  }

  private isTrackInRange(t: t.RangedTrack): boolean {
    return lib.isClockInRange(this.clock, t.clockRange);
  }

  private globalClockToTrackLocal(t: t.RangedTrack): number {
    return lib.clockToLocal(this.clock, t.clockRange);
  }

  private combinedEditorTrackRecorderChangeHandler() {
    this.onChange?.();
    this.onChangeOrProgress?.();
  }

  private async update() {
    this.clearTimeout();
    this.timeoutTimestamp = performance.now();
    await this.updateStep();
  }

  private updateStep = async () => {
    const timeAtUpdate = performance.now();
    this.clock += (timeAtUpdate - this.timeoutTimestamp) / 1000;

    if (this.mode.recordingEditor) {
      if (config.logSessionTracksCtrlUpdateStep) {
        console.log(
          `SessionTracksCtrl duration ${this.session.head.duration} -> ${Math.max(
            this.session.head.duration,
            this.clock,
          )}`,
        );
      }
      this.session.head.duration = Math.max(this.session.head.duration, this.clock);
    } else {
      this.clock = Math.min(this.session.head.duration, this.clock);
    }

    await this.seekEditor();
    this.seekInRangeAudiosThatAreNotRunning();
    this.loadInRangeVideoAndSeekIfDifferent();
    if (this.running) {
      this.playInRangeAudios();
      this.playInRangeVideo();
    }
    this.pauseOutOfRangeAudios();
    this.stopOutOfRangeVideo();

    if (!this.mode.recordingEditor && this.clock === this.session.head.duration) {
      this.pause();
    }

    this.onChangeOrProgress?.();

    if (this.running) {
      this.timeoutTimestamp = timeAtUpdate;
      this.timeout = setTimeout(this.updateStep, 100);
    }
  };

  private gotError(error: Error) {
    this.pause();
    this.mode.status = SessionTracksCtrlStatus.Error;
    this.onError?.(error);
  }
}
