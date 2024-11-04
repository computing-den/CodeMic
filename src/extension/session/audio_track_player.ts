import * as t from '../../lib/types.js';
import assert from '../../lib/assert.js';
import * as lib from '../../lib/lib.js';
import type Session from './session.js';
import _ from 'lodash';

export default class AudioTrackPlayer {
  audioTrack: t.AudioTrack;
  running = false;
  onError?: (error: Error) => any;

  private session: Session;
  private clock = 0;
  private loaded = false;
  private loading = false;
  private seekAfterLoad = false;

  constructor(session: Session, audioTrack: t.AudioTrack) {
    this.session = session;
    this.audioTrack = audioTrack;
  }

  load() {
    assert(this.audioTrack.file.type === 'local', 'AudioTrackPlayer: only supports local files');
    if (!this.loading && !this.loaded) {
      this.loading = true;
      // this.postAudioMessage({
      //   type: 'audio/load',
      //   id: this.audioTrack.id,
      //   src: this.getSessionBlobWebviewUri(this.audioTrack.file.sha1),
      // }).catch(this.gotError);
    }
  }

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
        console.log('loadstart');
        this.loading = true;
        break;
      }
      case 'durationchange': {
        console.log('durationchange');
        break;
      }
      case 'loadedmetadata': {
        console.log('loadedmetadata');
        break;
      }
      case 'loadeddata': {
        console.log('loadeddata');
        break;
      }
      case 'progress': {
        console.log('progress');
        break;
      }
      case 'canplay': {
        console.log('canplay');
        break;
      }
      case 'canplaythrough': {
        console.log('canplaythrough');
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
        console.log('suspend');
        break;
      }
      case 'abort': {
        console.log('abort');
        break;
      }
      case 'emptied': {
        console.log('emptied');
        break;
      }
      case 'stalled': {
        console.log('stalled');
        break;
      }
      case 'playing': {
        console.log('playing');
        break;
      }
      case 'waiting': {
        console.log('waiting');
        break;
      }
      case 'play': {
        console.log('play');
        break;
      }
      case 'pause': {
        console.log('pause');
        break;
      }
      case 'ended': {
        console.log('ended');
        break;
      }
      case 'seeking': {
        console.log('seeking');
        break;
      }
      case 'seeked': {
        console.log('seeked');
        break;
      }
      case 'timeupdate': {
        console.log('timeupdate', e.clock);
        // We might receive progress update before seeking to another position is complete.
        // In which case, just ignore the progress update.
        // if (!this.seeking) {
        //   this.clock = e.clock;
        //   this.onProgress?.(this.clock);
        // }
        break;
      }
      case 'volumechange': {
        console.log('volumechange', e.volume);
        break;
      }
      case 'ratechange': {
        console.log('ratechange', e.rate);
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
