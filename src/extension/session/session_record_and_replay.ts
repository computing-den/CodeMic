import * as t from '../../lib/types.js';
import * as lib from '../../lib/lib.js';
import assert from '../../lib/assert.js';
import type { LoadedSession } from './session.js';
import config from '../config.js';
import AudioTrackPlayer from './audio_track_player.js';
import VideoTrackPlayer from './video_track_player.js';
import InternalWorkspace from './internal_workspace.js';
import WorkspacePlayer from './workspace_player.js';
import WorkspaceRecorder from './workspace_recorder.js';
import VscWorkspace from './vsc_workspace.js';
import _ from 'lodash';

enum Status {
  Init,
  Error,
  Running,
  Paused,
}

type Mode = {
  status: Status;
  recordingEditor: boolean;
};

export default class SessionRecordAndReplay {
  session: LoadedSession;
  internalWorkspace: InternalWorkspace;
  audioTrackPlayers: AudioTrackPlayer[];
  videoTrackPlayer: VideoTrackPlayer;
  workspacePlayer: WorkspacePlayer;
  workspaceRecorder: WorkspaceRecorder;
  vscWorkspace: VscWorkspace;
  clock = 0;

  private mode: Mode = {
    status: Status.Init,
    recordingEditor: false,
  };
  private timeout: any;
  private timeoutTimestamp = 0;

  constructor(session: LoadedSession) {
    this.session = session;
    this.internalWorkspace = new InternalWorkspace(session);
    this.vscWorkspace = new VscWorkspace(session);
    this.audioTrackPlayers = session.body.audioTracks.map(audioTrack => new AudioTrackPlayer(this.session, audioTrack));
    this.videoTrackPlayer = new VideoTrackPlayer(this.session);
    this.workspacePlayer = new WorkspacePlayer(this.session, this.vscWorkspace);
    this.workspaceRecorder = new WorkspaceRecorder(this.session, this.vscWorkspace);

    for (const c of this.audioTrackPlayers) this.initAudioPlayer(c);
    this.initVideoPlayer();
    this.workspacePlayer.onError = this.gotError.bind(this);
    this.workspaceRecorder.onError = this.gotError.bind(this);
  }

  get running(): boolean {
    return this.mode.status === Status.Running;
  }

  get recording(): boolean {
    return Boolean(this.running && this.mode.recordingEditor);
  }

  get playing(): boolean {
    return Boolean(this.running && !this.mode.recordingEditor);
  }

  async loadWorkspace(options?: { clock?: number }) {
    // Create workspace directory.
    await this.session.core.createWorkspaceDir();

    // Initialize internal workspace.
    this.internalWorkspace.restoreInitState();

    // Make sure cut and seek clocks are valid.
    // if (options?.cutClock && options?.clock) {
    //   assert(options.cutClock >= options.clock);
    // }

    // TODO
    // // Cut to cutClock.
    // if (options?.cutClock !== undefined) {
    //   // We don't need to cut audio because playback ends when it reaches session's duration.
    //   this.runtime.internalWorkspace.cut(options.cutClock);
    //   // for (const c of this.runtime.audioTrackPlayers) c.cut(options.cutClock);
    //   this.head.duration = options.cutClock;
    // }

    // Seek to clock.
    let targetUris: string[] | undefined;
    if (options?.clock) {
      const uriSet: t.UriSet = new Set();
      const seekData = this.internalWorkspace.getSeekData(options.clock);
      await this.internalWorkspace.seek(seekData, uriSet);
      targetUris = Array.from(uriSet);
    }

    // Sync and save.
    await this.vscWorkspace.sync(targetUris);
    await this.vscWorkspace.saveAllRelevantVscTabs();

    // Close irrelevant tabs.
    await this.vscWorkspace.closeIrrelevantVscTabs();
  }

  // /**
  //  * This must be called after loadWorkspace() and after the media manager and
  //  * the video element have been mounted on the page.
  //  * It's an optimization to preload mainly the video and not strictly necessary.
  //  */
  // loadMedia() {
  //   // Load media tracks so that they're ready to play when they come into range.
  //   // for (const p of this.audioTrackPlayers) p.load();

  //   // Load video.
  //   const videoTrack = this.findInRangeVideoTrack();
  //   if (videoTrack) this.videoTrackPlayer.loadTrack(videoTrack);
  // }

  reloadMedia() {
    this.audioTrackPlayers.forEach(p => this.disposeAudioPlayer(p));
    this.disposeVideoPlayer();

    this.audioTrackPlayers = this.session.body.audioTracks.map(
      audioTrack => new AudioTrackPlayer(this.session, audioTrack),
    );
    this.videoTrackPlayer = new VideoTrackPlayer(this.session);
  }

  async scan() {
    // Create workspace directory.
    await this.session.core.createWorkspaceDir();

    // Scan VSCode & filesystem.
    const events = await this.vscWorkspace.scanDirAndVsc();
    this.session.editor.insertInitialEvents(events);

    // TODO insert focus document and focus line.

    // Initialize internal workspace.
    await this.internalWorkspace.restoreInitState();

    this.session.mustScan = false;
    this.session.temp = false;
  }

  async play() {
    assert(!this.running);

    this.mode.recordingEditor = false;
    this.mode.status = Status.Running;

    if (this.isAlmostAtTheEnd()) {
      await this.seek(0, { noUpdate: true });
    }

    await this.workspacePlayer.play();
    this.update();
  }

  async record() {
    assert(!this.running);

    if (this.clock !== this.session.head.duration) {
      await this.seek(this.session.head.duration, { noUpdate: false });
    }

    this.mode.recordingEditor = true;
    this.mode.status = Status.Running;

    await this.workspaceRecorder.record();

    this.update();
  }

  pause() {
    this.clearTimeout();
    this.mode.status = Status.Paused;
    this.pauseAudios();
    this.pauseVideo();
    this.pauseEditor();
  }

  async fastSync() {
    await this.seek(this.clock);
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

  setClock(clock: number) {
    this.clock = clock;
    this.workspaceRecorder.setClock(this.clock);
    this.workspacePlayer.setClock(this.clock);
  }

  loadAudioTrack(audioTrack: t.AudioTrack) {
    const audioTrackPlayer = new AudioTrackPlayer(this.session, audioTrack);
    this.audioTrackPlayers.push(audioTrackPlayer);
    this.initAudioPlayer(audioTrackPlayer);
    // audioTrackPlayer.load();
  }

  unloadAudioTrack(id: string) {
    const i = this.audioTrackPlayers.findIndex(c => c.audioTrack.id === id);
    if (i === -1) {
      console.error(`SessionRecordAndReplay deleteAudio did not find audio track with id ${id}`);
      return;
    }

    this.audioTrackPlayers[i].pause();
    this.disposeAudioPlayer(this.audioTrackPlayers[i]);
    this.audioTrackPlayers.splice(i, 1);
  }

  loadVideoTrack(videoTrack: t.VideoTrack) {
    // Maybe load if video is in range?
  }

  unloadVideoTrack(id: string) {
    if (this.videoTrackPlayer.videoTrack?.id === id) {
      this.videoTrackPlayer.stop();
    }
    this.disposeVideoPlayer();
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

  async applyInsertEvent(cmd: t.InsertEventCmd) {
    if (this.internalWorkspace.eventIndex === cmd.index - 1) {
      this.internalWorkspace.eventIndex++;
      await this.workspacePlayer.applyEditorEvent(cmd.event, cmd.uri, t.Direction.Forwards);
    }
  }

  async unapplyInsertEvent(cmd: t.InsertEventCmd) {
    if (this.internalWorkspace.eventIndex === cmd.index) {
      this.internalWorkspace.eventIndex--;
      await this.workspacePlayer.applyEditorEvent(cmd.event, cmd.uri, t.Direction.Backwards);
    }
  }

  updateAudioTrack(audioTrack: t.AudioTrack) {
    const audioTrackPlayer = this.audioTrackPlayers.find(p => p.audioTrack.id === audioTrack.id);
    if (audioTrackPlayer) {
      audioTrackPlayer.audioTrack = audioTrack;
    }
  }

  updateVideoTrack(videoTrack: t.VideoTrack) {
    if (this.videoTrackPlayer.videoTrack?.id === videoTrack.id) {
      this.videoTrackPlayer.videoTrack = videoTrack;
    }
  }

  private initAudioPlayer(c: AudioTrackPlayer) {
    c.onError = this.gotError.bind(this);
  }

  private initVideoPlayer() {
    this.videoTrackPlayer.onError = this.gotError.bind(this);
  }

  private disposeAudioPlayer(c: AudioTrackPlayer) {
    c.onError = undefined;
  }

  private disposeVideoPlayer() {
    this.videoTrackPlayer.onError = undefined;
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
    return _.findLast(this.session.body.videoTracks, t => this.isTrackInRange(t));
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

  private async update() {
    this.clearTimeout();
    this.timeoutTimestamp = performance.now();
    await this.updateStep(this.timeoutTimestamp);
  }

  /**
   * When called immediately (from this.fastSync() for example), we pass the
   * timestamp so that the few nanosecond difference won't cause the clock to
   * change from 0. Because the frontend has special logic for clock === 0.
   */
  private updateStep = async (now?: number) => {
    const timeAtUpdate = now ?? performance.now();
    const isLoading = this.videoTrackPlayer.loading || this.audioTrackPlayers.some(p => p.loading);
    if (isLoading) {
      this.videoTrackPlayer.pause();
      for (const c of this.audioTrackPlayers) c.pause();
    } else {
      this.clock += (timeAtUpdate - this.timeoutTimestamp) / 1000;

      if (this.mode.recordingEditor) {
        if (config.logSessionRRUpdateStep) {
          console.log(
            `SessionRecordAndReplay duration ${this.session.head.duration} -> ${Math.max(
              this.session.head.duration,
              this.clock,
            )}`,
          );
        }
        this.session.editor.updateDuration(Math.max(this.session.head.duration, this.clock), { coalescing: true });
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

      this.session.onProgress?.();
    }

    if (config.logMasterAndTracksTimeUpdates) {
      const videoClock = this.videoTrackPlayer.videoTrack && {
        title: this.videoTrackPlayer.videoTrack?.title || '',
        clock: lib.clockToGlobal(this.videoTrackPlayer.lastReportedClock, this.videoTrackPlayer.videoTrack.clockRange),
      };
      const audioClocks = this.audioTrackPlayers.map(p => ({
        title: p.audioTrack.title,
        clock: lib.clockToGlobal(p.lastReportedClock, p.audioTrack.clockRange),
      }));
      const trackClocksStr = _.compact([videoClock, ...audioClocks])
        .map(t => t.title + ': ' + t.clock.toFixed(2))
        .join(' | ');

      console.log(`master clock: ${this.clock.toFixed(2)} | ${trackClocksStr}`);
    }

    if (this.running) {
      this.timeoutTimestamp = timeAtUpdate;
      this.timeout = setTimeout(this.updateStep, 100);
    }
  };

  private gotError(error: Error) {
    this.pause();
    this.mode.status = Status.Error;
    this.session.onError?.(error);
  }
}
