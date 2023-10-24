import * as t from './types.js';
import assert from './assert.js';
import { v4 as uuid } from 'uuid';

export default class SwitchTrackPlayer implements t.TrackPlayer {
  get cur(): t.TrackPlayer {
    return this.trackPlayers[this.curIndex];
  }
  get name(): string {
    return this.cur.name;
  }
  get track(): t.Track {
    return this.cur.track;
  }

  get clock(): number {
    return this.cur.clock;
  }

  get state(): t.TrackPlayerState {
    return this.cur.state;
  }

  get playbackRate(): number {
    return this.cur.playbackRate;
  }

  get isRecorder(): boolean {
    return this.cur.isRecorder;
  }

  get onProgress(): ((clock: number) => any) | undefined {
    return this.cur.onProgress;
  }

  set onProgress(f: (clock: number) => any) {
    this.cur.onProgress = f;
  }

  get onStateChange(): ((state: t.TrackPlayerState) => any) | undefined {
    return this.cur.onStateChange;
  }

  set onStateChange(f: (state: t.TrackPlayerState) => any) {
    this.cur.onStateChange = f;
  }

  constructor(public trackPlayers: t.TrackPlayer[], public curIndex: number = 0) {}

  load() {
    this.cur.load();
  }

  start() {
    this.cur.start();
  }

  pause() {
    this.cur.pause();
  }

  stop() {
    this.cur.stop();
  }

  seek(clock: number) {
    this.cur.seek(clock);
  }

  setClock(clock: number) {
    this.cur.setClock(clock);
  }

  extend(clock: number) {
    this.cur.extend(clock);
  }

  setPlaybackRate(rate: number) {
    this.cur.setPlaybackRate(rate);
  }

  dispose() {
    this.cur.dispose();
  }

  switch(i: number) {
    if (this.curIndex !== i) {
      this.trackPlayers[i].setClock(this.cur.clock);
      this.trackPlayers[i].setPlaybackRate(this.cur.playbackRate);
      this.cur.stop();
      this.curIndex = i;
    }
  }
}
