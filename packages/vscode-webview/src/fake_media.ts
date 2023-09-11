export default class FakeMedia {
  private request: any;
  private lastTime: DOMHighResTimeStamp = 0;

  static intervalMs: number = 200;

  constructor(private listener: (timeMs: number) => void, public timeMs: number = 0) {
    // this.start();
  }

  // set(timeMs: number) {
  //   this.timeMs += (performance.now() - )
  // }

  start() {
    this.lastTime = performance.now();
    this.request = setTimeout(this.handle, FakeMedia.intervalMs);
  }

  pause() {
    clearTimeout(this.request);
    this.request = undefined;
  }

  isActive(): boolean {
    return Boolean(this.request);
  }

  private handle = () => {
    const timeMs = performance.now();
    this.timeMs += timeMs - this.lastTime;
    this.lastTime = timeMs;
    this.listener(this.timeMs);
    this.request = setTimeout(this.handle, FakeMedia.intervalMs);
  };
}
