import * as t from '../../lib/types.js';
import assert from '../../lib/assert.js';
import * as lib from '../../lib/lib.js';
import _ from 'lodash';
import { LoadedSession } from './session.js';
import config from '../config.js';

export default class AudioTrackPlayer {
  audioTrack: t.AudioTrack;
  running = false;
  onError?: (error: Error) => any;

  private session: LoadedSession;
  private clock = 0;
  private loaded = false;
  private loading = false;
  private seekAfterLoad = false;

  constructor(session: LoadedSession, audioTrack: t.AudioTrack) {
    this.session = session;
    this.audioTrack = audioTrack;
  }

  // load() {
  //   assert(this.audioTrack.file.type === 'local', 'AudioTrackPlayer: only supports local files');
  //   if (!this.loading && !this.loaded) {
  //     this.loading = true;
  //     // this.postAudioMessage({
  //     //   type: 'audio/load',
  //     //   id: this.audioTrack.id,
  //     //   src: this.getSessionBlobUri(this.audioTrack.file.sha1),
  //     // }).catch(this.gotError);
  //   }
  // }

  play() {
    this.running = true;
    if (this.loaded) {
      this.session.context.postAudioMessage?.({ type: 'audio/play', id: this.audioTrack.id }).catch(this.gotError);
    }
  }

  pause() {
    this.running = false;
    if (this.loaded) {
      this.session.context.postAudioMessage?.({ type: 'audio/pause', id: this.audioTrack.id }).catch(this.gotError);
    }
  }

  seek(clock: number) {
    this.clock = clock;
    if (!this.loaded) {
      this.seekAfterLoad = true;
    } else {
      this.session.context
        .postAudioMessage?.({ type: 'audio/seek', id: this.audioTrack.id, clock })
        .catch(this.gotError);
    }
  }

  // /**
  //  * Current clock must be < cut clock.
  //  */
  // cut(clock: number) {
  //   assert(this.clock <= clock);
  //   const { clockRange } = this.audioTrack;
  //   this.audioTrack.clockRange = { start: Math.min(clockRange.start, clock), end: Math.min(clockRange.end, clock) };
  // }

  // setPlaybackRate(rate: number) {
  //   assert(this.state.status !== t.TrackPlayerStatus.Error, 'Track has error');

  //   this.playbackRate = rate;
  //   this.postAudioMessage({ type: 'audio/setPlaybackRate', rate, id: this.audioTrack.id }).catch(this.gotError);
  // }

  // dispose() {
  //   this.postAudioMessage({ type: 'audio/dispose', id: this.audioTrack.id }).catch(this.gotError);
  // }

  handleAudioEvent(e: t.FrontendMediaEvent) {
    switch (e.type) {
      case 'loadstart': {
        if (config.logBackendAudioEvents) console.log('loadstart');
        this.loading = true;
        break;
      }
      case 'durationchange': {
        if (config.logBackendAudioEvents) console.log('durationchange');
        break;
      }
      case 'loadedmetadata': {
        if (config.logBackendAudioEvents) console.log('loadedmetadata');
        break;
      }
      case 'loadeddata': {
        if (config.logBackendAudioEvents) console.log('loadeddata');
        break;
      }
      case 'progress': {
        if (config.logBackendAudioEvents) console.log('progress');
        break;
      }
      case 'canplay': {
        if (config.logBackendAudioEvents) console.log('canplay');
        break;
      }
      case 'canplaythrough': {
        if (config.logBackendAudioEvents) console.log('canplaythrough');
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
        if (config.logBackendAudioEvents) console.log('suspend');
        break;
      }
      case 'abort': {
        if (config.logBackendAudioEvents) console.log('abort');
        break;
      }
      case 'emptied': {
        if (config.logBackendAudioEvents) console.log('emptied');
        break;
      }
      case 'stalled': {
        if (config.logBackendAudioEvents) console.log('stalled');
        break;
      }
      case 'playing': {
        if (config.logBackendAudioEvents) console.log('playing');
        break;
      }
      case 'waiting': {
        if (config.logBackendAudioEvents) console.log('waiting');
        break;
      }
      case 'play': {
        if (config.logBackendAudioEvents) console.log('play');
        break;
      }
      case 'pause': {
        if (config.logBackendAudioEvents) console.log('pause');
        break;
      }
      case 'ended': {
        if (config.logBackendAudioEvents) console.log('ended');
        break;
      }
      case 'seeking': {
        if (config.logBackendAudioEvents) console.log('seeking');
        break;
      }
      case 'seeked': {
        if (config.logBackendAudioEvents) console.log('seeked');
        break;
      }
      case 'timeupdate': {
        if (config.logBackendAudioEvents) console.log('timeupdate', e.clock);
        // We might receive progress update before seeking to another position is complete.
        // In which case, just ignore the progress update.
        // if (!this.seeking) {
        //   this.clock = e.clock;
        //   this.onProgress?.(this.clock);
        // }
        break;
      }
      case 'volumechange': {
        if (config.logBackendAudioEvents) console.log('volumechange', e.volume);
        break;
      }
      case 'ratechange': {
        if (config.logBackendAudioEvents) console.log('ratechange', e.rate);
        break;
      }
      case 'error': {
        console.error('error', e.error);
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
