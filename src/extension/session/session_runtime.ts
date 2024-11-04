import os from 'os';
import * as t from '../../lib/types.js';
import * as lib from '../../lib/lib.js';
import assert from '../../lib/assert.js';
import type { Session } from './session.js';
import config from '../config.js';
import AudioTrackCtrl from './audio_track_ctrl.js';
import VideoTrackCtrl from './video_track_ctrl.js';
import InternalWorkspace from './internal_workspace.js';
import WorkspacePlayer from './workspace_player.js';
import WorkspaceRecorder from './workspace_recorder.js';
import _ from 'lodash';

export enum SessionRuntimeStatus {
  Init,
  Error,
  Running,
  Paused,
}

export type SessionRuntimeMode = {
  status: SessionRuntimeStatus;
  recordingEditor: boolean;
};

export default class SessionRuntime {
  clock = 0;
  mode: SessionRuntimeMode = {
    status: SessionRuntimeStatus.Init,
    recordingEditor: false,
  };

  session: Session;
  internalWorkspace: InternalWorkspace;
  audioTrackCtrls: AudioTrackCtrl[];
  videoTrackCtrl: VideoTrackCtrl;
  videoTracks: t.VideoTrack[];
  workspacePlayer: WorkspacePlayer;
  workspaceRecorder: WorkspaceRecorder;

  onChangeOrProgress?: () => any;
  onChange?: () => any;
  onError?: (error: Error) => any;

  private timeout: any;
  private timeoutTimestamp = 0;

  constructor(session: Session, bodyJSON?: t.SessionBodyJSON) {
    bodyJSON ??= {
      audioTracks: [],
      videoTracks: [],
      internalWorkspace: {
        editorTracks: {},
        focusTimeline: { documents: [], lines: [] },
        defaultEol: os.EOL as t.EndOfLine,
      },
    };

    this.session = session;
    this.internalWorkspace = new InternalWorkspace(session, bodyJSON.internalWorkspace);
    this.audioTrackCtrls = bodyJSON.audioTracks.map(audioTrack => new AudioTrackCtrl(this.session, audioTrack));
    this.videoTracks = bodyJSON.videoTracks;
    this.videoTrackCtrl = new VideoTrackCtrl(this.session);
    this.workspacePlayer = new WorkspacePlayer(this.session);
    this.workspaceRecorder = new WorkspaceRecorder(this.session);

    for (const c of this.audioTrackCtrls) this.initAudioCtrl(c);
    this.initVideoCtrl();
    this.workspacePlayer.onError = this.gotError.bind(this);
    this.workspaceRecorder.onChange = this.workspaceRecorderChangeHandler.bind(this);
    this.workspaceRecorder.onError = this.gotError.bind(this);
  }

  get running(): boolean {
    return this.mode.status === SessionRuntimeStatus.Running;
  }

  // static async fromSession(session: Session): Promise<SessionRuntime> {
  //   const internalWorkspace = await InternalWorkspace.fromSession(session);
  //   return new SessionRuntime(internalWorkspace);
  // }

  load() {
    // Load media tracks so that they're ready to play when they come into range.
    for (const c of this.audioTrackCtrls) c.load();

    const videoTrack = this.findInRangeVideoTrack();
    if (videoTrack) this.videoTrackCtrl.loadTrack(videoTrack);
  }

  async play() {
    assert(!this.running);

    this.mode.recordingEditor = false;
    this.mode.status = SessionRuntimeStatus.Running;

    if (this.isAlmostAtTheEnd()) {
      this.seek(0, { noUpdate: true });
    }

    await this.workspacePlayer.play();
    this.update();
  }

  async record() {
    assert(!this.running);

    assert(this.clock === this.session.head.duration);

    this.mode.recordingEditor = true;
    this.mode.status = SessionRuntimeStatus.Running;

    await this.workspaceRecorder.record();

    this.update();
  }

  pause() {
    this.clearTimeout();
    this.mode.status = SessionRuntimeStatus.Paused;
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
    this.audioTrackCtrls.push(audioTrackCtrl);
    this.initAudioCtrl(audioTrackCtrl);
    this.onChange?.();
  }

  deleteAudio(id: string) {
    const i = this.audioTrackCtrls.findIndex(c => c.audioTrack.id === id);
    if (i === -1) {
      console.error(`SessionRuntime deleteAudio did not find audio track with id ${id}`);
      return;
    }

    this.audioTrackCtrls[i].pause();
    this.audioTrackCtrls.splice(i, 1);
    this.onChange?.();
  }

  insertVideoAndLoad(videoTrack: t.VideoTrack) {
    // const videoTrackCtrl = new VideoTrackCtrl(this.session, videoTrack);
    this.session.head.duration = Math.max(this.session.head.duration, videoTrack.clockRange.end);
    this.videoTracks.push(videoTrack);
    // this.videoTrackCtrl.insert(videoTrackCtrl);
    this.initVideoCtrl();
    this.onChange?.();
  }

  deleteVideo(id: string) {
    const j = this.videoTracks.findIndex(t => t.id === id);
    if (j !== -1) {
      this.videoTracks.splice(j, 1);
    }

    this.videoTrackCtrl.pause();
    this.onChange?.();
  }

  handleFrontendAudioEvent(e: t.FrontendMediaEvent) {
    const audioCtrl = this.audioTrackCtrls.find(a => a.audioTrack.id === e.id);
    if (audioCtrl) {
      audioCtrl.handleAudioEvent(e);
    } else {
      console.error(`handleFrontendAudioEvent audio track player with id ${e.id} not found`);
    }
  }

  handleFrontendVideoEvent(e: t.FrontendMediaEvent) {
    this.videoTrackCtrl.handleVideoEvent(e);
  }

  toJSON(): t.SessionBodyJSON {
    return {
      audioTracks: this.audioTrackCtrls.map(c => c.audioTrack),
      videoTracks: this.videoTracks,
      internalWorkspace: this.internalWorkspace.toJSON(),
    };
  }

  private initAudioCtrl(c: AudioTrackCtrl) {
    c.onError = this.gotError.bind(this);
  }

  private initVideoCtrl() {
    this.videoTrackCtrl.onError = this.gotError.bind(this);
  }

  private async seekEditor() {
    this.workspaceRecorder.setClock(this.clock);

    if (this.mode.recordingEditor) {
      this.workspacePlayer.setClock(this.clock);
    } else {
      await this.workspacePlayer.seek(this.clock);
    }
  }

  private pauseEditor() {
    if (this.mode.recordingEditor) {
      this.workspaceRecorder.pause();
    } else {
      this.workspacePlayer.pause();
    }
  }

  private seekInRangeAudios() {
    for (const c of this.audioTrackCtrls) {
      if (this.isTrackInRange(c.audioTrack)) this.seekAudio(c);
    }
  }

  private seekInRangeAudiosThatAreNotRunning() {
    for (const c of this.audioTrackCtrls) {
      if (!c.running && this.isTrackInRange(c.audioTrack)) this.seekAudio(c);
    }
  }

  private seekAudio(c: AudioTrackCtrl) {
    c.seek(this.globalClockToTrackLocal(c.audioTrack));
  }

  private playInRangeAudios() {
    for (const c of this.audioTrackCtrls) {
      if (!c.running && this.isTrackInRange(c.audioTrack)) c.play();
    }
  }

  private pauseAudios() {
    for (const c of this.audioTrackCtrls) {
      if (c.running) c.pause();
    }
  }

  private pauseOutOfRangeAudios() {
    for (const c of this.audioTrackCtrls) {
      if (c.running && !this.isTrackInRange(c.audioTrack)) c.pause();
    }
  }

  private stopOutOfRangeVideo() {
    const c = this.videoTrackCtrl;
    if (c.videoTrack && !this.isTrackInRange(c.videoTrack)) c.stop();
  }

  private pauseVideo() {
    this.videoTrackCtrl.pause();
  }

  private loadInRangeVideoAndSeek() {
    const videoTrack = this.findInRangeVideoTrack();
    if (videoTrack) {
      this.videoTrackCtrl.loadTrack(videoTrack);
      this.videoTrackCtrl.seek(this.globalClockToTrackLocal(videoTrack));
    }
  }

  private loadInRangeVideoAndSeekIfDifferent() {
    const videoTrack = this.findInRangeVideoTrack();
    // console.log('loadInRangeVideoAndSeekIfDifferent videoTrack', videoTrack);
    if (videoTrack && (this.videoTrackCtrl.videoTrack !== videoTrack || !this.videoTrackCtrl.running)) {
      this.videoTrackCtrl.loadTrack(videoTrack);
      this.videoTrackCtrl.seek(this.globalClockToTrackLocal(videoTrack));
    }
  }

  private findInRangeVideoTrack(): t.VideoTrack | undefined {
    return _.findLast(this.videoTracks, t => this.isTrackInRange(t));
  }

  private playInRangeVideo() {
    if (
      !this.videoTrackCtrl.running &&
      this.videoTrackCtrl.videoTrack &&
      this.isTrackInRange(this.videoTrackCtrl.videoTrack)
    ) {
      this.videoTrackCtrl.play();
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

  private workspaceRecorderChangeHandler() {
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
      if (config.logSessionRuntimeUpdateStep) {
        console.log(
          `SessionRuntime duration ${this.session.head.duration} -> ${Math.max(
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
    this.mode.status = SessionRuntimeStatus.Error;
    this.onError?.(error);
  }
}
