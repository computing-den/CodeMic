import _ from 'lodash';

export function timeout(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Used to limit the number of simultaneous executions of async consumer.
 */
type Task = { args: any[]; resolve: Function; reject: Function };
type TaskConsumer = (...args: any[]) => Promise<any>;
type TaskQueue<F> = F & {
  clear(): void;
  getQueue(): Task[];
  getQueueSize(): number;
  getConsumerCount(): number;
};
export function taskQueue<F extends TaskConsumer>(consumer: F, maxConcurrency: number = 1): TaskQueue<F> {
  const queue: Task[] = [];
  let consumerCount = 0;

  function dispatch() {
    while (consumerCount < maxConcurrency && queue.length > 0) {
      consume(queue.shift()!);
    }
  }

  async function consume(task: Task) {
    consumerCount++;
    try {
      const res = await consumer(...task.args);
      task.resolve(res);
    } catch (error) {
      task.reject(error);
    } finally {
      consumerCount--;
      dispatch();
    }
  }

  function supply(...args: any[]): Promise<any> {
    return new Promise((resolve, reject) => {
      queue.push({ args, resolve, reject });
      dispatch();
    });
  }

  supply.clear = () => {
    queue.length = 0;
  };
  supply.getQueue = () => queue;
  supply.getQueueSize = () => queue.length;
  supply.getConsumerCount = () => consumerCount;
  return supply as TaskQueue<F>; // didn't find a better way to type this
}

export function formatTimeSeconds(time: number, full: boolean = false): string {
  // 12345.777
  // 12345.777 / 60 / 60 = 3.4293825 h
  // 3.4293825 % 3 * 60 = 0.4293825 * 60 = 25.76295 m
  // 25.76295 % 25 * 60 = 45.777 s

  // hFrac = t / 3600, h = floor(hFrac)
  // mFrac = (hFrac - h) * 60, m = floor(mFrac)
  // sFrac = (mFrac - m) * 60, s = floor(sFrac)

  const hFrac = time / 3600;
  const h = Math.floor(hFrac);

  const mFrac = (hFrac - h) * 60;
  const m = Math.floor(mFrac);

  const sFrac = (mFrac - m) * 60;
  const s = Math.floor(sFrac);

  const hStr = String(h).padStart(2, '0');
  const mStr = String(m).padStart(2, '0');
  const sStr = String(s).padStart(2, '0');

  return h || full ? `${hStr}:${mStr}:${sStr}` : `${mStr}:${sStr}`;
}
