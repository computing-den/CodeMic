import _ from 'lodash';
import * as t from './types.js';
import assert from './assert.js';

export const ANONYM_USERNAME = '_'; // minimum valid username is 3 characters

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

export function approxEqual(a: number, b: number, tolerance: number) {
  return Math.abs(a - b) <= tolerance;
}

export function isClockInRange(clock: number, range: t.ClockRange): boolean {
  return clock >= range.start && clock < range.end;
}

export function doClockRangesOverlap(a: t.ClockRange, b: t.ClockRange): boolean {
  /*
     a: 0-5, b: 5-10
     a: -----
     b:      -----
     NOT OVERLAPPING: b.start (5) < a.end (5) && a.start (0) < b.end (10)


     a: 0-5, b: 4-10
     a: -----
     b:     -----
     OVERLAPPING: b.start (4) < a.end (5) && a.start (0) < b.end (10)

  */
  return b.start < a.end && a.start < b.end;
}

export function getClockRangeOverlap(a: t.ClockRange, b: t.ClockRange): t.ClockRange | undefined {
  const start = Math.max(a.start, b.start);
  const end = Math.min(a.end, b.end);
  if (end > start) return { start, end };
}

export function getClockRangeOverlapDur(a: t.ClockRange, b: t.ClockRange): number {
  const start = Math.max(a.start, b.start);
  const end = Math.min(a.end, b.end);
  return Math.max(0, end - start);
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

export function calcClockAfterRangeSpeedChange(clock: number, range: t.ClockRange, factor: number): number {
  return clock + getClockRangeOverlapDur(range, { start: 0, end: clock }) * (1 / factor - 1);
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

export function isLoadedSession(session: t.SessionUIState): session is t.LoadedSessionUIState {
  return session.loaded;
}

export class Vec2 {
  constructor(public x: number, public y: number) {}
  sub(p: Vec2): Vec2 {
    return new Vec2(this.x - p.x, this.y - p.y);
  }
}

export class Rect {
  constructor(public top: number, public right: number, public bottom: number, public left: number) {}

  get height(): number {
    return this.bottom - this.top;
  }

  get width(): number {
    return this.right - this.left;
  }

  get midPoint(): Vec2 {
    return new Vec2((this.left + this.right) / 2, (this.top + this.bottom) / 2);
  }

  isPointInRect(p: Vec2, offset?: { top?: number; right?: number; bottom?: number; left?: number }): boolean {
    const ol = offset?.left ?? 0;
    const ot = offset?.top ?? 0;
    const or = offset?.right ?? 0;
    const ob = offset?.bottom ?? 0;
    return p.x >= this.left - ol && p.x <= this.right + or && p.y >= this.top - ot && p.y <= this.bottom + ob;
  }

  static fromDOMRect(r: { top: number; right: number; bottom: number; left: number }) {
    return new Rect(r.top, r.right, r.bottom, r.left);
  }
}

export class Position {
  constructor(public line: number, public character: number) {
    assert(line >= 0, 'Position line must be >= 0');
    assert(character >= 0, 'Position character must be >= 0');
  }

  isEqual(other: Position): boolean {
    return this.line === other.line && this.character === other.character;
  }

  compareTo(other: Position): number {
    if (this.line < other.line) return -1;
    if (this.line > other.line) return 1;
    if (this.character < other.character) return -1;
    if (this.character > other.character) return 1;
    return 0;
  }

  isAfter(other: Position): boolean {
    return this.compareTo(other) > 0;
  }

  isAfterOrEqual(other: Position): boolean {
    return this.compareTo(other) >= 0;
  }

  isBefore(other: Position): boolean {
    return this.compareTo(other) < 0;
  }

  isBeforeOrEqual(other: Position): boolean {
    return this.compareTo(other) <= 0;
  }
}

export class Range {
  constructor(public start: Position, public end: Position) {}

  isEqual(other: Range) {
    return this.start.isEqual(other.start) && this.end.isEqual(other.end);
  }
}

export class Selection {
  constructor(public anchor: Position, public active: Position) {}

  get start(): Position {
    return this.anchor.isBeforeOrEqual(this.active) ? this.anchor : this.active;
  }
  get end(): Position {
    return this.anchor.isAfter(this.active) ? this.anchor : this.active;
  }

  isEqual(other: Selection): boolean {
    return this.anchor.isEqual(other.anchor) && this.active.isEqual(other.active);
  }

  static areEqual(a: Selection[], b: Selection[]): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!a[i].isEqual(b[i])) return false;
    }
    return true;
  }
}

export class ContentChange {
  constructor(public text: string, public range: Range) {}
}

export class LineRange {
  constructor(public start: number, public end: number) {}
  isEqual(other: LineRange) {
    return this.start === other.start && this.end === other.end;
  }
}

export function getSelectionsAfterTextChangeEvent(e: t.TextChangeEvent): Selection[] {
  // e.contentChanges: [
  //   {"text": "!", "range": [0, 2, 0, 2]},
  //   {"text": "!", "range": [1, 9, 1, 9]}
  // ]
  // e.revContentChanges: [
  //   {"text": "", "range": [0, 2, 0, 3]},
  //   {"text": "", "range": [1, 9, 1, 10]}
  // ]
  // new selection: [
  //   [0, 3, 0, 3],
  //   [1, 10, 1, 10]
  // ]
  // new revSelection: [
  //   [0, 2, 0, 2],
  //   [1, 9, 1, 9]]
  // ]

  return e.revContentChanges.map(cc => new Selection(cc.range.end, cc.range.end));
}

export function getSelectionsBeforeTextChangeEvent(e: t.TextChangeEvent): Selection[] {
  // e.contentChanges: [
  //   {"text": "!", "range": [0, 2, 0, 2]},
  //   {"text": "!", "range": [1, 9, 1, 9]}
  // ]
  // e.revContentChanges: [
  //   {"text": "", "range": [0, 2, 0, 3]},
  //   {"text": "", "range": [1, 9, 1, 10]}
  // ]
  // new selection: [
  //   [0, 3, 0, 3],
  //   [1, 10, 1, 10]
  // ]
  // new revSelection: [
  //   [0, 2, 0, 2],
  //   [1, 9, 1, 9]]
  // ]
  return e.contentChanges.map(cc => new Selection(cc.range.start, cc.range.end));
}

export function getSelectionsAfterTextInsertEvent(e: t.TextInsertEvent): Selection[] {
  return [new Selection(e.revRange.end, e.revRange.end)];
}

export function getSelectionsBeforeTextInsertEvent(e: t.TextInsertEvent): Selection[] {
  return [new Selection(e.revRange.start, e.revRange.start)];
}

export function getTextChangeEventFromTextInsertEvent(e: t.TextInsertEvent): t.TextChangeEvent {
  return {
    type: 'textChange',
    clock: e.clock,
    contentChanges: [new ContentChange(e.text, new Range(e.revRange.start, e.revRange.start))],
    revContentChanges: [new ContentChange('', e.revRange)],
    updateSelection: e.updateSelection,
  };
}
