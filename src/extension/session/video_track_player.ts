import * as t from '../../lib/types.js';
import * as lib from '../../lib/lib.js';
import _ from 'lodash';
import { LoadedSession } from './session.js';
import config from '../config.js';

export default class VideoTrackPlayer {
  videoTrack: t.VideoTrack | undefined;
  running = false;
  onError?: (error: Error) => any;

  private session: LoadedSession;
  private clock = 0;
  private loaded = false;
  private loading = false;
  private seekAfterLoad = false;

  constructor(session: LoadedSession) {
    this.session = session;
  }

  // load() {
  //   console.log('VideoTrackPlayers load', this.loading, this.loaded);
  //   if (!this.loading && !this.loaded) {
  //     this.loading = true;
  //   }
  // }

  loadTrack(videoTrack: t.VideoTrack) {
    if (config.logBackendVideoEvents) console.log('VideoTrackPlayers loadTrack');
    if (this.videoTrack?.id !== videoTrack.id) {
      if (config.logBackendVideoEvents) console.log('VideoTrackPlayers loadTrack accepted');
      this.loaded = false;
      this.loading = true;
      this.videoTrack = videoTrack;
      this.session.context.postVideoMessage?.({ type: 'video/loadTrack', track: videoTrack }).catch(this.gotError);
    }
  }

  // unloadTrack() {
  //   if (this.videoTrack) {
  //     this.loaded = false;
  //     this.loading = false;
  //     this.videoTrack = undefined;
  //     // this.session.context.postVideoMessage?.({ type: 'video/loadTrack', track: videoTrack }).catch(this.gotError);
  //   }
  // }

  play() {
    if (config.logBackendVideoEvents) console.log('VideoTrackPlayers play', this.loaded);
    this.running = true;
    if (this.loaded) {
      this.session.context.postVideoMessage?.({ type: 'video/play' }).catch(this.gotError);
    }
  }

  pause() {
    if (config.logBackendVideoEvents) console.log('VideoTrackPlayers pause', this.loaded);
    this.running = false;
    if (this.loaded) {
      this.session.context.postVideoMessage?.({ type: 'video/pause' }).catch(this.gotError);
    }
  }

  stop() {
    if (config.logBackendVideoEvents) console.log('VideoTrackPlayers stop', this.loaded);
    this.running = false;
    if (this.loaded) {
      this.session.context.postVideoMessage?.({ type: 'video/stop' }).catch(this.gotError);
      this.videoTrack = undefined;
    }
  }

  seek(clock: number) {
    if (config.logBackendVideoEvents) console.log('VideoTrackPlayers seek', this.loaded, clock);
    this.clock = clock;
    if (!this.loaded) {
      this.seekAfterLoad = true;
    } else {
      this.session.context.postVideoMessage?.({ type: 'video/seek', clock }).catch(this.gotError);
    }
  }

  handleVideoEvent(e: t.FrontendMediaEvent) {
    switch (e.type) {
      case 'loadstart': {
        if (config.logBackendVideoEvents) console.log('loadstart', this.videoTrack?.title);
        this.loading = true;
        break;
      }
      case 'durationchange': {
        if (config.logBackendVideoEvents) console.log('durationchange', this.videoTrack?.title);
        break;
      }
      case 'loadedmetadata': {
        if (config.logBackendVideoEvents) console.log('loadedmetadata', this.videoTrack?.title);
        break;
      }
      case 'loadeddata': {
        if (config.logBackendVideoEvents) console.log('loadeddata', this.videoTrack?.title);
        break;
      }
      case 'progress': {
        if (config.logBackendVideoEvents) console.log('progress', this.videoTrack?.title);
        break;
      }
      case 'canplay': {
        if (config.logBackendVideoEvents) console.log('canplay', this.videoTrack?.title);
        break;
      }
      case 'canplaythrough': {
        if (config.logBackendVideoEvents) console.log('canplaythrough', this.videoTrack?.title);
        const isFirstLoad = !this.loaded;
        this.loading = false;
        this.loaded = true;

        if (isFirstLoad) {
          if (this.seekAfterLoad) {
            this.seekAfterLoad = false;
            this.seek(this.clock);
          }

          if (this.running) {
            this.play();
          }
        }

        break;
      }
      case 'suspend': {
        if (config.logBackendVideoEvents) console.log('suspend', this.videoTrack?.title);
        break;
      }
      case 'abort': {
        if (config.logBackendVideoEvents) console.log('abort', this.videoTrack?.title);
        break;
      }
      case 'emptied': {
        if (config.logBackendVideoEvents) console.log('emptied', this.videoTrack?.title);
        break;
      }
      case 'stalled': {
        if (config.logBackendVideoEvents) console.log('stalled', this.videoTrack?.title);
        break;
      }
      case 'playing': {
        if (config.logBackendVideoEvents) console.log('playing', this.videoTrack?.title);
        break;
      }
      case 'waiting': {
        if (config.logBackendVideoEvents) console.log('waiting', this.videoTrack?.title);
        break;
      }
      case 'play': {
        if (config.logBackendVideoEvents) console.log('play', this.videoTrack?.title);
        break;
      }
      case 'pause': {
        if (config.logBackendVideoEvents) console.log('pause', this.videoTrack?.title);
        break;
      }
      case 'ended': {
        if (config.logBackendVideoEvents) console.log('ended', this.videoTrack?.title);
        break;
      }
      case 'seeking': {
        if (config.logBackendVideoEvents) console.log('seeking', this.videoTrack?.title);
        break;
      }
      case 'seeked': {
        if (config.logBackendVideoEvents) console.log('seeked', this.videoTrack?.title);
        break;
      }
      case 'timeupdate': {
        if (config.logBackendVideoEvents) console.log('timeupdate', e.clock, this.videoTrack?.title);
        // We might receive progress update before seeking to another position is complete.
        // In which case, just ignore the progress update.
        // if (!this.seeking) {
        //   this.clock = e.clock;
        //   this.onProgress?.(this.clock);
        // }
        break;
      }
      case 'volumechange': {
        if (config.logBackendVideoEvents) console.log('volumechange', e.volume, this.videoTrack?.title);
        break;
      }
      case 'ratechange': {
        if (config.logBackendVideoEvents) console.log('ratechange', e.rate, this.videoTrack?.title);
        break;
      }
      case 'error': {
        console.error('error', e.error, this.videoTrack?.title);
        this.gotError(new Error(e.error));
        break;
      }
      default: {
        lib.unreachable(e);
      }
    }
  }

  private gotError = (error: Error) => {
    this.onError?.(error);
  };
}
