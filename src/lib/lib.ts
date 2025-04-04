import _ from 'lodash';
import * as t from './types.js';
import assert from './assert.js';
import { URI, Utils } from 'vscode-uri';
import * as path from 'path';
import { isWindows } from './platform.js';

export const ANONYM_USERNAME = 'anonym'; // NOTE: If you change this, make sure to change it in server too.

// export const COVER_WITH_TO_HEIGHT_RATIO = 16 / 9;

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

/**
 * Similar to lodash's throttle but with leading: false, trailing: true.
 * Unlike lodash, calls do not resolve until the next trailing edge.
 */
export function throttleTrailingAsync(func: () => Promise<void>, wait: number): () => Promise<void> {
  let timer: any | null = null;
  let pending: Array<{ resolve: () => void; reject: (reason?: any) => void }> = [];

  async function flush() {
    const currentPending = pending;
    pending = [];
    timer = null;

    try {
      await func();
      for (const { resolve } of currentPending) resolve();
    } catch (err) {
      for (const { reject } of currentPending) reject(err);
    }
  }

  return function throttled(): Promise<void> {
    return new Promise((resolve, reject) => {
      pending.push({ resolve, reject });
      if (!timer) {
        timer = setTimeout(flush, wait);
      }
    });
  };
}

export class CancelledError extends Error {
  constructor() {
    super('Cancelled');
  }
}

export function formatTimeSeconds(time: number, full: boolean = false): string {
  const h = Math.floor(time / 3600);
  const m = Math.floor((time / 60) % 60);
  const s = Math.floor(time % 60);
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

export function calcClockAfterMerge(clock: number, range: t.ClockRange): number {
  if (clock < range.start) return clock;
  if (clock > range.end) return clock - getClockRangeDur(range);
  return range.start;
}

// export function userToUserSummary(user: t.User): t.UserSummary {
//   return _.pick(user, 'username', 'email', 'joinTimestamp');
// }

// export async function asyncFilter<T>(collection: T[], cb: (x: T, i: number) => Promise<boolean>): Promise<T[]> {
//   const bools = await Promise.all(collection.map(cb));
//   return collection.filter((x, i) => bools[i]);
// }

/**
 * Use this instead of splice to support large number of inserts without hitting the stack limit.
 */
export function insertIntoArray<T>(array: T[], newItems: T[], at: number = array.length) {
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

export function adjustTrackPlaybackRate(sessionClock: number, trackClock: number): number | undefined {
  const diff = sessionClock - trackClock;
  if (Math.abs(diff) > 3.0) {
    return Math.sign(diff) * 1 + 1;
  } else if (Math.abs(diff) > 2.0) {
    return Math.sign(diff) * 0.4 + 1;
  } else if (Math.abs(diff) > 1.0) {
    return Math.sign(diff) * 0.2 + 1;
  } else if (Math.abs(diff) > 0.6) {
    return Math.sign(diff) * 0.1 + 1;
  } else if (Math.abs(diff) < 0.3) {
    return 1;
  }
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

export function findFocusByClock(focusTimeline: t.Focus[], clock: number): t.Focus | undefined {
  const i = indexOfFocusByClock(focusTimeline, clock);
  if (i > -1) return focusTimeline[i];
}

export function indexOfFocusByClock(focusTimeline: t.Focus[], clock: number): number {
  return focusTimeline.findIndex((f, i) => clock >= f.clock && clock < (focusTimeline[i + 1]?.clock ?? Infinity));
}

export function resolveWorkspaceUri(workspace: string, uri: string): string {
  const uriParsed = URI.parse(uri);

  return uriParsed.scheme === 'workspace' ? URI.file(path.join(workspace, uriParsed.path)).toString() : uri;
}

export function workspaceUri(relPath: string): string {
  // We can't use URI.file(relPath).path because URI.file() turns relative paths into absolute paths.
  // Here, we follow the same logic as URI.file() but without forcing absolute path.

  assert(!path.isAbsolute(relPath), 'workspace URI path must be relative');

  // normalize to fwd-slashes on windows, on other systems bwd-slashes are valid filename character, eg /f\oo/ba\r.txt
  if (process.platform === 'win32') {
    relPath = relPath.replace(/\\/g, '/');
  }

  assert(relPath !== '..' && !relPath.startsWith('../'), 'workspace URI path must not start with ..');

  return URI.from({ scheme: 'workspace', path: relPath }).toString();
}

export function workspaceUriFrom(workspace: string, absPath: string): string {
  assert(path.isAbsolute(workspace));
  assert(path.isAbsolute(absPath));

  return workspaceUri(path.relative(workspace, absPath));
}

// export function isBaseOfPath(base: string, p: string) {
//   return p.startsWith(base) && (base.length === p.length || p[base.length] === path.sep);
// }

export function logRejectedPromises(results: PromiseSettledResult<any>[]) {
  for (const result of results) {
    if (result.status === 'rejected') console.error(result.reason);
  }
}

export function deepFreeze(arg: any) {
  if (Array.isArray(arg)) {
    for (const x of arg) deepFreeze(x);
  } else if (typeof arg === 'object') {
    for (const key in arg) {
      if (arg.hasOwnProperty(key)) deepFreeze(arg[key]);
    }
  }

  return Object.freeze(arg);
}

/**
 * VSCode's URI always returns fsPath on windows with lowercase drive letter.
 * But its uri.path is uppercase letter (but starts with \C:\\) and os.homedir()
 * is also uppercase drive.
 */
export function normalizeWindowsDriveLetter(p: string): string {
  return isWindows && /^[A-Za-z]:/.test(p) ? p[0].toUpperCase() + p.slice(1) : p;
}

export const defaultIgnorePatterns = `# Ignore the .git directory
.git

# Node.js dependencies
node_modules

# Python byte-compiled / optimized / DLL files
__pycache__
*.py[cod]
*$py.class

`;
