import config from './config.js';
import type * as t from '../lib/types.js';
import * as lib from '../lib/lib.js';
// import VideoTrackManager from './video_manager.js';
import _ from 'lodash';
import assert from '../lib/assert.js';
import postMessage from './api.js';

export default class MediaManager {
  trackManagers: { [key: string]: TrackManager } = {};
  audioContext: AudioContext;

  constructor() {
    this.audioContext = new AudioContext();
  }

  async handleRequest(req: t.BackendMediaRequest): Promise<t.FrontendMediaResponse> {
    switch (req.type) {
      case 'media/load': {
        assert(!this.trackManagers[req.id], `Media already loaded: ${req.mediaType} id: ${req.id}`);
        if (req.mediaType === 'audio') {
          this.trackManagers[req.id] = new AudioTrackManager(req.id, req.src, req.clock);
        } else if (req.mediaType === 'video' || req.mediaType === 'image') {
          // Replace existing video if there's one.
          let videoTrackManager = _.find(this.trackManagers, m => m instanceof VideoTrackManager);
          if (videoTrackManager) {
            delete this.trackManagers[videoTrackManager.id];
          } else {
            videoTrackManager = new VideoTrackManager(req.id, req.mediaType, req.src);
          }
          await videoTrackManager.replace(req.id, req.mediaType, req.src, req.clock, req.loop, req.blank);
          this.trackManagers[req.id] = videoTrackManager;
        } else {
          throw new Error(`media/load unknow media type ${req.mediaType}`);
        }

        return { type: 'ok' };
      }
      case 'media/play': {
        await this.trackManagers[req.id].play();
        return { type: 'ok' };
      }
      case 'media/pause': {
        this.trackManagers[req.id].pause();
        return { type: 'ok' };
      }
      case 'media/pauseAll': {
        for (const t of Object.values(this.trackManagers)) t.pause();
        return { type: 'ok' };
      }
      case 'media/stop': {
        this.trackManagers[req.id].stop();
        return { type: 'ok' };
      }
      case 'media/dispose': {
        this.disposeOne(req.id);
        return { type: 'ok' };
      }
      case 'media/seek': {
        this.trackManagers[req.id].seek(req.clock);
        return { type: 'ok' };
      }
      case 'media/setPlaybackRate': {
        this.trackManagers[req.id].setPlaybackRate(req.rate);
        return { type: 'ok' };
      }
      case 'media/statuses': {
        return { type: 'mediaStatuses', mediaStatuses: _.mapValues(this.trackManagers, m => m.getStatus()) };
      }
      default: {
        lib.unreachable(req);
      }
    }
  }

  async prepare() {
    try {
      this.audioContext.suspend();
      await Promise.all(Object.values(this.trackManagers).map(m => m.prepare(this)));
    } finally {
      this.audioContext.resume();
    }
  }

  async dispose() {
    // Don't use for-in here because disposeOne mutates this.trackManagers.
    for (const id of Object.keys(this.trackManagers)) this.disposeOne(id);

    // Call this last so that we've already removed all all track managers even it it fails.
    // Note: don't use this.audioContext.close() because once closed, it cannot be used again.
    await this.audioContext.suspend();
  }

  disposeOne(id: string) {
    if (!this.trackManagers[id]) return;

    try {
      this.trackManagers[id].dispose();
      delete this.trackManagers[id];
    } catch (error) {
      console.error(`Error while disposing of track ${id}`, error);
    }
  }
}

interface TrackManager {
  prepare(mediaManager: MediaManager): Promise<void>;
  // load(id: string, src: string): Promise<void>;
  play(): Promise<void>;
  pause(): void;
  stop(): void;
  seek(clock: number): void;
  setPlaybackRate(rate: number): void;
  dispose(): void;
  getStatus(): t.MediaStatus;
}

class AudioTrackManager implements TrackManager {
  audio: HTMLAudioElement;
  node?: MediaElementAudioSourceNode;

  constructor(public id: string, public src: string, clock: number) {
    this.audio = new Audio();
    this.audio.addEventListener('error', this.handleError);
    this.audio.src = src;
    this.audio.preload = 'auto';
    this.audio.currentTime = clock;
    this.audio.preservesPitch = true;
    this.audio.load();
    if (config.logWebviewAudioEvents) console.log(`AudioTrackManager: created audio: ${id} (${this.audio.src})`);
  }

  /**
   * audioContext must be suspended before calling prepare.
   * Puts the audio in a suspended audio context so that the initial play and pause
   * don't trigger a sudden sound.
   */
  async prepare(mediaManager: MediaManager) {
    if (!this.node) {
      if (config.logWebviewAudioEvents)
        console.log(`AudioTrackManager: preparing audio ${this.id} (${this.audio.src})`);

      assert(mediaManager.audioContext.state === 'suspended');
      this.node = mediaManager.audioContext.createMediaElementSource(this.audio);
      this.node.connect(mediaManager.audioContext.destination);
      await this.audio.play();
      this.audio.pause();
      if (config.logWebviewAudioEvents) console.log(`AudioTrackManager: prepared audio ${this.id}`);
    }
  }

  async play() {
    if (config.logWebviewAudioEvents) console.log(`AudioTrackManager play`);
    await this.audio.play();
  }

  pause() {
    if (config.logWebviewAudioEvents) console.log(`AudioTrackManager pause`);
    this.audio.pause();
  }

  stop() {
    if (config.logWebviewAudioEvents) console.log(`AudioTrackManager stop`);
    this.audio.pause();
  }

  seek(clock: number) {
    if (config.logWebviewAudioEvents)
      console.log(`AudioTrackManager seek ${clock} (current time was ${this.audio.currentTime})`);
    this.audio.currentTime = clock;
  }

  setPlaybackRate(rate: number) {
    if (config.logWebviewAudioEvents) console.log(`AudioTrackManager setPlaybackRate ${rate}`);
    this.audio.playbackRate = rate;
  }

  dispose() {
    this.node?.disconnect();
    this.audio.pause();
    this.audio.removeEventListener('error', this.handleError);
  }

  getStatus(): t.MediaStatus {
    return getHTMLMediaElementStatus(this.audio, 'audio');
  }

  private handleError = async (e: ErrorEvent) => {
    // An error is encountered while media data is being downloaded.
    console.error(e.error);
    console.error(e.message);
    await postMessage({ type: 'media/error', mediaType: 'audio', id: this.id, error: e.message });
  };
}

/**
 * Expects the video element to be mounted on the page with id #guide-video
 */
class VideoTrackManager implements TrackManager {
  video: HTMLVideoElement;

  constructor(public id: string, public mediaType: t.MediaType, public src: string) {
    if (config.logWebviewVideoEvents) console.log(`VideoTrackManager create video ${id}: ${src}`);

    const elem = document.querySelector('#guide-video');
    assert(elem instanceof HTMLVideoElement, 'Did not find video element');
    this.video = elem;

    this.video.addEventListener('error', this.handleError);
  }

  async replace(id: string, mediaType: t.MediaType, src: string, clock: number, loop?: boolean, blank?: boolean) {
    if (mediaType === 'image') {
      let img = new Image();
      const meta = await new Promise<{ width: number; height: number }>((resolve, reject) => {
        img.onload = () => resolve({ width: img.width, height: img.height });
        img.onerror = reject;
        img.src = src;
      });

      const canvas = document.createElement('canvas');
      canvas.width = meta.width;
      canvas.height = meta.height;
      const ctx = canvas.getContext('2d');
      assert(ctx);
      ctx.drawImage(img, 0, 0);

      const stream = canvas.captureStream(30);
      this.video.srcObject = stream;
      this.video.currentTime = 0;
    } else {
      this.video.srcObject = null;
      this.video.src = src;
      this.video.currentTime = clock;
    }

    this.id = id;
    this.src = src;
    this.mediaType = mediaType;
    this.video.muted = false;
    this.video.volume = 1;
    this.video.preload = 'auto';
    this.video.preservesPitch = true;
    this.video.loop = Boolean(loop);
    if (blank) {
      this.video.dataset.blank = 'true';
    } else {
      delete this.video.dataset.blank;
    }
    this.video.load();
  }

  async prepare(_mediaManager: MediaManager) {
    await this.video.play();
    this.video.pause();
  }

  async play() {
    if (config.logWebviewVideoEvents) console.log(`VideoTrackManager play`);
    await this.video?.play();
  }

  pause() {
    if (config.logWebviewVideoEvents) console.log(`VideoTrackManager pause`);
    this.video?.pause();
  }

  stop() {
    if (config.logWebviewVideoEvents) console.log(`VideoTrackManager stop`);
    this.video.pause();

    // Setting video.src = '' is like setting video.src to the website URL and that's
    // exactly what you get if you then try to read video.src
    this.video.removeAttribute('src');
    this.video.load();
  }

  seek(clock: number) {
    if (config.logWebviewVideoEvents) console.log(`VideoTrackManager seek`, clock);
    this.video.currentTime = clock;
  }

  setPlaybackRate(rate: number) {
    if (config.logWebviewVideoEvents) console.log(`VideoTrackManager setPlaybackRate`, rate);
    this.video.playbackRate = rate;
  }

  dispose() {
    if (config.logWebviewVideoEvents) console.log(`VideoTrackManager dispose`);
    this.stop();
    this.video.removeEventListener('error', this.handleError);
  }

  getStatus(): t.MediaStatus {
    return getHTMLMediaElementStatus(this.video, 'video');
  }

  private handleError = async (e: ErrorEvent) => {
    // An error is encountered while media data is being downloaded.
    console.error(e.error);
    console.error(e.message);
    await postMessage({ type: 'media/error', mediaType: 'video', id: this.id, error: e.message });
  };
}

function getHTMLMediaElementStatus(media: HTMLMediaElement, type: t.MediaType): t.MediaStatus {
  return {
    type,
    readyState: media.readyState,
    networkState: media.networkState,
    currentTime: media.currentTime,
    volume: media.volume,
    muted: media.muted,
    duration: media.duration,
    playbackRate: media.playbackRate,
    paused: media.paused,
    seeking: media.seeking,
    ended: media.ended,
    error: media.error ? media.error.message || media.error.code.toString() : '',
    currentSrc: media.currentSrc,
    src: media.src,
  };
}

export const mediaManager = new MediaManager();
