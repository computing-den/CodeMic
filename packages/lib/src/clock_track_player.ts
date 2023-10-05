import * as t from './types.js';

export default class ClockTrackPlayer implements t.TrackPlayer {
  clock: number = 0;
  status: t.TrackPlayerStatus = t.TrackPlayerStatus.Paused;
  onProgress?: (clock: number) => any;
  onStatusChange?: (status: t.TrackPlayerStatus) => any;

  private timeOriginMs: number = 0;
  private clockOrigin: number = 0;
  private request: any;

  constructor(public intervalMs: number) {}

  /**
   * Will reset the timeout if called while already playing.
   */
  async start() {
    this.timeOriginMs = performance.now();
    this.clockOrigin = this.clock;

    clearTimeout(this.request);
    this.request = setTimeout(this.handleInterval, this.intervalMs);

    this.status = t.TrackPlayerStatus.Playing;
    this.onStatusChange?.(this.status);
  }

  async pause() {
    clearTimeout(this.request);
    this.request = undefined;

    this.status = t.TrackPlayerStatus.Paused;
    this.onStatusChange?.(this.status);
  }

  async stop() {
    clearTimeout(this.request);
    this.request = undefined;

    this.status = t.TrackPlayerStatus.Stopped;
    this.onStatusChange?.(this.status);
  }

  async seek(clock: number) {
    this.clock = clock;
    if (this.status === t.TrackPlayerStatus.Playing) {
      this.start();
    }
  }

  dispose() {}

  private handleInterval = () => {
    const nowMs = performance.now();
    const sinceOriginMs = nowMs - this.timeOriginMs;
    this.clock = this.clockOrigin + sinceOriginMs / 1000;
    this.onProgress?.(this.clock);
    this.request = setTimeout(this.handleInterval, this.intervalMs);
  };
}
