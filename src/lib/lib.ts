import _ from 'lodash';
import * as t from './types.js';

export function unreachable(arg: never, message: string = 'Unreachable'): never {
  throw new Error(`${message}: ${JSON.stringify(arg)}`);
}

export function timeout<Req>(ms: number, value?: Req): Promise<Req> {
  return new Promise(resolve => setTimeout(resolve, ms, value));
}

/**
 * Used to limit the number of simultaneous executions of async consumer.
 */
type Task = { args: any[]; resolve: Function; reject: Function };
type TaskConsumer = (...args: any[]) => Promise<any>;
type TaskQueue<F> = F & {
  clear(): void;
  rejectAllInQueue(): void;
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
  supply.rejectAllInQueue = () => {
    for (const item of queue) {
      item.reject(new CancelledError());
    }
    queue.length = 0;
  };
  supply.getQueue = () => queue;
  supply.getQueueSize = () => queue.length;
  supply.getConsumerCount = () => consumerCount;
  return supply as TaskQueue<F>; // didn't find a better way to type this
}

export class CancelledError extends Error {
  constructor() {
    super('Cancelled');
  }
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

export function getSessionHistoryItemLastOpenTimestamp(h: t.SessionHistory): string | undefined {
  return _.max([h.lastRecordedTimestamp, h.lastWatchedTimestamp]);
}

export function vec2Sub(a: t.Vec2, b: t.Vec2): t.Vec2 {
  return [a[0] - b[0], a[1] - b[1]];
}

export function vec2InRect(v: t.Vec2, rect: t.Rect, offset?: Partial<t.Rect>): boolean {
  const ol = offset?.left ?? 0;
  const ot = offset?.top ?? 0;
  const or = offset?.right ?? 0;
  const ob = offset?.bottom ?? 0;
  return v[0] >= rect.left - ol && v[0] <= rect.right + or && v[1] >= rect.top - ot && v[1] <= rect.bottom + ob;
}

export function rectMid(rect: t.Rect): t.Vec2 {
  return [(rect.left + rect.right) / 2, (rect.top + rect.bottom) / 2];
}

export function approxEqual(a: number, b: number, tolerance: number) {
  return Math.abs(a - b) <= tolerance;
}

export function isClockInRange(clock: number, range: t.ClockRange): boolean {
  return clock >= range.start && clock < range.end;
}

export function doClockRangesIntersect(a: t.ClockRange, b: t.ClockRange): boolean {
  /*
     a: 0-5, b: 5-10
     a: -----
     b:      -----
     NO INTERSECTION: b.start (5) < a.end (5) && a.start (0) < b.end (10)


     a: 0-5, b: 4-10
     a: -----
     b:     -----
     INTERSECTION: b.start (4) < a.end (5) && a.start (0) < b.end (10)

  */
  return b.start < a.end && a.start < b.end;
}

export function getClockRangeDur(r: t.ClockRange): number {
  return r.end - r.start;
}

export function clockToLocal(clock: number, range: t.ClockRange): number {
  return clock - range.start;
}

export function clockToGlobal(clock: number, range: t.ClockRange): number {
  return clock + range.start;
}

export function userToUserSummary(user: t.User): t.UserSummary {
  return _.pick(user, 'username', 'email', 'joinTimestamp');
}

// export async function asyncFilter<T>(collection: T[], cb: (x: T, i: number) => Promise<boolean>): Promise<T[]> {
//   const bools = await Promise.all(collection.map(cb));
//   return collection.filter((x, i) => bools[i]);
// }

/**
 * Use this instead of splice to support large number of inserts without hitting the stack limit.
 */
export function insertIntoArray<T>(array: T[], newItems: T[], at: number) {
  array.length += newItems.length;
  array.copyWithin(at + newItems.length, at);
  for (let i = 0; i < newItems.length; i++) {
    array[at + i] = newItems[i];
  }
}

// export function getOrSetMap<T,U>(map: Map<T,U>, key: T, make: () => U):
