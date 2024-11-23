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
      this.insert(uri, events);
    }
  }

  // Events must be sorted.
  insert(uri: Uri, events: EditorEvent[]) {
    this.insertIntoTrack(uri, events);
    this.insertIntoBucket(uri, events);
    this.size += events.length;
  }

  delete() {
    throw new Error('TODO');
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
    const j = lastSortedIndex(this.buckets[i] ?? [], clock);
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
    const j = sortedIndex(this.buckets[i] ?? [], clock);
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

  private insertIntoTrack(uri: Uri, events: EditorEvent[]) {
    const track = this.getInitializedTrack(uri);
    const pushAtEnd = track.length === 0 || events.length === 0 || events[0].clock >= track.at(-1)!.clock;

    lib.insertIntoArray(track, events, track.length);
    if (!pushAtEnd) {
      // Array.sort does a stable sort. So because we first pushed the events at the end,
      // the new items will always be after existing items when their clocks are the same.
      track.sort((a, b) => a.clock - b.clock);
    }
  }

  private insertIntoBucket(uri: Uri, events: EditorEvent[]) {
    for (const event of events) {
      const [i, j] = this.getInsertPosAfterClock(event.clock);
      this.ensureBucketAt(i);
      this.buckets[i].splice(j, 0, { event, uri });
    }
  }
}

/**
 * Binary search events. It'll return the last index when clock could be inserted.
 * For example:
 * sortedIndex([{clock: 0}, {clock: 1}, {clock: 2}, {clock: 3}, {clock: 4}, {clock: 5}], 2)
 * => 3
 * sortedIndex([{clock: 0}, {clock: 1}, {clock: 2}, {clock: 3}, {clock: 4}, {clock: 5}], 2.5)
 * => 3
 */
function lastSortedIndex(events: EditorEventWithUri[], clock: number): number {
  let low = 0;
  let high = events.length;

  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    const computed = events[mid].event.clock;

    if (computed <= clock) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return high;
}

/**
 * Binary search events. It'll return the first index when clock could be inserted.
 * For example:
 * sortedIndex([{clock: 0}, {clock: 1}, {clock: 2}, {clock: 3}, {clock: 4}, {clock: 5}], 2)
 * => 2
 * sortedIndex([{clock: 0}, {clock: 1}, {clock: 2}, {clock: 3}, {clock: 4}, {clock: 5}], 2.5)
 * => 3
 */
function sortedIndex(events: EditorEventWithUri[], clock: number): number {
  let low = 0;
  let high = events.length;

  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    const computed = events[mid].event.clock;

    if (computed < clock) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return high;
}
