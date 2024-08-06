import { types as t, lib, assert } from '@codecast/lib';
import postMessage from './api.js';
import _ from 'lodash';

export default class AudioManager {
  trackManagers: { [key: string]: AudioTrackManager } = {};
  // videoManagers: { [key: string]: VideoManager } = {};
  audioContext?: AudioContext;
  webviewUris?: t.WebviewUris;
  audioTracks?: t.AudioTrack[];

  updateResources(webviewUris: t.WebviewUris, audioTracks: t.AudioTrack[] = []) {
    this.webviewUris = webviewUris;
    this.audioTracks = audioTracks;

    // Load or dispose audio tracks.
    const newIds = audioTracks.map(a => a.id);
    const oldIds = Object.keys(this.trackManagers);

    const addedIds = _.difference(newIds, oldIds);
    const deletedIds = _.difference(oldIds, newIds);

    for (const id of addedIds) {
      this.trackManagers[id] = new AudioTrackManager(id, webviewUris[id]);
    }

    for (const id of deletedIds) this.dispose(id);
  }

  async prepare() {
    try {
      this.audioContext ??= new AudioContext();
      this.audioContext.suspend();
      await Promise.all(Object.values(this.trackManagers).map(a => a.prepare(this.audioContext!)));
    } finally {
      this.audioContext?.resume();
    }
  }

  async play(id: string) {
    await this.trackManagers[id]?.play();
  }

  pause(id: string) {
    this.trackManagers[id]?.pause();
  }

  stop(id: string) {
    this.trackManagers[id]?.pause();
  }

  seek(id: string, clock: number) {
    this.trackManagers[id]?.seek(clock);
  }

  setPlaybackRate(id: string, rate: number) {
    this.trackManagers[id]?.setPlaybackRate(rate);
  }

  dispose(id: string) {
    this.trackManagers[id]?.dispose();
  }

  close() {
    for (const t of Object.values(this.trackManagers)) t.dispose();
    this.audioContext?.close();
  }
}

export class AudioTrackManager {
  audio: HTMLAudioElement;
  node?: MediaElementAudioSourceNode;
  prepared = false;

  constructor(
    public id: string,
    src: string,
  ) {
    this.audio = new Audio();
    this.audio.addEventListener('volumechange', this.handleVolumeChange);
    this.audio.addEventListener('timeupdate', this.handleTimeUpdate);
    this.audio.addEventListener('error', this.handleError);

    for (const type of genericEventTypes) {
      this.audio.addEventListener(type, this.handleGenericEvent);
    }

    this.audio.src = src;
    this.audio.preload = 'auto';
    console.log(`AudioTrackManager: created audio: ${id} (${src})`);
  }

  /**
   * audioContext must be suspended before calling prepare.
   * Puts the audio in a suspended audio context so that the initial play and pause
   * don't trigger a sudden sound.
   */
  async prepare(audioContext: AudioContext) {
    if (!this.prepared) {
      console.log(`AudioTrackManager: preparing audio ${this.id} (${this.audio.src})`);

      assert(audioContext.state === 'suspended');
      this.node = audioContext.createMediaElementSource(this.audio);
      this.node.connect(audioContext.destination);
      await this.audio.play();
      this.audio.pause();
      this.prepared = true;
      console.log(`AudioTrackManager: prepared audio ${this.id}`);
    }
  }

  async play() {
    console.log(`AudioTrackManager play`);
    await this.audio.play();
  }

  pause() {
    console.log(`AudioTrackManager pause`);
    this.audio.pause();
  }

  stop() {
    console.log(`AudioTrackManager stop`);
    this.audio.pause();
  }

  seek(clock: number) {
    console.log(`AudioTrackManager seek ${clock}`);
    this.audio.currentTime = clock;
  }

  setPlaybackRate(rate: number) {
    console.log(`AudioTrackManager setPlaybackRate ${rate}`);
    this.audio.playbackRate = rate;
  }

  dispose() {
    this.node?.disconnect();
    this.audio.pause();
    this.audio.removeEventListener('volumechange', this.handleVolumeChange);
    this.audio.removeEventListener('ratechange', this.handleRateChange);
    this.audio.removeEventListener('timeupdate', this.handleTimeUpdate);
    this.audio.removeEventListener('error', this.handleError);
    for (const e of genericEventTypes) {
      this.audio.removeEventListener(e, this.handleGenericEvent);
    }
  }

  handleGenericEvent = async (e: Event) => {
    await postAudioEvent({ type: e.type as (typeof genericEventTypes)[number], id: this.id });
  };

  handleVolumeChange = async () => {
    console.log('handleVolumeChange');
    // The volumechange event signifies that the volume has changed; that includes being muted.
    await postAudioEvent({ type: 'volumechange', volume: this.audio.volume, id: this.id });
  };

  handleRateChange = async () => {
    console.log('handleRateChange');
    await postAudioEvent({ type: 'ratechange', rate: this.audio.playbackRate, id: this.id });
  };

  handleTimeUpdate = async () => {
    console.log('handleTimeUpdate');
    // The timeupdate event is triggered every time the currentTime property changes. In practice, this occurs every 250 milliseconds. This event can be used to trigger the displaying of playback progress.
    await postAudioEvent({ type: 'timeupdate', clock: this.audio.currentTime, id: this.id });
  };

  handleError = async (e: ErrorEvent) => {
    // An error is encountered while media data is being downloaded.
    console.error(e.error);
    console.error(e.message);
    await postAudioEvent({ type: 'error', error: e.message, id: this.id });
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

export async function postAudioEvent(event: t.FrontendMediaEvent) {
  await postMessage({ type: 'audio', event });
}
