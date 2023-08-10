export default class FakeMedia {
  private request: any;
  private lastTime: DOMHighResTimeStamp = 0;

  static intervalMs: number = 200;

  constructor(private listener: (time: number) => void, public time: number = 0) {
    // this.start();
  }

  // set(time: number) {
  //   this.time += (performance.now() - )
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
    const time = performance.now();
    this.time += time - this.lastTime;
    this.lastTime = time;
    this.listener(this.time);
    this.request = setTimeout(this.handle, FakeMedia.intervalMs);
  };
}
