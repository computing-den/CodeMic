import { types as t, lib, assert } from '@codemic/lib';
import postMessage from './api.js';
import _ from 'lodash';

// export enum MediaStatus {
//   Init,
//   Waiting,
//   Initialized,
//   Playing,
//   Error,
// }

export default class VideoManager {
  video?: HTMLVideoElement;
  webviewUris?: t.WebviewUris;
  videoTracks?: t.VideoTrack[];
  curTrackId?: string;
  prepared = false;
  constructor() {}

  updateResources(webviewUris: t.WebviewUris, videoTracks: t.VideoTrack[] = []) {
    this.webviewUris = webviewUris;
    this.videoTracks = videoTracks;
  }

  prepare(video: HTMLVideoElement) {
    console.log(`VideoManager prepare`);
    if (!this.prepared) {
      this.video = video;

      video.addEventListener('volumechange', this.handleVolumeChange);
      video.addEventListener('timeupdate', this.handleTimeUpdate);
      video.addEventListener('error', this.handleError);

      for (const type of genericEventTypes) {
        video.addEventListener(type, this.handleGenericEvent);
      }

      video.muted = false;
      video.volume = 1;
      video.preload = 'auto';

      video.load();
      this.prepared = true;
    }
  }

  loadTrack(id: string) {
    console.log(`VideoManager loadTrack`, id);
    if (!this.video) return console.error('VideoManager loadTrack: video is not set');

    const track = this.videoTracks?.find(t => t.id === id);
    if (!track) return console.error('VideoManager loadTrack: track not found: ', id);

    const uri = this.webviewUris?.[id];
    if (!uri) return console.error('VideoManager loadTrack: webview uri not found: ', id);

    this.video.src = uri;
  }

  async play() {
    console.log(`VideoManager play`);
    await this.video?.play();
  }

  pause() {
    console.log(`VideoManager pause`);
    this.video?.pause();
  }

  stop() {
    console.log(`VideoManager stop`);
    if (this.video) {
      this.video.pause();
      this.video.src = '';
      this.curTrackId = undefined;
    }
  }

  seek(clock: number) {
    console.log(`VideoManager seek`, clock);
    if (this.video) this.video.currentTime = clock;
  }

  setPlaybackRate(rate: number) {
    console.log(`VideoManager setPlaybackRate`, rate);
    if (this.video) this.video.playbackRate = rate;
  }

  dispose() {
    console.log(`VideoManager dispose`);
    if (this.video) {
      this.video.pause();
      this.video.removeEventListener('volumechange', this.handleVolumeChange);
      this.video.removeEventListener('ratechange', this.handleRateChange);
      this.video.removeEventListener('timeupdate', this.handleTimeUpdate);
      this.video.removeEventListener('error', this.handleError);
      for (const e of genericEventTypes) {
        this.video.removeEventListener(e, this.handleGenericEvent);
      }
    }
  }

  close() {
    console.log(`VideoManager close`);
    this.dispose();
  }

  handleGenericEvent = async (e: Event) => {
    console.log('handleGenericEvent', e.type);
    await postVideoEvent({ type: e.type as (typeof genericEventTypes)[number], id: this.curTrackId! });
  };

  handleVolumeChange = async () => {
    console.log('handleVolumeChange');
    // The volumechange event signifies that the volume has changed; that includes being muted.
    await postVideoEvent({ type: 'volumechange', volume: this.video!.volume, id: this.curTrackId! });
  };

  handleRateChange = async () => {
    console.log('handleRateChange');
    await postVideoEvent({ type: 'ratechange', rate: this.video!.playbackRate, id: this.curTrackId! });
  };

  handleTimeUpdate = async () => {
    console.log('handleTimeUpdate');
    // The timeupdate event is triggered every time the currentTime property changes.
    // In practice, this occurs every 250 milliseconds.
    // This event can be used to trigger the displaying of playback progress.
    await postVideoEvent({ type: 'timeupdate', clock: this.video!.currentTime, id: this.curTrackId! });
  };

  handleError = async (e: ErrorEvent) => {
    if (!this.curTrackId) return; // Happens after stop() is called and src is set to ''.
    // An error is encountered while media data is being downloaded.
    console.error(e.error);
    console.error(e.message);
    await postVideoEvent({ type: 'error', error: e.message, id: this.curTrackId! });
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

export async function postVideoEvent(event: t.FrontendMediaEvent) {
  await postMessage({ type: 'video', event });
}
