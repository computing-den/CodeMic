import { types as t, lib, assert } from '@codecast/lib';
import _ from 'lodash';

// export enum MediaStatus {
//   Init,
//   Waiting,
//   Initialized,
//   Playing,
//   Error,
// }

type PostAudioEvent = (e: t.FrontendAudioEvent) => Promise<void>;

export default class MediaApi {
  audioManagers: { [key: string]: AudioManager } = {};

  constructor(public postAudioEvent: PostAudioEvent) {}

  // async load(id: string, src: string) {
  //   this.audioManagers[id] = new AudioManager(id, src, this.postAudioEvent);
  // }

  loadOrDisposeAudioTracks(audioTracksWebviewUris: t.AudioTracksWebviewUris) {
    const newIds = _.keys(audioTracksWebviewUris);
    const oldIds = _.keys(this.audioManagers);

    const addedIds = _.difference(newIds, oldIds);
    const deletedIds = _.difference(oldIds, newIds);

    for (const id of addedIds) {
      this.audioManagers[id] = new AudioManager(id, audioTracksWebviewUris[id].webviewUri, this.postAudioEvent);
    }

    for (const id of deletedIds) this.disposeById(id);
  }

  async prepareAll() {
    await Promise.all(Object.values(this.audioManagers).map(a => a.prepare()));
  }

  disposeById(id: string) {
    this.audioManagers[id]?.dispose();
    delete this.audioManagers[id];
  }

  disposeAll() {
    for (const id of _.keys(this.audioManagers)) this.disposeById(id);
  }

  getAudioManager(id: string): AudioManager {
    assert(this.audioManagers[id], `MediaApi.getAudioManager: audio with id ${id} not found`);
    return this.audioManagers[id];
  }
}

export class AudioManager {
  audio: HTMLAudioElement;
  prepared = false;

  constructor(public id: string, src: string, public postAudioEvent: PostAudioEvent) {
    this.audio = new Audio();
    this.audio.addEventListener('volumechange', this.handleVolumechange);
    this.audio.addEventListener('timeupdate', this.handleTimeupdate);
    this.audio.addEventListener('error', this.handleError);

    for (const type of genericEventTypes) {
      this.audio.addEventListener(type, this.handleGenericEvent);
    }

    this.audio.src = src;
    this.audio.preload = 'auto';
    console.log(`AudioManager: created audio: ${id} (${src})`);
  }

  async prepare() {
    if (!this.prepared) {
      // Will this trigger a short sound?
      console.log(`AudioManager: preparing audio ${this.id} (${this.audio.src})`);
      await this.audio.play();
      this.audio.pause();
      this.prepared = true;
      console.log(`AudioManager: prepared audio ${this.id}`);
    }
  }

  async play() {
    console.log(`AudioManager play`);
    await this.audio.play();
  }

  pause() {
    console.log(`AudioManager pause`);
    this.audio.pause();
  }

  stop() {
    console.log(`AudioManager stop`);
    this.audio.pause();
  }

  seek(clock: number) {
    console.log(`AudioManager seek ${clock}`);
    this.audio.currentTime = clock;
  }

  setPlaybackRate(rate: number) {
    console.log(`AudioManager setPlaybackRate ${rate}`);
    this.audio.playbackRate = rate;
  }

  dispose() {
    this.audio.pause();
    this.audio.removeEventListener('volumechange', this.handleVolumechange);
    this.audio.removeEventListener('timeupdate', this.handleTimeupdate);
    this.audio.removeEventListener('error', this.handleError);
    for (const e of genericEventTypes) {
      this.audio.removeEventListener(e, this.handleGenericEvent);
    }
  }

  handleGenericEvent = async (e: Event) => {
    await this.postAudioEvent({ type: e.type as (typeof genericEventTypes)[number], id: this.id });
  };

  handleVolumechange = async () => {
    console.log('handleVolumechange');
    // The volumechange event signifies that the volume has changed; that includes being muted.
    await this.postAudioEvent({ type: 'volumechange', volume: this.audio.volume, id: this.id });
  };

  handleTimeupdate = async () => {
    console.log('handleTimeupdate');
    // The timeupdate event is triggered every time the currentTime property changes. In practice, this occurs every 250 milliseconds. This event can be used to trigger the displaying of playback progress.
    await this.postAudioEvent({ type: 'timeupdate', clock: this.audio.currentTime, id: this.id });
  };

  handleError = async (e: ErrorEvent) => {
    // An error is encountered while media data is being downloaded.
    console.error(e.error);
    console.error(e.message);
    await this.postAudioEvent({ type: 'error', error: e.message, id: this.id });
  };
}

export const genericEventTypes = [
  'loadstart',
  'durationchange',
  'loadedmetadata',
  'loadeddata',
  'progress',
  'canplay',
  'canplaythrough',
  'suspend',
  'abort',
  'emptied',
  'stalled',
  'playing',
  'waiting',
  'play',
  'pause',
  'ended',
  'seeking',
  'seeked',
] as const;
