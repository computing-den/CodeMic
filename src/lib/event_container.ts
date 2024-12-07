/**
 * The goal of EventContainer is to keep the editor events and provide fast access
 * for the following queries:
 * - iterate over events of a URI within a clock range sorted by clock
 * - iterate over events of all URIs within a clock range sorted by clock
 * - insert events
 *
 * Within a track or bucket, when we say the current index is i, that means the i'th
 * event has already been applied and its effects are visible.
 * So naturaly, the current index at the very start should be -1, since even the 0'th
 * event has not been applied.
 * If current clock is c, then all events whose clock is <= c have already been applied.
 *
 */

import { EditorEvent, EditorEventWithUri, Uri, InternalEditorTracksJSON } from './types.js';
import * as lib from './lib.js';
import assert from './assert.js';
import _ from 'lodash';

const BUCKET_CLOCK_INTERVAL = 1 * 60;

export type Iteratee = (value: EditorEventWithUri, i: number) => any;

/** [index of bucket, index in bucket] */
type Position = [number, number];

export default class EventContainer {
  private tracks: Map<Uri, EditorEvent[]> = new Map();
  private buckets: EditorEventWithUri[][] = [];
  private size = 0;

  constructor(tracks: InternalEditorTracksJSON) {
    for (const [uri, events] of Object.entries(tracks)) {
      this.insertManyForUri(uri, events);
    }
  }

  /**
   * Events must be sorted.
   */
  insertManyForUri(uri: Uri, events: EditorEvent[]) {
    this.insertManyIntoTrack(uri, events);
    this.insertManyIntoBucket(uri, events);
    this.size += events.length;
  }

  insert(uri: Uri, event: EditorEvent) {
    this.insertIntoTrack(uri, event);
    this.insertIntoBucket(uri, event);
    this.size += 1;
  }

  insertAt(uri: Uri, event: EditorEvent, i: number) {
    this.insertIntoTrack(uri, event);
    this.insertIntoBucketAtIndex(uri, event, i);
    this.size += 1;
  }

  /**
   * Events of each Uri must be sorted.
   */
  insertMany(events: EditorEventWithUri[]) {
    for (const { uri, event } of events) {
      this.insert(uri, event);
    }
  }

  deleteAt(index: number) {
    const pos = this.posOfIndex(index);
    assert(pos);
    const [e] = this.buckets[pos[0]].splice(pos[1], 1);
    const track = this.tracks.get(e.uri);
    assert(track);
    const i = track.indexOf(e.event);
    assert(i !== -1);
    track.splice(i, 1);
    this.size -= 1;
  }

  indexOfEvent(e: EditorEvent): number {
    const i = this.getBucketIndex(e.clock);
    const bucket = this.buckets[i];
    assert(bucket);
    const min = sortedIndex(bucket, e.clock, getClockOfEditorEventWithUri);
    const max = lastSortedIndex(bucket, e.clock, getClockOfEditorEventWithUri);
    for (let j = min; j < max; j++) {
      if (bucket[j].event === e) return this.indexOfPos([i, j]);
    }
    return -1;
  }

  /**
   * Use reindexStableOrder when event clocks have changed but the relative order of events hasn't changed.
   */
  reindexStableOrder() {
    const oldBuckets = this.buckets;
    this.buckets = [];
    for (const oldBucket of oldBuckets) {
      for (const event of oldBucket) {
        const i = this.getBucketIndex(event.event.clock);
        this.ensureBucketAt(i);
        this.buckets[i].push(event);
      }
    }
  }

  getTrack(uri: Uri): readonly EditorEvent[] {
    return this.tracks.get(uri) ?? [];
  }

  getSize(): number {
    return this.size;
  }

  isEmpty(): boolean {
    return this.size === 0;
  }

  forEachExc(from: number, to: number, f: Iteratee) {
    assert(from >= 0);

    let count = Math.abs(to - from);
    let pos = this.posOfIndex(from);

    if (from <= to) {
      for (let i = 0; i < count && pos; i++, pos = this.nextPos(pos)) {
        if (f(this.atPos(pos)!, from + i) === false) break;
      }
    } else {
      for (let i = 0; i < count && pos; i++, pos = this.prevPos(pos)) {
        if (f(this.atPos(pos)!, from - i) === false) break;
      }
    }
  }

  collectExc(from: number, to: number): EditorEventWithUri[] {
    let res: EditorEventWithUri[] = [];
    this.forEachExc(from, to, e => void res.push(e));
    return res;
  }

  /**
   * If i is not in range, it'll return undefined.
   */
  at(i: number): EditorEventWithUri | undefined {
    const pos = this.posOfIndex(i);
    return pos && this.atPos(pos);
  }

  getIndexAfterClock(clock: number): number {
    return this.indexOfPos(this.getInsertPosAfterClock(clock));
  }

  getIndexBeforeClock(clock: number): number {
    return this.indexOfPos(this.getInsertPosBeforeClock(clock));
  }

  toJSON(): InternalEditorTracksJSON {
    return Object.fromEntries(this.tracks);
  }

  private atPos(pos: Position): EditorEventWithUri | undefined {
    return this.buckets[pos[0]]?.[pos[1]];
  }

  private posOfIndex(target: number): Position | undefined {
    // target:       13
    // buckets:      xxxxx xxxxxxxx xxxxxxxxxxxxxxxxxxxx
    // bucket sizes: 5     8        20
    // indices:      0     5        13
    if (target < 0) return;

    for (let i = 0, acc = 0; i < this.buckets.length; i++) {
      const bucket = this.buckets[i];
      if (target < acc + bucket.length) return [i, target - acc];
      acc += bucket.length;
    }
  }

  /**
   * Position does not have to be valid. It may be past the size of a bucket or buckets.
   */
  private indexOfPos(pos: Position): number {
    let acc = 0;
    for (let i = 0; i < pos[0]; i++) {
      acc += this.buckets[i]?.length ?? 0;
    }

    return acc + pos[1];
  }

  private nextPos(pos: Position): Position | undefined {
    for (let i = pos[0], j = pos[1] + 1; i < this.buckets.length; i = i + 1, j = 0) {
      if (j < this.buckets[i].length) return [i, j];
    }
  }

  private prevPos(pos: Position): Position | undefined {
    for (let i = pos[0], j = pos[1] - 1; i >= 0; i--, j = (this.buckets[i]?.length ?? 0) - 1) {
      if (j >= 0) return [i, j];
    }
  }

  /**
   * The returned position is not necessarily valid. It may be one past the end of the bucket or
   * pointing to a non-existing bucket. It is where an event with that clock should be inserted.
   * If we have these events in bucket 0: {clock: 0}, {clock: 1}, {clock: 2}, {clock: 3}, {clock: 4}, {clock: 5},
   * getInsertPosAfterClock(2)   => [0, 3]
   * getInsertPosAfterClock(2.5) => [0, 3]
   * getInsertPosAfterClock(5)   => [0, 6]
   */
  private getInsertPosAfterClock(clock: number): Position {
    assert(clock >= 0);
    const i = this.getBucketIndex(clock);
    const j = lastSortedIndex(this.buckets[i] ?? [], clock, getClockOfEditorEventWithUri);
    return [i, j];
  }

  /**
   * The returned position is not necessarily valid. It may be one past the end of the bucket or
   * pointing to a non-existing bucket. It is where an event with that clock should be inserted.
   * If we have these events in bucket 0: {clock: 0}, {clock: 1}, {clock: 2}, {clock: 3}, {clock: 4}, {clock: 5},
   * getInsertPosBeforeClock(2)   => [0, 2]
   * getInsertPosBeforeClock(2.5) => [0, 3]
   * getInsertPosBeforeClock(5)   => [0, 5]
   */
  private getInsertPosBeforeClock(clock: number): Position {
    assert(clock >= 0);
    const i = this.getBucketIndex(clock);
    const j = sortedIndex(this.buckets[i] ?? [], clock, getClockOfEditorEventWithUri);
    return [i, j];
  }

  private getBucketIndex(clock: number): number {
    return Math.floor(clock / BUCKET_CLOCK_INTERVAL);
  }

  private ensureBucketAt(i: number) {
    while (this.buckets.length < i + 1) this.buckets.push([]);
  }

  private getInitializedTrack(uri: Uri): EditorEvent[] {
    return this.tracks.get(uri) ?? this.tracks.set(uri, []).get(uri)!;
  }

  private insertManyIntoTrack(uri: Uri, events: EditorEvent[]) {
    const track = this.getInitializedTrack(uri);
    const pushAtEnd = track.length === 0 || events.length === 0 || events[0].clock >= track.at(-1)!.clock;

    lib.insertIntoArray(track, events, track.length);
    if (!pushAtEnd) {
      // Array.sort does a stable sort. So because we first pushed the events at the end,
      // the new items will always be after existing items when their clocks are the same.
      track.sort((a, b) => a.clock - b.clock);
    }
  }

  private insertIntoTrack(uri: Uri, event: EditorEvent) {
    const track = this.getInitializedTrack(uri);
    const i = lastSortedIndex(track, event.clock, getClockOfEditorEvent);
    track.splice(i, 0, event);
  }

  private insertManyIntoBucket(uri: Uri, events: EditorEvent[]) {
    for (const event of events) {
      this.insertIntoBucket(uri, event);
    }
  }

  private insertIntoBucket(uri: Uri, event: EditorEvent) {
    const pos = this.getInsertPosAfterClock(event.clock);
    this.insertIntoBucketAtPos(uri, event, pos);
  }

  private insertIntoBucketAtIndex(uri: Uri, event: EditorEvent, index: number) {
    const pos = this.posOfIndex(index);
    assert(pos, 'invalid index');
    this.insertIntoBucketAtPos(uri, event, pos);
  }

  private insertIntoBucketAtPos(uri: Uri, event: EditorEvent, pos: Position) {
    this.ensureBucketAt(pos[0]);
    this.buckets[pos[0]].splice(pos[1], 0, { event, uri });
  }
}

/**
 * Binary search array. It'll return the last index when clock could be inserted.
 * For example:
 * sortedIndex([{clock: 0}, {clock: 1}, {clock: 2}, {clock: 3}, {clock: 4}, {clock: 5}], 2)
 * => 3
 * sortedIndex([{clock: 0}, {clock: 1}, {clock: 2}, {clock: 3}, {clock: 4}, {clock: 5}], 2.5)
 * => 3
 */
function lastSortedIndex<T>(array: T[], clock: number, iteratee: (x: T) => number): number {
  let low = 0;
  let high = array.length;

  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    const computed = iteratee(array[mid]);

    if (computed <= clock) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return high;
}

/**
 * Binary search array. It'll return the first index when clock could be inserted.
 * For example:
 * sortedIndex([{clock: 0}, {clock: 1}, {clock: 2}, {clock: 3}, {clock: 4}, {clock: 5}], 2)
 * => 2
 * sortedIndex([{clock: 0}, {clock: 1}, {clock: 2}, {clock: 3}, {clock: 4}, {clock: 5}], 2.5)
 * => 3
 */
function sortedIndex<T>(array: T[], clock: number, iteratee: (x: T) => number): number {
  let low = 0;
  let high = array.length;

  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    const computed = iteratee(array[mid]);

    if (computed < clock) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return high;
}

function getClockOfEditorEventWithUri(x: EditorEventWithUri) {
  return x.event.clock;
}

function getClockOfEditorEvent(x: EditorEvent) {
  return x.clock;
}
