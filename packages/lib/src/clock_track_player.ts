import * as t from './types.js';
import assert from './assert.js';
import { v4 as uuid } from 'uuid';

export default class ClockTrackPlayer implements t.TrackPlayer {
  name = 'clock';
  track: t.Track;
  clock = 0;
  state: t.TrackPlayerState = {
    status: t.TrackPlayerStatus.Init,
    loading: false,
    loaded: false,
    buffering: false,
    seeking: false,
  };
  playbackRate = 1;
  isRecorder = false;
  onProgress?: (clock: number) => any;
  onStateChange?: (state: t.TrackPlayerState) => any;

  private timeOriginMs: number = 0;
  private clockOrigin: number = 0;
  private request: any;

  constructor(public intervalMs: number) {
    this.track = { id: uuid(), clockRange: { start: 0, end: Infinity } };
  }

  load() {
    if (this.state.loaded || this.state.loading) return;
    this.updateState({ loading: true });
  }

  start() {
    if (this.state.status === t.TrackPlayerStatus.Running) return;

    this.restart();
    this.updateState({ status: t.TrackPlayerStatus.Running });
  }

  pause() {
    if (this.state.status === t.TrackPlayerStatus.Paused) return;

    clearTimeout(this.request);
    this.request = undefined;

    this.updateState({ status: t.TrackPlayerStatus.Paused });
  }

  stop() {
    if (this.state.status === t.TrackPlayerStatus.Stopped) return;

    clearTimeout(this.request);
    this.request = undefined;

    this.updateState({ status: t.TrackPlayerStatus.Stopped });
  }

  seek(clock: number) {
    this.clock = clock;
    this.validateClock();
    this.onProgress?.(this.clock);
    if (this.state.status === t.TrackPlayerStatus.Running) {
      this.restart();
    }
  }

  setClock(clock: number) {
    this.clock = clock;
  }

  extend(clock: number) {
    // this.track.clockRange.end = clock;
  }

  setPlaybackRate(rate: number) {
    this.playbackRate = rate;
  }

  dispose() {}

  private restart() {
    this.timeOriginMs = performance.now();
    this.clockOrigin = this.clock;

    clearTimeout(this.request);
    this.setTimeout();
  }

  private setTimeout() {
    this.request = setTimeout(this.handleInterval, this.intervalMs);
  }

  private updateState(partial: Partial<t.TrackPlayerState>) {
    this.state = { ...this.state, ...partial };
    this.onStateChange?.(this.state);
  }

  private handleInterval = () => {
    const nowMs = performance.now();
    const sinceOriginMs = nowMs - this.timeOriginMs;
    this.clock = this.clockOrigin + (sinceOriginMs / 1000) * this.playbackRate;
    this.validateClock();
    this.onProgress?.(this.clock);
    if (this.clock >= this.getDuration()) {
      this.stop();
    } else {
      this.setTimeout();
    }
  };

  private validateClock() {
    return Math.max(0, Math.min(this.getDuration(), this.clock));
  }

  private getDuration(): number {
    return this.track.clockRange.end - this.track.clockRange.start;
  }
}
