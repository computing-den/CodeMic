import * as t from '../lib/types.js';
import * as lib from '../lib/lib.js';
import assert from '../lib/assert.js';
import postMessage from './api.js';
import * as misc from './misc.js';
import _ from 'lodash';
import config from './config.js';

// export enum MediaStatus {
//   Init,
//   Waiting,
//   Initialized,
//   Playing,
//   Error,
// }

export default class VideoManager {
  video?: HTMLVideoElement;
  // videoTracks?: t.VideoTrack[];
  curTrackId?: string;
  sessionDataPath?: string;
  constructor() {}

  updateResources(sessionDataPath: string) {
    // this.videoTrack = videoTrack;
    this.sessionDataPath = sessionDataPath;
  }

  prepare(video: HTMLVideoElement) {
    if (config.logWebviewVideoEvents) console.log(`VideoManager prepare`);
    if (this.video !== video) {
      this.video = video;

      video.addEventListener('volumechange', this.handleVolumeChange);
      video.addEventListener('ratechange', this.handleRateChange);
      video.addEventListener('timeupdate', this.handleTimeUpdate);
      video.addEventListener('error', this.handleError);

      for (const type of genericEventTypes) {
        video.addEventListener(type, this.handleGenericEvent);
      }

      video.muted = false;
      video.volume = 1;
      video.preload = 'auto';

      video.load();
    }
  }

  loadTrack(videoTrack: t.VideoTrack) {
    if (config.logWebviewVideoEvents) console.log(`VideoManager loadTrack`, videoTrack);
    if (!this.video) return console.error('VideoManager loadTrack: video is not set');

    // const track = this.videoTracks?.find(t => t.id === id);
    // if (!track) return console.error('VideoManager loadTrack: track not found: ', id);

    assert(this.sessionDataPath);
    assert(videoTrack.file.type === 'local');
    this.video.src = misc.asWebviewUri(this.sessionDataPath, 'blobs', videoTrack.file.sha1).toString();
  }

  async play() {
    if (config.logWebviewVideoEvents) console.log(`VideoManager play`);
    await this.video?.play();
  }

  pause() {
    if (config.logWebviewVideoEvents) console.log(`VideoManager pause`);
    this.video?.pause();
  }

  stop() {
    if (config.logWebviewVideoEvents) console.log(`VideoManager stop`);
    if (this.video) {
      this.video.pause();

      // Setting video.src = '' is like setting video.src to the website URL and that's
      // exactly what you get if you then try to read video.src
      this.video.removeAttribute('src');
      this.video.load();

      this.curTrackId = undefined;
    }
  }

  seek(clock: number) {
    if (config.logWebviewVideoEvents) console.log(`VideoManager seek`, clock);
    if (this.video) this.video.currentTime = clock;
  }

  setPlaybackRate(rate: number) {
    if (config.logWebviewVideoEvents) console.log(`VideoManager setPlaybackRate`, rate);
    if (this.video) this.video.playbackRate = rate;
  }

  dispose() {
    if (config.logWebviewVideoEvents) console.log(`VideoManager dispose`);
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
    if (config.logWebviewVideoEvents) console.log(`VideoManager close`);
    this.dispose();
  }

  handleGenericEvent = async (e: Event) => {
    if (config.logWebviewVideoEvents) console.log('handleGenericEvent', e.type);

    // NOTE: loadstart is triggered after we stop and set src=''.
    if (this.video?.src) {
      await postVideoEvent({ type: e.type as (typeof genericEventTypes)[number], id: this.curTrackId });
    }
  };

  handleVolumeChange = async () => {
    if (config.logWebviewVideoEvents) console.log('handleVolumeChange');
    // The volumechange event signifies that the volume has changed; that includes being muted.
    await postVideoEvent({ type: 'volumechange', volume: this.video!.volume, id: this.curTrackId });
  };

  handleRateChange = async () => {
    if (config.logWebviewVideoEvents) console.log('handleRateChange');
    await postVideoEvent({ type: 'ratechange', rate: this.video!.playbackRate, id: this.curTrackId });
  };

  handleTimeUpdate = async () => {
    if (config.logWebviewVideoEvents) console.log('handleTimeUpdate');
    // The timeupdate event is triggered every time the currentTime property changes.
    // In practice, this occurs every 250 milliseconds.
    // This event can be used to trigger the displaying of playback progress.
    await postVideoEvent({ type: 'timeupdate', clock: this.video!.currentTime, id: this.curTrackId });
  };

  handleError = async (e: ErrorEvent) => {
    // An error is encountered while media data is being downloaded.
    console.error(e.error);
    console.error(e.message);
    await postVideoEvent({ type: 'error', error: e.message, id: this.curTrackId });
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
