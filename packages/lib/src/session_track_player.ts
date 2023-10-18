import ClockTrackPlayer from './clock_track_player.js';
import * as lib from './lib.js';
import assert from './assert.js';
import * as t from './types.js';
import { v4 as uuid } from 'uuid';
import _ from 'lodash';

type UpdateQueueItem = { state: Partial<t.TrackPlayerState> | undefined; clock: number | undefined };

export default class SessionTrackPlayer implements t.TrackPlayer {
  get track(): t.Track {
    const maxTrackPlayer = _.maxBy(this.trackPlayers, p => p.track.clockRange.end)!;
    return { id: this.id, clockRange: maxTrackPlayer.track.clockRange };
  }

  name = 'Session';
  clock = 0;
  state: t.TrackPlayerState = {
    status: t.TrackPlayerStatus.Init,
    loading: false,
    loaded: false,
    buffering: false,
    seeking: false,
  };
  playbackRate = 1;

  onProgress?: (clock: number) => any;
  onStateChange?: (state: t.TrackPlayerState) => any;
  onChange?: () => any;

  private id = uuid();
  private trackPlayers: t.TrackPlayer[] = [];
  private timeout?: any;
  private updateQueue: UpdateQueueItem[] = [];
  private isUpdating = false;
  private DEV_timeOrigin = 0;
  // private masterClockTrackPlayer = new ClockTrackPlayer(100, 0);

  constructor() {}

  load() {
    assert(this.state.status !== t.TrackPlayerStatus.Error, 'Track has error');
    if (this.state.loaded || this.state.loading) return;

    this.DEV_timeOrigin = Date.now();
    this.update({ loading: true });
  }

  start() {
    assert(this.state.status !== t.TrackPlayerStatus.Error, 'Track has error');
    if (this.state.status === t.TrackPlayerStatus.Running) return;

    if (this.state.status === t.TrackPlayerStatus.Stopped) {
      this.update({ status: t.TrackPlayerStatus.Running, seeking: this.clock !== 0 }, 0);
    } else {
      this.update({ status: t.TrackPlayerStatus.Running });
    }
  }

  pause() {
    assert(this.state.status !== t.TrackPlayerStatus.Error, 'Track has error');
    if (this.state.status === t.TrackPlayerStatus.Paused) return;

    this.update({ status: t.TrackPlayerStatus.Paused });
  }

  stop() {
    if (this.state.status === t.TrackPlayerStatus.Stopped || this.state.status === t.TrackPlayerStatus.Error) return;

    this.update({ status: t.TrackPlayerStatus.Stopped });
  }

  seek(clock: number) {
    assert(this.state.status !== t.TrackPlayerStatus.Error, 'Track has error');

    this.update({ seeking: true }, clock);
  }

  setPlaybackRate(rate: number) {
    throw new Error('TODO');
  }

  dispose() {}

  addTrack(p: t.TrackPlayer) {
    // Add the track player and set callbacks.
    this.trackPlayers.push(p);
    p.onStateChange = () => this.update();
  }

  private update(partialState?: Partial<t.TrackPlayerState>, clock?: number) {
    console.log('update: clock: ', clock, ', partialState: ', partialState);

    // If already updating, we schedule another update immediately after the current one and return.
    this.updateQueue.push({ state: partialState, clock });
    if (this.isUpdating) return;

    // Clear scheduled updates.
    clearTimeout(this.timeout);
    this.timeout = undefined;

    // this.updateHelper() itself may trigger some updates which will schedule another update to be done immediately after.
    // Keep updating until no more update needs to be done.
    let originalState = { ...this.state };
    let originalClock = this.clock;
    this.isUpdating = true;
    while (this.updateQueue.length > 0) {
      // Merge the updateQueue into this.state and this.clock and then update
      while (this.updateQueue.length > 0) {
        const item = this.updateQueue.pop()!;
        if (item.state !== undefined) mergeState(this.state, item.state);
        if (item.clock !== undefined) this.clock = item.clock;
      }
      this.updateHelper();
    }
    this.isUpdating = false;

    // Set this.state and notify any listeners
    const stateChanged = !_.isEqual(originalState, this.state);
    const clockChanged = originalClock !== this.clock;
    if (stateChanged) this.onStateChange?.(this.state);
    if (clockChanged) this.onProgress?.(this.clock);
    if (stateChanged || clockChanged) this.onChange?.();

    // If running and not buffering/seeking/loading, schedule an update for the next frame.
    if (this.state.status === t.TrackPlayerStatus.Running && isReady(this)) {
      this.timeout = setTimeout(() => this.update(), (1 / 20) * 1000);
    }

    console.log('session track player: update done, state: ', this.state);
  }

  private updateHelper() {
    console.log(`\n----- Session Track Player updateHelper (${Date.now() - this.DEV_timeOrigin}ms) -----`);
    console.log(`-- session: `, this.clock, this.state);
    for (const p of this.trackPlayers) {
      console.log(`-- ${p.name}: `, p.clock, p.state);
    }

    // If any child has error, set status to error.
    if (this.trackPlayers.some(p => p.state.status === t.TrackPlayerStatus.Error)) {
      console.log('-- Setting status to error because a track has an error');
      this.state.status = t.TrackPlayerStatus.Error;
    }

    // If stopped or error, stop all children that are not stopped and we're done.
    if (this.state.status === t.TrackPlayerStatus.Stopped || this.state.status === t.TrackPlayerStatus.Error) {
      console.log(
        '-- Stopping all tracks because either session track is stopped or a track has an error. Status: ',
        t.TrackPlayerStatus[this.state.status],
      );
      for (const p of this.trackPlayers) p.stop();
      return;
    }

    // If not seeking, update clock to the running and ready child farthest ahead.
    // Assuming that clock never goes backwards except when seeking.
    if (!this.state.seeking) {
      for (const p of this.trackPlayers) {
        if (p.state.status === t.TrackPlayerStatus.Running && isReady(p)) {
          this.clock = Math.max(this.clock, this.getTrackPlayerAbsClock(p));
          console.log(
            `-- Updated the clock to ${p.name}'s: ${this.clock} because it's farthest ahead, running, and ready`,
          );
        }
      }
    }

    const inRange = this.getInRangeTrackPlayers();
    const outOfRange = this.getOutOfRangeTrackPlayers();
    const inRangeOrIncoming = this.getInRangeOrIncomingTrackPlayers();

    // Stop children that are out of range and still running.
    for (const p of outOfRange) {
      console.log('-- Stopping out of range track: ', p.name);
      p.stop();
    }

    // Load children that are not loaded/loading and are in range or soon will be.
    for (const p of inRangeOrIncoming) {
      console.log('-- Loading in-range or incoming track: ', p.name);
      p.load();
    }

    // ----- At this point -----------------------------------------------------
    // Status: Init, Running, or Paused.
    // Out-of-range children have been stopped.
    // In-range (and soon to be in range) children are either loading or loaded
    // -------------------------------------------------------------------------

    // Seek in-range children that are ready and too far off.
    for (const p of inRange) {
      if (isReady(p) && this.isTrackPlayerFarOff(p)) {
        console.log(
          `-- Seeking ${p.name} to ${this.getClockLocalToTrackPlayer(p)} (local clock) ` +
            `because it is ready and too far off`,
        );
        p.seek(this.getClockLocalToTrackPlayer(p));
      }
    }

    // Set playback rates of in-range children that are ready.
    for (const p of inRange) {
      if (isReady(p)) {
        this.adjustTrackPlayerPlaybackRate(p);
      }
    }

    // ----- At this point -----------------------------------------------------
    // Status: Init, Running, or Paused.
    // Out-of-range children have been stopped.
    // All in-range and ready children are at roughly the right position but
    // may or may not be running.
    // -------------------------------------------------------------------------

    // If loading and all in-range children are loaded, set loaded and unset loading
    if (this.state.loading && inRange.every(p => p.state.loaded)) {
      console.log(`-- Done loading because all in-range children are loaded`);
      this.state.loaded = true;
      this.state.loading = false;
    }

    // If buffering or seeking and all in-range children are ready, unset buffering and seeking
    if ((this.state.buffering || this.state.seeking) && inRange.every(p => isReady(p))) {
      console.log(`-- Done seeking/buffering because all in-range children are ready`);
      this.state.buffering = false;
      this.state.seeking = false;
    }

    // if ready, but an in-range child is not ready, set buffering and pause all in-range children.
    if (isReady(this) && inRange.some(p => !isReady(p))) {
      console.log(
        `-- Buffering and pausing all in-range children because ${inRange.find(p => !isReady(p))?.name} is not ready`,
      );
      this.state.buffering = true;
      for (const p of inRange) p.pause();
    }

    // ----- At this point -----------------------------------------------------
    // Status: Init, Running, or Paused.
    // Out-of-range children have been stopped.
    // All in-range and ready children are at roughly the right position but
    // may or may not be running.
    // State is up-to-date and reflects the state of children.
    // -------------------------------------------------------------------------

    // If paused, pause children that are running.
    if (this.state.status === t.TrackPlayerStatus.Paused) {
      for (const p of inRange) {
        console.log(`-- Pausing ${p.name} because it is in-range and session is paused`);
        p.pause();
      }
    }

    // If running and ready
    //   start children that are not running.
    if (this.state.status === t.TrackPlayerStatus.Running && isReady(this)) {
      for (const p of inRange) {
        console.log(`-- Starting ${p.name} because it is in-range and session is running and ready`);
        p.start();
      }
    }

    // If there are no in-range children, stop.
    if (inRange.length === 0) {
      this.stop();
    }

    // ----- At this point -----------------------------------------------------
    // Status: Init, Running, or Paused.
    // Out-of-range children have been stopped.
    // State is up-to-date and reflects the state of children.
    // If paused, all children are paused too.
    // If running, we're either ready and all children are running too or we're loading/buffering/seeking and waiting for children.
    // -------------------------------------------------------------------------

    console.log(`----------\n`);
  }

  /**
   * Returns track players whose clock range matches the master clock [start, end)
   */
  private getInRangeTrackPlayers(): t.TrackPlayer[] {
    return this.trackPlayers.filter(p => isClockInRange(this.clock, p.track.clockRange));
  }

  /**
   * Returns track players whose clock range expanded by 10s at the start matches the master clock [start - 10, end) but
   * it will in a few seconds
   */
  private getInRangeOrIncomingTrackPlayers(): t.TrackPlayer[] {
    return this.trackPlayers.filter(p =>
      isClockInRange(this.clock, { start: p.track.clockRange.start - 10, end: p.track.clockRange.end }),
    );
  }

  /**
   * Returns track players whose clock range does not match the master clock [start, end)
   */
  private getOutOfRangeTrackPlayers(): t.TrackPlayer[] {
    return this.trackPlayers.filter(p => !isClockInRange(this.clock, p.track.clockRange));
  }

  /**
   * Checks the range: (master clock - 1.0s, master clock + 0.1s)
   */
  private isTrackPlayerFarOff(p: t.TrackPlayer): boolean {
    return p.clock < this.clock - 1 || p.clock > this.clock + 0.1;
  }

  /**
   * Sets playback rate up to 3x slower/faster for a maximum clock difference of 3s.
   * Ignores changes of < 2%.
   */
  private adjustTrackPlayerPlaybackRate(p: t.TrackPlayer) {
    const pAbsClock = this.getTrackPlayerAbsClock(p);
    const absDiff = Math.abs(this.clock - pAbsClock);
    // If clock difference is less than 50ms, set playbackRate to 1.
    if (absDiff < 0.05) {
      this.playbackRate = 1;
    } else {
      const maxDiff = 3;
      const maxSpeedup = 3;

      const normDiff = Math.min(maxDiff, absDiff) / maxDiff;
      let playbackRate = 1 + normDiff * normDiff * (maxSpeedup - 1);

      // If p is ahead, slow it down.
      if (pAbsClock > this.clock) {
        playbackRate = 1 / playbackRate;
      }

      // Apply playbackRate if the change is > 3%.
      const playbackRateAbsDiff = Math.abs(p.playbackRate - playbackRate);
      if (playbackRateAbsDiff / playbackRate > 0.03) {
        console.log(`-- Setting playback rate of ${p.name} to ${playbackRate}`);
        p.setPlaybackRate(playbackRate);
      }
    }
  }

  private getTrackPlayerAbsClock(p: t.TrackPlayer): number {
    return p.clock + p.track.clockRange.start;
  }

  private getClockLocalToTrackPlayer(p: t.TrackPlayer): number {
    return this.clock - p.track.clockRange.start;
  }
}

function isReady(p: t.TrackPlayer) {
  return p.state.loaded && !p.state.loading && !p.state.buffering && !p.state.seeking;
}

/**
 * Clock must be in range [start, end).
 */
function isClockInRange(clock: number, range: t.ClockRange): boolean {
  return clock >= range.start && clock < range.end;
}

/**
 * Basically just Object.assign(dst, src) unless dst has error.
 */
function mergeState(dst: t.TrackPlayerState, src: Partial<t.TrackPlayerState>) {
  return dst.status === t.TrackPlayerStatus.Error ? dst : Object.assign(dst, src);
}
