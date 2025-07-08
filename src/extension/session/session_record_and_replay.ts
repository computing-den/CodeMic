import vscode from 'vscode';
import * as t from '../../lib/types.js';
import * as lib from '../../lib/lib.js';
import assert from '../../lib/assert.js';
import type { LoadedSession } from './session.js';
import config from '../config.js';
import InternalWorkspace, { SeekData, SeekStep } from './internal_workspace.js';
import WorkspacePlayer from './workspace_player.js';
import WorkspaceRecorder from './workspace_recorder.js';
import VscWorkspace from './vsc_workspace.js';
import QueueRunner from '../../lib/queue_runner.js';
import _ from 'lodash';
import { UpdateLoopAsync } from '../../lib/update_loop_async.js';

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

const BLANK_VIDEO_ID = '00000000-33fd-4f9d-95dc-37e211464000';

export default class SessionRecordAndReplay {
  session: LoadedSession;
  clock = 0;

  private internalWorkspace: InternalWorkspace;
  private vscWorkspace: VscWorkspace;

  private workspacePlayer: WorkspacePlayer;
  private workspaceRecorder: WorkspaceRecorder;

  private statusBarItem: vscode.StatusBarItem;
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

    // Create status bar item.
    this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0);

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

  get inRecorderMode(): boolean {
    return this.mode.recorder;
  }

  get playing(): boolean {
    return Boolean(this.running && !this.mode.recorder);
  }

  get inPlayerMode(): boolean {
    return !this.mode.recorder;
  }

  get _test_internalWorkspace(): InternalWorkspace {
    return this.internalWorkspace;
  }

  get _test_vscWorkspace(): VscWorkspace {
    return this.vscWorkspace;
  }

  async enqueueLoadWorkspace(options?: { clock?: number }) {
    await this.pauseOnError(this.queue.enqueue(this.loadWorkspace.bind(this), options));
  }

  async enqueueScan() {
    await this.pauseOnError(this.queue.enqueue(this.scan.bind(this)));
  }

  async enqueuePlay() {
    await this.pauseOnError(this.queue.enqueue(this.play.bind(this)));
  }

  async enqueueRecord() {
    await this.pauseOnError(this.queue.enqueue(this.record.bind(this)));
  }

  async enqueueSeek(clock: number, useStepper?: boolean) {
    await this.pauseOnError(this.queue.enqueue(this.seek.bind(this), clock, useStepper));
  }

  async enqueueSync(clock?: number) {
    await this.pauseOnError(this.queue.enqueue(this.sync.bind(this), clock));
  }

  /**
   * This may be called from gotError which may be called from inside a queue
   * task. So it must not be queued itself.
   */
  async pause(opts?: { withError?: true }) {
    if (!this.running) return;

    this.updateLoop.stop();
    this.queue.clear();
    this.mode.status = opts?.withError ? Status.Error : Status.Paused;
    if (this.mode.recorder) {
      this.statusBarItem.text = '$(record) Record';
      this.statusBarItem.tooltip = 'CodeMic: click to continue recording';
      this.statusBarItem.backgroundColor = undefined;
      this.statusBarItem.command = 'codemic.record';
    } else {
      this.statusBarItem.text = '$(play) Play';
      this.statusBarItem.tooltip = 'CodeMic: click to continue playing';
      this.statusBarItem.backgroundColor = undefined;
      1;
      this.statusBarItem.command = 'codemic.play';
    }
    this.statusBarItem.show();

    // Pause media.
    // Must not await on the queue because pause() may be called from inside a
    // queue task.
    this.enqueuePauseAllMedia().catch(console.error);

    // Pause workspace.
    if (this.mode.recorder) {
      this.workspaceRecorder.pause();
      await this.session.editor.write({ ifDirty: true }); // will write history too
    } else {
      this.workspacePlayer.pause();
      await this.session.core.writeHistoryClock();
    }
  }

  async dispose() {
    this.statusBarItem.hide();
    await this.pause();
  }

  async enqueueSyncAfterSessionChange(change: t.SessionChange) {
    await this.pauseOnError(this.queue.enqueue(this.syncAfterSessionChange.bind(this), change));
  }

  async enqueueSyncMedia(opts?: { hard?: boolean }) {
    await this.pauseOnError(this.queue.enqueue(this.syncMedia.bind(this)));
  }

  async makeTest() {
    return this.vscWorkspace.makeTest();
  }

  private async enqueueUpdate(diffMs: number) {
    await this.pauseOnError(this.queue.enqueue(this.update.bind(this, diffMs)));
  }

  /**
   * useStepper is only useful during testing to test the stepper.
   */
  private async seek(clock: number, useStepper?: boolean) {
    this.clock = Math.max(0, Math.min(this.session.head.duration, clock));

    if (useStepper) {
      await this.workspacePlayer.seek(clock, useStepper);
    } else {
      const uriSet: t.UriSet = new Set();
      await this.internalWorkspace.seek(this.clock, uriSet);
      await this.vscWorkspace.sync(Array.from(uriSet));
    }

    await this.syncMedia({ hard: true });
    this.updateLoop.resetDiff();
    this.session.onProgress?.();
  }

  private async sync(clock?: number) {
    // assert(!this.running, 'Cannot sync while playing/recording');

    if (clock !== undefined) {
      this.clock = Math.max(0, Math.min(this.session.head.duration, clock));
    }
    await this.internalWorkspace.seek(this.clock);
    await this.vscWorkspace.sync();

    await this.syncMedia({ hard: true });
    this.updateLoop.resetDiff();

    if (clock !== undefined) {
      this.session.onProgress?.();
    }
  }

  private async loadWorkspace(options?: { clock?: number }) {
    // Create workspace directory.
    await this.session.core.createWorkspaceDir();

    // Initialize internal workspace.
    await this.internalWorkspace.restoreInitState();

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
      this.clock = Math.max(0, Math.min(this.session.head.duration, options.clock));
      const uriSet: t.UriSet = new Set();
      await this.internalWorkspace.seek(options.clock, uriSet);
      targetUris = Array.from(uriSet);
    }

    // Sync and save.
    await this.vscWorkspace.sync(targetUris);
    // await this.vscWorkspace.saveAllRelevantVscTabs();

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
    // If user double-clicks on the play button, it might call twice.
    if (this.running) return;

    this.mode.recorder = false;
    this.mode.status = Status.Running;
    this.statusBarItem.text = '$(debug-pause) Pause';
    this.statusBarItem.tooltip = 'CodeMic: click to pause playing';
    this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    this.statusBarItem.command = 'codemic.pause';
    this.statusBarItem.show();

    // Find possible seek clock.
    let seekTo: number | undefined;
    if (this.session.editor.selection) {
      const tracks = _.concat<t.RangedTrack>(
        this.session.body.audioTracks ?? [],
        this.session.body.videoTracks ?? [],
        this.session.body.imageTracks ?? [],
      );
      const selectionClockRange = lib.getRecorderSelectionClockRange(
        this.session.editor.selection,
        tracks,
        this.session.head.toc,
      );
      if (selectionClockRange) {
        seekTo = selectionClockRange.start;
      }
    } else if (this.isAlmostAtTheEnd()) {
      seekTo = 0;
    }

    // Seek and sync.
    if (seekTo !== undefined) {
      this.clock = seekTo;
      await this.internalWorkspace.seek(seekTo);
    }
    await this.vscWorkspace.sync();

    await this.syncMedia({ hard: true });
    await this.workspacePlayer.play();
    this.updateLoop.start();
  }

  private async record() {
    // If user double-clicks on the pause button, it might call twice.
    if (this.running) return;

    this.mode.recorder = true;
    this.mode.status = Status.Running;
    this.statusBarItem.text = '$(debug-pause) Pause';
    this.statusBarItem.tooltip = 'CodeMic: click to pause recording';
    this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
    this.statusBarItem.command = 'codemic.pause';
    this.statusBarItem.show();

    // Seek and sync.
    this.clock = this.session.head.duration;
    await this.internalWorkspace.seek(this.session.head.duration);
    await this.vscWorkspace.sync();

    await this.workspaceRecorder.record();
    this.updateLoop.start();
  }

  /**
   * Only meant to be called by the update loop. Don't call it directly or make
   * it do anything special when diffMs is 0. Also, it shouldn't be called
   * directly to update everything for seek(). Call sync workspace and media
   * directly.
   *
   * On error, it will call this.session.onError and also throw.
   */
  private async update(diffMs: number) {
    try {
      // Wait until all media have loaded enough data to play through.
      const mediaStatuses = await this.getMediaStatuses();
      const isLoading = _.some(mediaStatuses, s => Boolean(s.src) && s.readyState < 4);
      if (isLoading) {
        if (_.some(mediaStatuses, s => !s.paused)) {
          await this.pauseAllMedia();
        }
        return;
      }

      // Update clock.
      this.clock += diffMs / 1000;

      // Update workspace.
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

      // Sync media.
      await this.syncMedia({ mediaStatuses });

      // Pause if reached the end during playback.
      if (!this.mode.recorder && this.clock === this.session.head.duration) {
        await this.pause();
      }

      // Trigger callback to update frontend.
      this.session.onProgress?.();
    } catch (error) {
      this.session.onError?.(error as Error);
      throw error;
    }
  }

  /**
   * If mediaStatuses is not passed, it'll fetch it automatically. Useful when
   * caller already has mediaStatuses.
   */
  private async syncMedia(opts?: { mediaStatuses?: t.MediaStatuses; hard?: boolean }) {
    if (!this.session.context.webviewProvider.isReady) return;

    const mediaStatuses = opts?.mediaStatuses ?? (await this.getMediaStatuses());
    const postMessage = this.session.context.webviewProvider.postMessage.bind(this.session.context.webviewProvider);

    // Only one video at a time (the last one).
    const inRangeVideoTrack = _.findLast(this.session.body.videoTracks, t => this.isTrackInRange(t));
    // const outOfRangeVideoTracks = this.session.body.videoTracks.filter(t => t !== inRangeVideoTrack);

    // Only one image at a time (the last one).
    // Images are shown using the video element, so they override the video.
    const inRangeImageTrack = _.findLast(this.session.body.imageTracks, t => this.isTrackInRange(t));

    // TODO once we merge all track types, the order should be which ever comes last.
    const inRangeVideoOrImageTrack = inRangeImageTrack ?? inRangeVideoTrack;

    // If there is at least one video track, but no in-range video, load the
    // blank video on loop so that the frontend has a video it can use to
    // prepare the HTMLVideoElement on user interaction.
    // First check if the blank video is already running.
    const showingBlankVideo = this.session.body.videoTracks.length > 0 && !inRangeVideoOrImageTrack;
    if (showingBlankVideo) {
      if (!mediaStatuses[BLANK_VIDEO_ID]) {
        await postMessage({
          type: 'media/load',
          mediaType: 'video',
          id: BLANK_VIDEO_ID,
          src: this.session.context.webviewProvider
            .asWebviewUri(this.session.context.extension.extensionUri.fsPath, 'resources', 'blank_360p.mp4')
            .toString(),
          clock: 0,
          loop: true,
          blank: true,
        });
      }
    }

    // if (!inRangeVideoTrack) {
    //   // Dispose of out of range video tracks.
    //   const videoTracksToDispose = outOfRangeVideoTracks.filter(t => mediaStatuses[t.id]);
    //   await Promise.all(
    //     videoTracksToDispose.map(t => postMessage({ type: 'media/dispose', mediaType: t.type, id: t.id })),
    //   );
    // }

    // Pause all out-of-range audio tracks. We dont' dispose of audio tracks
    // because they're always loaded. See comments below.
    const outOfRangeAudioTracks = this.session.body.audioTracks.filter(t => !this.isTrackInRange(t));
    const audioTracksToPause = outOfRangeAudioTracks.filter(t => mediaStatuses[t.id]);
    await Promise.all(audioTracksToPause.map(t => postMessage({ type: 'media/pause', mediaType: t.type, id: t.id })));

    // Load all audios and the in-range video.
    //
    // All audio files must be *always* loaded and only paused when out of
    // range. This way, on the frontend, play() and seek() can prepare audio
    // tracks immediately. Otherwise, if we load and play an audio during
    // playback, we get the error "play() can only be initiated by a user
    // gesture."
    //
    // We can get away with this for video because there is only one
    // HTMLVideoElement on the page and on the frontend, play() and seek()
    // prepare the HTMLVideoElement immediately.
    const tracksToLoad = _.compact([...this.session.body.audioTracks, inRangeVideoOrImageTrack]).filter(
      t => !mediaStatuses[t.id],
    );
    await Promise.all(
      tracksToLoad.map(t => {
        assert(t.file.type === 'blob');
        return postMessage({
          type: 'media/load',
          mediaType: t.type,
          id: t.id,
          src: this.session.context.webviewProvider
            .asWebviewUri(this.session.core.dataPath, 'blobs', t.file.sha1)
            .toString(),
          clock: this.globalClockToTrackLocal(t),
        });
      }),
    );

    // Combine in range tracks.
    const inRangeAudioTracks = this.session.body.audioTracks.filter(t => this.isTrackInRange(t));
    const inRangeTracks = _.compact([...inRangeAudioTracks, inRangeVideoOrImageTrack]);

    // Seek. When opts.hard, seek exactly to current clock, otherwise, seek only
    // if clock is too far off.
    const clockDiffThreshold = 3;
    const shouldSeekTrack = (t: t.RangedTrack) => {
      if (inRangeVideoOrImageTrack?.type === 'image') return false;
      if (!mediaStatuses[t.id]) return false;
      const trackGlobalClock = this.trackLocalClockToGlobal(mediaStatuses[t.id].currentTime, t);
      const clockDiff = Math.abs(trackGlobalClock - this.clock);
      return opts?.hard || clockDiff >= clockDiffThreshold;
    };
    const tracksToSeek = inRangeTracks.filter(shouldSeekTrack);
    await Promise.all(
      tracksToSeek.map(t =>
        postMessage({ type: 'media/seek', mediaType: t.type, id: t.id, clock: this.globalClockToTrackLocal(t) }),
      ),
    );

    // Play in-range tracks if session is running. We may call syncMedia() just
    // to load the tracks and the video without wanting to play yet.
    if (this.running) {
      const tracksToPlay = inRangeTracks.filter(t => mediaStatuses[t.id]?.paused);
      await Promise.all(tracksToPlay.map(t => postMessage({ type: 'media/play', mediaType: t.type, id: t.id })));
    }

    // Adjust playback rate to catch up with current clock if track was not already sought.
    const tracksNotSought = _.difference(inRangeTracks, tracksToSeek);
    const tracksToAdjustRate = tracksNotSought.filter(t => mediaStatuses[t.id] && t.type !== 'image');
    await Promise.all(
      tracksToAdjustRate.map(t => {
        const trackGlobalClock = this.trackLocalClockToGlobal(mediaStatuses[t.id].currentTime, t);
        const rate = lib.adjustTrackPlaybackRate(this.clock, trackGlobalClock);
        if (rate !== undefined && Math.abs(mediaStatuses[t.id].playbackRate - rate) > 0.001) {
          return postMessage({ type: 'media/setPlaybackRate', mediaType: t.type, id: t.id, rate });
        }
      }),
    );

    // Dispose of any audio or video that no longer exists.
    // This only happens in recorder when the user deletes a track.
    const allTracks = [
      ...this.session.body.audioTracks,
      ...this.session.body.videoTracks,
      ...this.session.body.imageTracks,
    ];
    await Promise.all(
      _.map(mediaStatuses, (mediaStatus, id) => {
        const track = allTracks.find(t => t.id === id);
        if (!track && !(id === BLANK_VIDEO_ID && showingBlankVideo)) {
          return postMessage({ type: 'media/dispose', mediaType: mediaStatus.type, id });
        }
      }),
    );
  }

  private async getMediaStatuses(): Promise<t.MediaStatuses> {
    const res = await this.session.context.webviewProvider.postMessage({ type: 'media/statuses' });
    assert(res.type === 'mediaStatuses');
    return res.mediaStatuses;
  }

  private async enqueuePauseAllMedia() {
    await this.queue.enqueue(this.pauseAllMedia.bind(this));
  }

  private async pauseAllMedia() {
    await this.session.context.webviewProvider.postMessage({ type: 'media/pauseAll' });
  }

  /**
   * Used by undo/redo to update the internal and vsc workspace.
   */
  private async syncAfterSessionChange(change: t.SessionChange) {
    const uriSet: t.UriSet = new Set();

    // Apply session effects.
    // Makes sure internal workspace stays consistent.
    // May also update this.clock and editor.selection after speed change, merge, etc.
    if (change.direction === t.Direction.Forwards) {
      for (const effect of change.next.effects) {
        await this.applySessionEffect(change, effect, uriSet);
      }
    } else {
      for (const effect of change.cur.effects.slice().reverse()) {
        await this.applySessionEffect(change, effect, uriSet);
      }
    }

    // If clock was at the end, stay at the end.
    if (this.clock === change.cur.head.duration) {
      this.clock = this.session.head.duration;
    }

    // Duration may have changed. Make sure it's not past the end.
    this.clock = Math.min(this.session.head.duration, this.clock);

    // Make sure internal workspace and vsc are in sync at this.clock.
    await this.internalWorkspace.seek(this.clock, uriSet);
    await this.vscWorkspace.sync(Array.from(uriSet));

    // Sync media
    await this.syncMedia({ hard: true });
  }

  /**
   * Maintains this.internalWorkspace based on the effects caused by a change in session head/body.
   * Updates this.clock and editor.selection after speed change, merge, etc.
   */
  private async applySessionEffect(change: t.SessionChange, effect: t.SessionEffect, uriSet: t.UriSet) {
    switch (effect.type) {
      case 'insertEditorEvent': {
        if (change.direction === t.Direction.Forwards) {
          assert(this.internalWorkspace.eventIndex < effect.index);
        } else {
          assert(this.internalWorkspace.eventIndex <= effect.index);
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

        if (change.direction === t.Direction.Forwards) {
          assert(this.internalWorkspace.eventIndex <= effect.index);
          if (this.internalWorkspace.eventIndex === effect.index) {
            // unapply eventBefore
            const step1: SeekStep = { event: effect.eventBefore, index: effect.index };
            await this.internalWorkspace.applySeekStep(step1, t.Direction.Backwards, uriSet);

            // apply eventAfter
            const step2: SeekStep = { event: effect.eventAfter, index: effect.index };
            await this.internalWorkspace.applySeekStep(step2, t.Direction.Forwards, uriSet);
          }
        } else {
          assert(this.internalWorkspace.eventIndex <= effect.index);
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
        if (change.direction === t.Direction.Forwards) {
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
          assert(this.internalWorkspace.eventIndex < effect.index);

          // if rr.clock used to be after the crop point, restore it.
          if (effect.rrClock > effect.clock) {
            this.clock = effect.rrClock;
          }
        }

        break;
      }
      case 'changeSpeed': {
        if (change.direction === t.Direction.Forwards) {
          this.clock = lib.calcClockAfterSpeedChange(this.clock, effect.range, effect.factor);
        } else {
          const inverse = lib.invertSpeedChange(effect.range, effect.factor);
          // If rr.clock used to be inside the range, restore the exact clock
          // without losing precision. Otherwise, calculate the new clock.
          if (lib.isClockInRange(effect.rrClock, effect.range)) {
            this.clock = effect.rrClock;
          } else {
            this.clock = lib.calcClockAfterSpeedChange(this.clock, inverse.range, inverse.factor);
          }
        }

        break;
      }
      case 'merge': {
        if (change.direction === t.Direction.Forwards) {
          this.clock = lib.calcClockAfterMerge(this.clock, effect.range);
        } else {
          // If rr.clock used to be inside the range, restore the exact
          // clock. Otherwise, treat the undo as an insert gap.
          if (lib.isClockInRange(effect.rrClock, effect.range)) {
            this.clock = effect.rrClock;
          } else {
            this.clock = lib.calcClockAfterInsertGap(
              this.clock,
              effect.range.start,
              effect.range.end - effect.range.start,
            );
          }
        }

        break;
      }
      case 'insertGap': {
        const range = { start: effect.clock, end: effect.clock + effect.duration };

        if (change.direction === t.Direction.Forwards) {
          this.clock = lib.calcClockAfterInsertGap(this.clock, effect.clock, effect.duration);
        } else {
          // If rr.clock used to be inside the range, restore the exact
          // clock. Otherwise, treat the undo as an insert gap.
          if (lib.isClockInRange(effect.rrClock, range)) {
            this.clock = effect.rrClock;
          } else {
            this.clock = lib.calcClockAfterMerge(this.clock, range);
          }
        }

        break;
      }
      case 'setSelection': {
        if (change.direction === t.Direction.Forwards) {
          this.session.editor.setSelection(effect.after);
        } else {
          this.session.editor.setSelection(effect.before);
        }

        break;
      }
      default:
        lib.unreachable(effect, 'Unknown effect type');
    }
  }

  private async pauseOnError<T>(promise: Promise<T>): Promise<T> {
    try {
      return await promise;
    } catch (error) {
      this.gotError();
      throw error;
    }
  }

  private gotError() {
    this.pause({ withError: true });
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

  private trackLocalClockToGlobal(trackLocalClock: number, t: t.RangedTrack): number {
    return lib.clockToGlobal(trackLocalClock, t.clockRange);
  }
}
