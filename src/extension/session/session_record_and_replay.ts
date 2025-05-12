import * as t from '../../lib/types.js';
import * as lib from '../../lib/lib.js';
import assert from '../../lib/assert.js';
import type { LoadedSession } from './session.js';
import config from '../config.js';
// import AudioTrackPlayer from './audio_track_player.js';
// import VideoTrackPlayer from './video_track_player.js';
import InternalWorkspace, { SeekData, SeekStep } from './internal_workspace.js';
import WorkspacePlayer from './workspace_player.js';
import WorkspaceRecorder from './workspace_recorder.js';
import VscWorkspace from './vsc_workspace.js';
import QueueRunner from '../../lib/queue_runner.js';
import _ from 'lodash';
import { UpdateLoopAsync } from '../../lib/update_loop_async.js';
import { isDuration } from 'moment';

enum Status {
  Init,
  Error,
  Running,
  Paused,
}

type Mode = {
  status: Status;
  recorder: boolean;
};

const UPDATE_LOOP_INTERVAL_MS = 100;

export default class SessionRecordAndReplay {
  session: LoadedSession;
  clock = 0;

  private internalWorkspace: InternalWorkspace;
  private vscWorkspace: VscWorkspace;

  private workspacePlayer: WorkspacePlayer;
  private workspaceRecorder: WorkspaceRecorder;

  private queue = new QueueRunner();

  // private audioTrackPlayers: AudioTrackPlayer[];
  // private videoTrackPlayer: VideoTrackPlayer;

  private mode: Mode = {
    status: Status.Init,
    recorder: false,
  };

  private updateLoop: UpdateLoopAsync;

  constructor(session: LoadedSession) {
    this.session = session;
    this.internalWorkspace = new InternalWorkspace(session);
    this.vscWorkspace = new VscWorkspace(session, this.internalWorkspace);
    // this.audioTrackPlayers = session.body.audioTracks.map(audioTrack => new AudioTrackPlayer(this.session, audioTrack));
    // this.videoTrackPlayer = new VideoTrackPlayer(this.session);
    this.workspacePlayer = new WorkspacePlayer(this.session, this.internalWorkspace, this.vscWorkspace);
    this.workspaceRecorder = new WorkspaceRecorder(this.session, this.internalWorkspace, this.vscWorkspace);

    this.updateLoop = new UpdateLoopAsync(this.enqueueUpdate.bind(this), UPDATE_LOOP_INTERVAL_MS);

    // for (const c of this.audioTrackPlayers) this.initAudioPlayer(c);
    // this.initVideoPlayer();
    // this.workspacePlayer.onError = this.gotError.bind(this);
    // this.workspaceRecorder.onError = this.gotError.bind(this);
  }

  get running(): boolean {
    return this.mode.status === Status.Running;
  }

  get recording(): boolean {
    return Boolean(this.running && this.mode.recorder);
  }

  get playing(): boolean {
    return Boolean(this.running && !this.mode.recorder);
  }

  async enqueueLoadWorkspace(options?: { clock?: number }) {
    await this.stopOnError(this.queue.enqueue(this.loadWorkspace.bind(this), options));
  }

  // reloadMedia() {
  //   this.audioTrackPlayers.forEach(p => this.disposeAudioPlayer(p));
  //   this.disposeVideoPlayer();

  //   this.audioTrackPlayers = this.session.body.audioTracks.map(
  //     audioTrack => new AudioTrackPlayer(this.session, audioTrack),
  //   );
  //   this.videoTrackPlayer = new VideoTrackPlayer(this.session);
  // }

  async enqueueScan() {
    await this.stopOnError(this.queue.enqueue(this.scan.bind(this)));
  }

  async enqueuePlay() {
    await this.stopOnError(this.queue.enqueue(this.play.bind(this)));
  }

  async enqueueRecord() {
    await this.stopOnError(this.queue.enqueue(this.record.bind(this)));
  }

  async enqueueSeek(clock: number) {
    await this.stopOnError(this.queue.enqueue(this.seek.bind(this), clock));
  }

  /**
   * This may be called from gotError which may be called from inside a queue
   * task. So it must not be queued itself.
   */
  pause() {
    this.updateLoop.stop();
    this.queue.clear();
    this.mode.status = Status.Paused;
    // this.pauseAudios();
    // this.pauseVideo();
    if (this.mode.recorder) {
      this.workspaceRecorder.pause();
    } else {
      this.workspacePlayer.pause();
    }
  }

  // async fastSync() {
  //   await this.seek(this.clock);
  // }

  // setClock(clock: number) {
  //   this.clock = clock;
  //   this.workspaceRecorder.setClock(this.clock);
  //   this.workspacePlayer.setClock(this.clock);
  // }

  // loadAudioTrack(audioTrack: t.AudioTrack) {
  //   const audioTrackPlayer = new AudioTrackPlayer(this.session, audioTrack);
  //   this.audioTrackPlayers.push(audioTrackPlayer);
  //   this.initAudioPlayer(audioTrackPlayer);
  //   // audioTrackPlayer.load();
  // }

  // unloadAudioTrack(id: string) {
  //   const i = this.audioTrackPlayers.findIndex(c => c.audioTrack.id === id);
  //   if (i === -1) {
  //     console.error(`SessionRecordAndReplay deleteAudio did not find audio track with id ${id}`);
  //     return;
  //   }

  //   this.audioTrackPlayers[i].pause();
  //   this.disposeAudioPlayer(this.audioTrackPlayers[i]);
  //   this.audioTrackPlayers.splice(i, 1);
  // }

  // loadVideoTrack(videoTrack: t.VideoTrack) {
  //   // Maybe load if video is in range?
  // }

  // unloadVideoTrack(id: string) {
  //   if (this.videoTrackPlayer.videoTrack?.id === id) {
  //     this.videoTrackPlayer.stop();
  //   }
  //   this.disposeVideoPlayer();
  // }

  handleFrontendAudioEvent(e: t.FrontendMediaEvent) {
    // TODO
    //   const audioPlayer = this.audioTrackPlayers.find(a => a.audioTrack.id === e.id);
    //   if (audioPlayer) {
    //     audioPlayer.handleAudioEvent(e);
    //   } else {
    //     console.error(`handleFrontendAudioEvent audio track player with id ${e.id} not found`);
    //   }
  }

  handleFrontendVideoEvent(e: t.FrontendMediaEvent) {
    // TODO
    //   this.videoTrackPlayer.handleVideoEvent(e);
  }

  // async applyInsertEvent(cmd: t.InsertEventCmd) {
  //   if (this.internalWorkspace.eventIndex === cmd.index - 1) {
  //     this.internalWorkspace.eventIndex++;
  //     await this.workspacePlayer.applyEditorEvent(cmd.event, cmd.uri, t.Direction.Forwards);
  //   }
  // }

  // async unapplyInsertEvent(cmd: t.InsertEventCmd) {
  //   if (this.internalWorkspace.eventIndex === cmd.index) {
  //     this.internalWorkspace.eventIndex--;
  //     await this.workspacePlayer.applyEditorEvent(cmd.event, cmd.uri, t.Direction.Backwards);
  //   }
  // }

  // updateAudioTrack(audioTrack: t.AudioTrack) {
  //   const audioTrackPlayer = this.audioTrackPlayers.find(p => p.audioTrack.id === audioTrack.id);
  //   if (audioTrackPlayer) {
  //     audioTrackPlayer.audioTrack = audioTrack;
  //   }
  // }

  // updateVideoTrack(videoTrack: t.VideoTrack) {
  //   if (this.videoTrackPlayer.videoTrack?.id === videoTrack.id) {
  //     this.videoTrackPlayer.videoTrack = videoTrack;
  //   }
  // }

  async enqueueSyncAfterSessionChange(change: t.SessionChange, dir?: t.Direction) {
    await this.stopOnError(this.queue.enqueue(this.syncAfterSessionChange.bind(this), change, dir));
  }

  async enqueueSyncMedia() {
    await this.stopOnError(this.queue.enqueue(this.syncMedia.bind(this)));
  }

  // private initAudioPlayer(c: AudioTrackPlayer) {
  //   c.onError = this.gotError.bind(this);
  // }

  // private initVideoPlayer() {
  //   this.videoTrackPlayer.onError = this.gotError.bind(this);
  // }

  // private disposeAudioPlayer(c: AudioTrackPlayer) {
  //   c.onError = undefined;
  // }

  // private disposeVideoPlayer() {
  //   this.videoTrackPlayer.onError = undefined;
  // }

  // private seekInRangeAudios() {
  //   for (const c of this.audioTrackPlayers) {
  //     if (this.isTrackInRange(c.audioTrack)) this.seekAudio(c);
  //   }
  // }

  // private seekInRangeAudiosThatAreNotRunning() {
  //   for (const c of this.audioTrackPlayers) {
  //     if (!c.running && this.isTrackInRange(c.audioTrack)) this.seekAudio(c);
  //   }
  // }

  // private seekAudio(c: AudioTrackPlayer) {
  //   c.seek(this.globalClockToTrackLocal(c.audioTrack));
  // }

  // private playInRangeAudios() {
  //   for (const c of this.audioTrackPlayers) {
  //     if (!c.running && this.isTrackInRange(c.audioTrack)) c.play();
  //   }
  // }

  // private setInRangeAudiosPlaybackRate() {
  //   for (const c of this.audioTrackPlayers) {
  //     if (this.isTrackInRange(c.audioTrack)) {
  //       const rate = this.getAdjustedPlaybackRate(lib.clockToGlobal(c.lastReportedClock, c.audioTrack.clockRange));
  //       c.setPlaybackRate(rate);
  //     }
  //   }
  // }

  // private pauseAudios() {
  //   for (const c of this.audioTrackPlayers) {
  //     if (c.running) c.pause();
  //   }
  // }

  // private pauseOutOfRangeAudios() {
  //   for (const c of this.audioTrackPlayers) {
  //     if (c.running && !this.isTrackInRange(c.audioTrack)) c.pause();
  //   }
  // }

  // private stopOutOfRangeVideo() {
  //   const c = this.videoTrackPlayer;
  //   if (c.videoTrack && !this.isTrackInRange(c.videoTrack)) c.stop();
  // }

  // private pauseVideo() {
  //   this.videoTrackPlayer.pause();
  // }

  // private loadInRangeVideoAndSeek() {
  //   const videoTrack = this.findInRangeVideoTrack();
  //   if (videoTrack) {
  //     this.videoTrackPlayer.loadTrack(videoTrack);
  //     this.videoTrackPlayer.seek(this.globalClockToTrackLocal(videoTrack));
  //   }
  // }

  // private loadInRangeVideoAndSeekIfDifferent() {
  //   const videoTrack = this.findInRangeVideoTrack();
  //   // console.log('loadInRangeVideoAndSeekIfDifferent videoTrack', videoTrack);
  //   if (videoTrack && (this.videoTrackPlayer.videoTrack !== videoTrack || !this.videoTrackPlayer.running)) {
  //     this.videoTrackPlayer.loadTrack(videoTrack);
  //     this.videoTrackPlayer.seek(this.globalClockToTrackLocal(videoTrack));
  //   }
  // }

  // private findInRangeVideoTrack(): t.VideoTrack | undefined {
  //   return _.findLast(this.session.body.videoTracks, t => this.isTrackInRange(t));
  // }

  // private playInRangeVideo() {
  //   if (
  //     !this.videoTrackPlayer.running &&
  //     this.videoTrackPlayer.videoTrack &&
  //     this.isTrackInRange(this.videoTrackPlayer.videoTrack)
  //   ) {
  //     this.videoTrackPlayer.play();
  //   }
  // }

  // private setInRangeVideoPlaybackRate() {
  //   if (this.videoTrackPlayer.videoTrack && this.isTrackInRange(this.videoTrackPlayer.videoTrack)) {
  //     const rate = this.getAdjustedPlaybackRate(
  //       lib.clockToGlobal(this.videoTrackPlayer.lastReportedClock, this.videoTrackPlayer.videoTrack.clockRange),
  //     );
  //     this.videoTrackPlayer.setPlaybackRate(rate);
  //   }
  // }

  // private getAdjustedPlaybackRate(clock: number): number {
  //   const diff = this.clock - clock;
  //   const threshold = 0.5;
  //   if (diff > threshold) {
  //     return 1.05;
  //   } else if (diff < threshold) {
  //     return 0.95;
  //   } else {
  //     return 1;
  //   }
  // }

  private async enqueueUpdate(diffMs: number) {
    await this.stopOnError(this.queue.enqueue(this.update.bind(this, diffMs)));
  }

  private async seek(clock: number) {
    this.clock = Math.min(this.session.head.duration, clock);
    await this.workspacePlayer.seek(clock);
    await this.syncMedia();
    this.updateLoop.resetDiff();
  }

  private async loadWorkspace(options?: { clock?: number }) {
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
      await this.internalWorkspace.seek(options.clock, uriSet);
      targetUris = Array.from(uriSet);
    }

    // Sync and save.
    await this.vscWorkspace.sync(targetUris);
    await this.vscWorkspace.saveAllRelevantVscTabs();

    // Close irrelevant tabs.
    await this.vscWorkspace.closeIrrelevantVscTabs();
  }

  private async scan() {
    // Create workspace directory.
    await this.session.core.createWorkspaceDir();

    // Scan VSCode & filesystem.
    const events = await this.vscWorkspace.scanDirAndVsc();
    this.session.editor.insertScannedEvents(events);

    // TODO insert focus document and focus line.

    // Initialize internal workspace.
    await this.internalWorkspace.restoreInitState();

    this.session.mustScan = false;
    this.session.temp = false;
  }

  private async play() {
    assert(!this.running);

    this.mode.recorder = false;
    this.mode.status = Status.Running;

    // Seek and sync.
    if (this.isAlmostAtTheEnd()) {
      this.clock = 0;
      await this.internalWorkspace.seek(0);
    }
    await this.vscWorkspace.sync();

    await this.workspacePlayer.play();
    this.updateLoop.start();
  }

  private async record() {
    assert(!this.running);

    this.mode.recorder = true;
    this.mode.status = Status.Running;

    // Seek and sync.
    this.clock = this.session.head.duration;
    await this.internalWorkspace.seek(this.session.head.duration);
    await this.vscWorkspace.sync();

    await this.workspaceRecorder.record();
    this.updateLoop.start();
  }

  /**
   * Only meant to be called by the update loop. Don't call it directly or make
   * it do anything special when diffMs is 0.
   * On error, it will call this.session.onError and also throw.
   */
  private async update(diffMs: number) {
    try {
      // const isLoading = this.videoTrackPlayer.loading || this.audioTrackPlayers.some(p => p.loading);
      // if (isLoading) {
      //   this.videoTrackPlayer.pause();
      //   for (const c of this.audioTrackPlayers) c.pause();
      //   return;
      // }
      this.clock += diffMs / 1000;

      if (this.mode.recorder) {
        if (config.logSessionRRUpdateStep) {
          console.log(
            `SessionRecordAndReplay duration ${this.session.head.duration} -> ${Math.max(
              this.session.head.duration,
              this.clock,
            )}`,
          );
        }
        this.session.editor.updateDuration(Math.max(this.session.head.duration, this.clock), { coalescing: true });
        // this.internalWorkspace.setEventIndexByClock(this.clock);
      } else {
        this.clock = Math.min(this.session.head.duration, this.clock);
        await this.workspacePlayer.seek(this.clock);
      }

      await this.syncMedia();

      if (!this.mode.recorder && this.clock === this.session.head.duration) {
        this.pause();
      }

      this.session.onProgress?.();
    } catch (error) {
      this.session.onError?.(error as Error);
      throw error;
    }
  }

  private async syncMedia() {
    // TODO
    // this.seekInRangeAudiosThatAreNotRunning();
    // this.loadInRangeVideoAndSeekIfDifferent();
    // if (this.running) {
    //   this.playInRangeAudios();
    //   this.playInRangeVideo();
    // }
    // this.pauseOutOfRangeAudios();
    // this.stopOutOfRangeVideo();
  }

  /**
   * Used by undo/redo to update the internal and vsc workspace.
   */
  private async syncAfterSessionChange(change: t.SessionChange, dir: t.Direction = t.Direction.Forwards) {
    // Apply changes to the internal workspace first.
    const uriSet: t.UriSet = new Set();
    const effects = dir === t.Direction.Forwards ? change.effects : change.effects.slice().reverse();
    for (const effect of effects) {
      await this.applySessionChangeEffect(effect, dir, uriSet);
    }

    // Duration may have changed. Pull back if so.
    // const isIndexPastEnd = this.internalWorkspace.eventIndex >= this.session.body.editorEvents.length;
    // const isDurPastEnd = (this.internalWorkspace.getCurrentEvent()?.clock ?? 0) > this.session.head.duration;
    // if (isDurPastEnd) {
    // await this.internalWorkspace.seek(this.session.head.duration, uriSet);
    // }

    // TODO if clock was at the end, make sure it stays at the end.

    // Duration may have changed. Update clock.
    this.clock = Math.min(this.session.head.duration, this.clock);

    // Sync vscode
    await this.vscWorkspace.sync(Array.from(uriSet));

    // Sync media
    await this.syncMedia();
  }

  /**
   * Maintain this.internalWorkspace in sync based on the effects caused by a change in session head/body.
   */
  private async applySessionChangeEffect(effect: t.SessionChangeEffect, dir: t.Direction, uriSet: t.UriSet) {
    switch (effect.type) {
      case 'insertEditorEvent': {
        if (dir === t.Direction.Forwards) {
          if (this.internalWorkspace.eventIndex === effect.index - 1) {
            // apply event
            const step: SeekStep = { event: effect.event, index: effect.index };
            await this.internalWorkspace.applySeekStep(step, t.Direction.Forwards, uriSet);
            // this.clock = effect.event.clock;
          }
        } else {
          if (this.internalWorkspace.eventIndex === effect.index) {
            // unapply event
            const step: SeekStep = { event: effect.event, index: effect.index };
            await this.internalWorkspace.applySeekStep(step, t.Direction.Backwards, uriSet);
          }
        }

        break;
      }
      case 'updateEditorEvent': {
        // If event clocks are not the same, then we should update this.clock.
        assert(effect.eventAfter.clock === effect.eventBefore.clock);

        if (dir === t.Direction.Forwards) {
          if (this.internalWorkspace.eventIndex === effect.index) {
            // unapply eventBefore
            const step1: SeekStep = { event: effect.eventBefore, index: effect.index };
            await this.internalWorkspace.applySeekStep(step1, t.Direction.Backwards, uriSet);

            // apply eventAfter
            const step2: SeekStep = { event: effect.eventAfter, index: effect.index };
            await this.internalWorkspace.applySeekStep(step2, t.Direction.Forwards, uriSet);
          }
        } else {
          if (this.internalWorkspace.eventIndex === effect.index) {
            // unapply eventAfter
            const step1: SeekStep = { event: effect.eventAfter, index: effect.index };
            await this.internalWorkspace.applySeekStep(step1, t.Direction.Backwards, uriSet);

            // apply eventBefore
            const step2: SeekStep = { event: effect.eventBefore, index: effect.index };
            await this.internalWorkspace.applySeekStep(step2, t.Direction.Forwards, uriSet);
          }
        }

        break;
      }
      case 'cropEditorEvents': {
        if (dir === t.Direction.Forwards) {
          if (this.internalWorkspace.eventIndex >= effect.index) {
            // Unapply cropped events except those after current eventIndex
            // indexes         0  1  2  3  4  5  6
            // ei                             |
            // effect.events            |________|
            // effect.index             |
            // unapply                  |_____|
            // final ei              |
            const steps: SeekStep[] = effect.events
              .map((event, i) => ({ event, index: effect.index + i }))
              .filter(s => s.index <= this.internalWorkspace.eventIndex)
              .reverse();
            const seekData: SeekData = { steps, direction: t.Direction.Backwards };
            await this.internalWorkspace.seekWithData(seekData, uriSet);
          }
        } else {
          if (this.internalWorkspace.eventIndex === effect.index - 1) {
            // Apply cropped events
            const steps: SeekStep[] = effect.events.map((event, i) => ({ event, index: effect.index + i }));
            const seekData: SeekData = { steps, direction: t.Direction.Forwards };
            await this.internalWorkspace.seekWithData(seekData, uriSet);
            // this.clock = this.internalWorkspace.getCurrentEvent()?.clock ?? this.clock;
          }
        }

        break;
      }
      default:
        lib.unreachable(effect, 'Unknown effect type');
    }
  }

  private async stopOnError<T>(promise: Promise<T>): Promise<T> {
    try {
      return await promise;
    } catch (error) {
      this.gotError();
      throw error;
    }
  }

  private gotError() {
    this.pause();
    this.mode.status = Status.Error;
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
}
