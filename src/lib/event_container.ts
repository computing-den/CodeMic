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
 * The following is a quick test and benchmark and the timing on my machine is in the order of 10s of ms.
 * TODO move this to an actual test.
 * {
 *   function timeIt(title, f) {
 *     console.log(`----- ${title} -----`);
 *     let start = performance.now();
 *     f();
 *     console.log(`*** TIME: ${performance.now() - start}ms ***` )
 *   }
 *
 *   let ec = new globalThis.EventContainer
 *   console.log('------ iterating empty container')
 *
 *   console.log(ec.firstIndex(), ec.lastIndex());
 *
 *   timeIt('filling the container', () => {
 *
 *     const uris = [];
 *     for (let u = 0; u<1000; u++) {
 *       uris.push('test/test2/' + u);
 *     }
 *
 *     const duration = 3600 * 24;
 *
 *     // insert initial state
 *     for (const u of uris) {
 *       ec.insert(u, [{clock: 0}])
 *     }
 *
 *     for (let t = 0, uri; t < duration; t++) {
 *       if (t % (5 * 60) === 0) {
 *         uri = uris[ Math.floor(Math.random() * uris.length) ];
 *         console.log('filling uri: ', uri)
 *       }
 *       ec.insert(uri, [{clock: t}]);
 *     }
 *   })
 *
 *   {
 *     let res = [];
 *     timeIt('------ iterating', () => {
 *       for (let i = ec.lastIndex(); i; i = ec.prevIndex(i)) {
 *         res.push([i, ec.at(i)])
 *       }
 *     })
 *
 *     console.log('RES length: ', res.length);
 *     console.log('RES', ec);
 *   }
 * }
 *
 */

import { EditorEvent, EditorEventWithUri, Uri, InternalEditorTracksJSON } from './types.js';
import * as lib from './lib.js';
import assert from './assert.js';
import _ from 'lodash';

const BUCKET_CLOCK_INTERVAL = 1 * 60;

export type Iteratee = (value: EditorEventWithUri, i: EventIndex) => any;

export default class EventContainer {
  private tracks: Map<Uri, EditorEvent[]> = new Map();
  private buckets: EditorEventWithUri[][] = [];

  constructor(tracks: InternalEditorTracksJSON) {
    for (const [uri, events] of Object.entries(tracks)) {
      this.insert(uri, events);
    }
  }

  // Events must be sorted.
  insert(uri: Uri, events: EditorEvent[]) {
    this.insertIntoTrack(uri, events);
    this.insertIntoBucket(uri, events);
  }

  delete() {
    throw new Error('TODO');
  }

  getTrack(uri: Uri): readonly EditorEvent[] {
    return this.tracks.get(uri) ?? [];
  }

  firstIndex(): EventIndex {
    return this.nextIndex(EventIndex.minusOne());
  }

  lastIndex(): EventIndex {
    return this.prevIndex(new EventIndex(this.buckets.length - 1, this.buckets[this.buckets.length - 1]?.length ?? 0));
  }

  isEmpty(): boolean {
    return this.lastIndex().isMinusOne();
  }

  forEachInc(from: EventIndex, to: EventIndex, f: Iteratee) {
    assert(!from.isMinusOne() && !to.isMinusOne());

    if (from.isBeforeOrEqual(to)) {
      for (let i = from; !i.isMinusOne() && i.isBeforeOrEqual(to); i = this.nextIndex(i)) {
        if (f(this.at(i)!, i) === false) break;
      }
    } else {
      for (let i = from; !i.isMinusOne() && i.isAfterOrEqual(to); i = this.prevIndex(i)) {
        if (f(this.at(i)!, i) === false) break;
      }
    }
  }

  forEachExc(from: EventIndex, to: EventIndex, f: Iteratee) {
    assert(!from.isMinusOne() && !to.isMinusOne());

    if (from.isBeforeOrEqual(to)) {
      for (let i = from; !i.isMinusOne() && i.isBefore(to); i = this.nextIndex(i)) {
        if (f(this.at(i)!, i) === false) break;
      }
    } else {
      for (let i = from; !i.isMinusOne() && i.isAfter(to); i = this.prevIndex(i)) {
        if (f(this.at(i)!, i) === false) break;
      }
    }
  }

  isInRange(i: EventIndex): boolean {
    return (
      i.bucketIndex >= 0 &&
      i.bucketIndex < this.buckets.length &&
      i.eventIndexInBucket >= 0 &&
      i.eventIndexInBucket < this.buckets[i.bucketIndex].length
    );
  }

  at(i: EventIndex): EditorEventWithUri | undefined {
    return this.buckets[i.bucketIndex]?.[i.eventIndexInBucket];
  }

  /**
   * Once it reaches the end, it returns EventIndex.minusOne()
   */
  nextIndex(i: EventIndex): EventIndex {
    for (
      i = new EventIndex(i.bucketIndex, i.eventIndexInBucket + 1);
      i.bucketIndex < this.buckets.length;
      i = new EventIndex(i.bucketIndex + 1, 0)
    ) {
      if (i.eventIndexInBucket < this.buckets[i.bucketIndex].length) return i;
    }
    return EventIndex.minusOne();
  }

  /**
   * Once it reaches the beginning, it'll return EventIndex.minusOne()
   */
  prevIndex(i: EventIndex): EventIndex {
    for (
      i = new EventIndex(i.bucketIndex, i.eventIndexInBucket - 1);
      i.bucketIndex >= 0;
      i = new EventIndex(i.bucketIndex - 1, (this.buckets[i.bucketIndex - 1]?.length ?? 0) - 1)
    ) {
      if (i.eventIndexInBucket >= 0) return i;
    }
    return EventIndex.minusOne();
  }

  /**
   * If we have these events in bucket 0: {clock: 0}, {clock: 1}, {clock: 2}, {clock: 3}, {clock: 4}, {clock: 5},
   * getIndexAfterClock(2)   => new EventIndex(0, 3)
   * getIndexAfterClock(2.5) => new EventIndex(0, 3)
   * getIndexAfterClock(5)   => new EventIndex(0, 6)
   */
  getIndexAfterClock(clock: number): EventIndex {
    assert(clock >= 0);
    const i = this.getBucketIndex(clock);
    const j = lastSortedIndex(this.buckets[i] ?? [], clock);
    return new EventIndex(i, j);
  }

  /**
   * If we have these events in bucket 1: {clock: 0}, {clock: 1}, {clock: 2}, {clock: 3}, {clock: 4}, {clock: 5},
   * getIndexBeforeClock(2)   => new EventIndex(0, 2)
   * getIndexBeforeClock(2.5) => new EventIndex(0, 3)
   * getIndexBeforeClock(5)   => new EventIndex(0, 5)
   */
  getIndexBeforeClock(clock: number): EventIndex {
    assert(clock >= 0);
    const i = this.getBucketIndex(clock);
    const j = sortedIndex(this.buckets[i] ?? [], clock);
    return new EventIndex(i, j);
  }

  toJSON(): InternalEditorTracksJSON {
    return Object.fromEntries(this.tracks);
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
      const i = this.getIndexAfterClock(event.clock);
      this.ensureBucketAt(i.bucketIndex);
      this.buckets[i.bucketIndex].splice(i.eventIndexInBucket, 0, { event, uri });
    }
  }
}

export class EventIndex {
  constructor(public readonly bucketIndex: number, public readonly eventIndexInBucket: number) {}

  /**
   * Represents the state where no event has been applied yet and it is `new EventIndex(0, -1)`.
   */
  static minusOne(): EventIndex {
    return new EventIndex(0, -1);
  }

  isMinusOne(): boolean {
    return this.eventIndexInBucket === -1;
  }

  isBefore(i: EventIndex): boolean {
    // assert(this.isValid());
    return (
      this.bucketIndex < i.bucketIndex ||
      (this.bucketIndex === i.bucketIndex && this.eventIndexInBucket < i.eventIndexInBucket)
    );
  }

  isAfter(i: EventIndex): boolean {
    // assert(this.isValid());
    return (
      this.bucketIndex > i.bucketIndex ||
      (this.bucketIndex === i.bucketIndex && this.eventIndexInBucket > i.eventIndexInBucket)
    );
  }

  isBeforeOrEqual(i: EventIndex): boolean {
    // assert(this.isValid());
    return (
      this.bucketIndex < i.bucketIndex ||
      (this.bucketIndex === i.bucketIndex && this.eventIndexInBucket <= i.eventIndexInBucket)
    );
  }

  isAfterOrEqual(i: EventIndex): boolean {
    // assert(this.isValid());
    return (
      this.bucketIndex > i.bucketIndex ||
      (this.bucketIndex === i.bucketIndex && this.eventIndexInBucket >= i.eventIndexInBucket)
    );
  }

  isEqual(i: EventIndex): boolean {
    // assert(this.isValid());
    return this.bucketIndex === i.bucketIndex && this.eventIndexInBucket === i.eventIndexInBucket;
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
