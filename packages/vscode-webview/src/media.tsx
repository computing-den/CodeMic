import { types as t, lib } from '@codecast/lib';
import postMessage, { setMediaEventListener } from './api.js';
import _ from 'lodash';

// export enum MediaStatus {
//   Init,
//   Waiting,
//   Ready,
//   Playing,
//   Error,
// }

export default class Media {
  audio = new Audio();

  constructor() {
    this.audio.addEventListener('volumechange', this.handleVolumechange);
    this.audio.addEventListener('timeupdate', this.handleTimeupdate);
    this.audio.addEventListener('error', this.handleError);

    for (const type of genericEventTypes) {
      this.audio.addEventListener(type, this.handleGenericEvent);
    }

    setMediaEventListener(this.handleBackendMediaEvent.bind(this));
  }

  stop() {
    for (const e of genericEventTypes) {
      this.audio.removeEventListener(e, this.handleGenericEvent);
    }
  }

  handleGenericEvent = async (e: Event) => {
    await postMessage({ type: 'frontendMediaEvent', event: { type: e.type as (typeof genericEventTypes)[number] } });
  };

  handleVolumechange = async () => {
    console.log('handleVolumechange');
    // The volumechange event signifies that the volume has changed; that includes being muted.
    await postMessage({ type: 'frontendMediaEvent', event: { type: 'volumechange', volume: this.audio.volume } });
  };

  handleTimeupdate = async () => {
    console.log('handleTimeupdate');
    // The timeupdate event is triggered every time the currentTime property changes. In practice, this occurs every 250 milliseconds. This event can be used to trigger the displaying of playback progress.
    await postMessage({ type: 'frontendMediaEvent', event: { type: 'timeupdate', clock: this.audio.currentTime } });
  };

  handleError = async (e: ErrorEvent) => {
    // An error is encountered while media data is being downloaded.
    console.error(e.error);
    console.error(e.message);
    await postMessage({ type: 'frontendMediaEvent', event: { type: 'error', error: e.message } });
  };

  async handleBackendMediaEvent(e: t.BackendMediaEvent): Promise<t.FrontendResponse> {
    switch (e.type) {
      case 'load': {
        this.audio.src = e.src;
        return { type: 'ok' };
      }
      case 'play': {
        await this.audio.play();
        return { type: 'ok' };
      }
      case 'pause': {
        this.audio.pause();
        return { type: 'ok' };
      }
      case 'seek': {
        this.audio.currentTime = e.clock;
        return { type: 'ok' };
      }
      default:
        lib.unreachable(e);
    }
  }
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
