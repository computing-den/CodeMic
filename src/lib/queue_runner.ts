export default class QueueRunner {
  private queue: (() => Promise<any>)[] = [];
  private running = false;

  async enqueue<T, Args extends any[]>(fn: (...args: Args) => Promise<T>, ...args: Args): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const wrapped = async () => {
        try {
          const result = await fn(...args);
          resolve(result);
        } catch (err) {
          reject(err);
        }
      };
      this.queue.push(wrapped);
      this.run();
    });
  }

  clear() {
    this.queue.length = 0;
  }

  async wait(): Promise<void> {}

  private async run() {
    if (this.running) return;
    this.running = true;

    while (this.queue.length > 0) {
      const task = this.queue.shift();
      if (task) await task();
    }

    this.running = false;
  }
}
