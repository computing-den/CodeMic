import os from 'os';
import * as t from '../../lib/types.js';
import * as lib from '../../lib/lib.js';
import assert from '../../lib/assert.js';
import type { Session } from './session.js';
import config from '../config.js';
import AudioTrackPlayer from './audio_track_player.js';
import VideoTrackPlayer from './video_track_player.js';
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
  audioTrackPlayers: AudioTrackPlayer[];
  videoTrackPlayer: VideoTrackPlayer;
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
    this.audioTrackPlayers = bodyJSON.audioTracks.map(audioTrack => new AudioTrackPlayer(this.session, audioTrack));
    this.videoTracks = bodyJSON.videoTracks;
    this.videoTrackPlayer = new VideoTrackPlayer(this.session);
    this.workspacePlayer = new WorkspacePlayer(this.session);
    this.workspaceRecorder = new WorkspaceRecorder(this.session);

    for (const c of this.audioTrackPlayers) this.initAudioPlayer(c);
    this.initVideoPlayer();
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
    for (const c of this.audioTrackPlayers) c.load();

    const videoTrack = this.findInRangeVideoTrack();
    if (videoTrack) this.videoTrackPlayer.loadTrack(videoTrack);
  }

  async play() {
    assert(!this.running);

    this.mode.recordingEditor = false;
    this.mode.status = SessionRuntimeStatus.Running;

    if (this.isAlmostAtTheEnd()) {
      await this.seek(0, { noUpdate: true });
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
    const audioTrackPlayer = new AudioTrackPlayer(this.session, audioTrack);
    this.session.head.duration = Math.max(this.session.head.duration, audioTrack.clockRange.end);
    this.audioTrackPlayers.push(audioTrackPlayer);
    this.initAudioPlayer(audioTrackPlayer);
    this.onChange?.();
  }

  deleteAudio(id: string) {
    const i = this.audioTrackPlayers.findIndex(c => c.audioTrack.id === id);
    if (i === -1) {
      console.error(`SessionRuntime deleteAudio did not find audio track with id ${id}`);
      return;
    }

    this.audioTrackPlayers[i].pause();
    this.audioTrackPlayers.splice(i, 1);
    this.onChange?.();
  }

  insertVideoAndLoad(videoTrack: t.VideoTrack) {
    // const videoTrackPlayer = new VideoTrackPlayer(this.session, videoTrack);
    this.session.head.duration = Math.max(this.session.head.duration, videoTrack.clockRange.end);
    this.videoTracks.push(videoTrack);
    // this.videoTrackPlayer.insert(videoTrackPlayer);
    this.initVideoPlayer();
    this.onChange?.();
  }

  deleteVideo(id: string) {
    const j = this.videoTracks.findIndex(t => t.id === id);
    if (j !== -1) {
      this.videoTracks.splice(j, 1);
    }

    this.videoTrackPlayer.pause();
    this.onChange?.();
  }

  handleFrontendAudioEvent(e: t.FrontendMediaEvent) {
    const audioPlayer = this.audioTrackPlayers.find(a => a.audioTrack.id === e.id);
    if (audioPlayer) {
      audioPlayer.handleAudioEvent(e);
    } else {
      console.error(`handleFrontendAudioEvent audio track player with id ${e.id} not found`);
    }
  }

  handleFrontendVideoEvent(e: t.FrontendMediaEvent) {
    this.videoTrackPlayer.handleVideoEvent(e);
  }

  async changeSpeed(range: t.ClockRange, factor: number) {
    this.internalWorkspace.changeSpeed(range, factor);
    const e = this.internalWorkspace.getCurrentEvent();
    if (e) await this.seek(e.event.clock);
    this.onChange?.();
  }

  async merge(range: t.ClockRange) {
    await this.changeSpeed(range, Infinity);
  }

  async insertGap(clock: number, dur: number) {
    this.internalWorkspace.insertGap(clock, dur);
    const e = this.internalWorkspace.getCurrentEvent();
    if (e) await this.seek(e.event.clock);
    this.onChange?.();
  }

  toJSON(): t.SessionBodyJSON {
    return {
      audioTracks: this.audioTrackPlayers.map(c => c.audioTrack),
      videoTracks: this.videoTracks,
      internalWorkspace: this.internalWorkspace.toJSON(),
    };
  }

  private initAudioPlayer(c: AudioTrackPlayer) {
    c.onError = this.gotError.bind(this);
  }

  private initVideoPlayer() {
    this.videoTrackPlayer.onError = this.gotError.bind(this);
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
    for (const c of this.audioTrackPlayers) {
      if (this.isTrackInRange(c.audioTrack)) this.seekAudio(c);
    }
  }

  private seekInRangeAudiosThatAreNotRunning() {
    for (const c of this.audioTrackPlayers) {
      if (!c.running && this.isTrackInRange(c.audioTrack)) this.seekAudio(c);
    }
  }

  private seekAudio(c: AudioTrackPlayer) {
    c.seek(this.globalClockToTrackLocal(c.audioTrack));
  }

  private playInRangeAudios() {
    for (const c of this.audioTrackPlayers) {
      if (!c.running && this.isTrackInRange(c.audioTrack)) c.play();
    }
  }

  private pauseAudios() {
    for (const c of this.audioTrackPlayers) {
      if (c.running) c.pause();
    }
  }

  private pauseOutOfRangeAudios() {
    for (const c of this.audioTrackPlayers) {
      if (c.running && !this.isTrackInRange(c.audioTrack)) c.pause();
    }
  }

  private stopOutOfRangeVideo() {
    const c = this.videoTrackPlayer;
    if (c.videoTrack && !this.isTrackInRange(c.videoTrack)) c.stop();
  }

  private pauseVideo() {
    this.videoTrackPlayer.pause();
  }

  private loadInRangeVideoAndSeek() {
    const videoTrack = this.findInRangeVideoTrack();
    if (videoTrack) {
      this.videoTrackPlayer.loadTrack(videoTrack);
      this.videoTrackPlayer.seek(this.globalClockToTrackLocal(videoTrack));
    }
  }

  private loadInRangeVideoAndSeekIfDifferent() {
    const videoTrack = this.findInRangeVideoTrack();
    // console.log('loadInRangeVideoAndSeekIfDifferent videoTrack', videoTrack);
    if (videoTrack && (this.videoTrackPlayer.videoTrack !== videoTrack || !this.videoTrackPlayer.running)) {
      this.videoTrackPlayer.loadTrack(videoTrack);
      this.videoTrackPlayer.seek(this.globalClockToTrackLocal(videoTrack));
    }
  }

  private findInRangeVideoTrack(): t.VideoTrack | undefined {
    return _.findLast(this.videoTracks, t => this.isTrackInRange(t));
  }

  private playInRangeVideo() {
    if (
      !this.videoTrackPlayer.running &&
      this.videoTrackPlayer.videoTrack &&
      this.isTrackInRange(this.videoTrackPlayer.videoTrack)
    ) {
      this.videoTrackPlayer.play();
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
