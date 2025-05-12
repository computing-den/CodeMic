import assert from './assert.js';

/**
 * Calls cb, waits until it resolves, waits for intervalMs, repeats.
 * The difference in ms between the calls is sent to cb. The first call gets diffMs == 0.
 * The loop continues even if cb throws.
 * Returns a stop callback.
 */
export class UpdateLoopAsync {
  private lastTimestamp: number | undefined;
  private timeout: any;
  private running = false;

  constructor(private cb: (diffMs: number) => any, private intervalMs: number) {}

  start() {
    if (!this.running) {
      this.lastTimestamp = undefined;
      this.running = true;
      this.step();
    }
  }

  stop() {
    this.lastTimestamp = undefined;
    this.running = false;
    clearTimeout(this.timeout);
  }

  resetDiff() {
    this.lastTimestamp = undefined;
  }

  private async step() {
    const timestamp = performance.now();
    const diffMs = this.lastTimestamp ? timestamp - this.lastTimestamp : 0;
    assert(diffMs >= 0);

    try {
      await this.cb(diffMs);
    } catch (error) {
      console.error(error);
    }

    if (this.running) {
      this.lastTimestamp = timestamp;
      this.timeout = setTimeout(this.step.bind(this), this.intervalMs);
    }
  }
}
