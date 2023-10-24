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

  async load(id: string, src: string) {
    this.audioManagers[id] = new AudioManager(id, src, this.postAudioEvent);
  }

  // async play(id: string) {
  //   await this.getAudioManager(id).play()
  // }

  // async pause(id: string) {
  //   await this.getAudioManager(id).pause()
  // }

  // async seek(id: string, clock: number) {
  //   await this.getAudioManager(id).seek(clock)
  // }

  getAudioManager(id: string): AudioManager {
    assert(this.audioManagers[id], `MediaApi.getAudioManager: audio with id ${id} not found`);
    return this.audioManagers[id];
  }
}

export class AudioManager {
  audio: HTMLAudioElement;

  constructor(public id: string, src: string, public postAudioEvent: PostAudioEvent) {
    this.audio = new Audio();
    this.audio.addEventListener('volumechange', this.handleVolumechange);
    this.audio.addEventListener('timeupdate', this.handleTimeupdate);
    this.audio.addEventListener('error', this.handleError);

    for (const type of genericEventTypes) {
      this.audio.addEventListener(type, this.handleGenericEvent);
    }

    this.audio.src = src;
    console.log(`AudioManager: loading audio: ${src}`);
  }

  async play() {
    console.log(`AudioManager play`);
    await this.audio.play();
  }

  async pause() {
    console.log(`AudioManager pause`);
    this.audio.pause();
  }

  async stop() {
    console.log(`AudioManager stop`);
    this.audio.pause();
  }

  async seek(clock: number) {
    console.log(`AudioManager seek ${clock}`);
    this.audio.currentTime = clock;
  }

  async setPlaybackRate(rate: number) {
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
