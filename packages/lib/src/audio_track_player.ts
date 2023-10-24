import * as lib from './lib.js';
import assert from './assert.js';
import * as t from './types.js';

export default class AudioTrackPlayer implements t.TrackPlayer {
  name = 'audio';
  clock = 0;
  state: t.TrackPlayerState = {
    status: t.TrackPlayerStatus.Init,
    loading: false,
    loaded: false,
    buffering: false,
    seeking: false,
  };
  playbackRate = 1;
  isRecorder = false;

  onProgress?: (clock: number) => any;
  onStateChange?: (state: t.TrackPlayerState) => any;

  constructor(
    public track: t.AudioTrack,
    public postAudioMessage: t.PostAudioMessageToFrontend,
    public getSessionBlobWebviewUri: (sha1: string) => t.Uri,
    public sessionIO: t.SessionIO,
  ) {}

  load() {
    assert(this.state.status !== t.TrackPlayerStatus.Error, 'Track has error');
    if (this.state.loaded || this.state.loading) return;

    assert(this.track.file.type === 'local', 'AudioTrackPlayer: only supports local files');
    this.updateState({ loading: true, loaded: false });
    this.postAudioMessage({
      type: 'audio/load',
      id: this.track.id,
      src: this.getSessionBlobWebviewUri(this.track.file.sha1),
    }).catch(this.gotError);
  }

  start() {
    assert(this.state.status !== t.TrackPlayerStatus.Error, 'Track has error');
    if (this.state.status === t.TrackPlayerStatus.Running) return;

    this.updateState({ status: t.TrackPlayerStatus.Running });
    this.postAudioMessage({ type: 'audio/play', id: this.track.id }).catch(this.gotError);
  }

  pause() {
    assert(this.state.status !== t.TrackPlayerStatus.Error, 'Track has error');
    if (this.state.status === t.TrackPlayerStatus.Paused) return;

    this.updateState({ status: t.TrackPlayerStatus.Paused });
    this.postAudioMessage({ type: 'audio/pause', id: this.track.id }).catch(this.gotError);
  }

  stop() {
    if (this.state.status === t.TrackPlayerStatus.Stopped || this.state.status === t.TrackPlayerStatus.Error) return;

    this.updateState({ status: t.TrackPlayerStatus.Stopped });
    this.postAudioMessage({ type: 'audio/stop', id: this.track.id }).catch(this.gotError);
  }

  seek(clock: number) {
    assert(this.state.status !== t.TrackPlayerStatus.Error, 'Track has error');
    assert(this.state.loaded, 'Track is not loaded');

    this.clock = clock;
    this.updateState({ seeking: true });
    this.postAudioMessage({ type: 'audio/seek', id: this.track.id, clock }).catch(this.gotError);
  }

  setClock(clock: number) {
    this.clock = clock;
  }

  extend(clock: number) {
    throw new Error('AudioTrackPlayer not isRecorder');
  }

  setPlaybackRate(rate: number) {
    assert(this.state.status !== t.TrackPlayerStatus.Error, 'Track has error');

    this.playbackRate = rate;
    this.postAudioMessage({ type: 'audio/setPlaybackRate', rate, id: this.track.id }).catch(this.gotError);
  }

  dispose() {
    this.postAudioMessage({ type: 'audio/dispose', id: this.track.id }).catch(this.gotError);
  }

  handleAudioEvent(e: t.FrontendAudioEvent) {
    switch (e.type) {
      case 'loadstart': {
        console.log('loadstart');
        this.updateState({ loading: true });
        break;
      }
      case 'durationchange': {
        console.log('durationchange');
        // this.updateState({status: t.TrackPlayerStatus.Loading});
        break;
      }
      case 'loadedmetadata': {
        console.log('loadedmetadata');
        // this.updateState({status: t.TrackPlayerStatus.Loading});
        break;
      }
      case 'loadeddata': {
        console.log('loadeddata');
        // this.updateState({status: t.TrackPlayerStatus.Loading});
        break;
      }
      case 'progress': {
        console.log('progress');
        // this.updateState({status: t.TrackPlayerStatus.Loading});
        break;
      }
      case 'canplay': {
        console.log('canplay');
        break;
      }
      case 'canplaythrough': {
        console.log('canplaythrough');
        this.updateState({ loading: false, loaded: true });
        break;
      }
      case 'suspend': {
        console.log('suspend');
        // this.updateState({status: t.TrackPlayerStatus.Stopped});
        break;
      }
      case 'abort': {
        console.log('abort');
        // this.updateState({status: t.TrackPlayerStatus.Stopped});
        break;
      }
      case 'emptied': {
        console.log('emptied');
        // this.updateState({status: t.TrackPlayerStatus.Stopped});
        break;
      }
      case 'stalled': {
        console.log('stalled');
        // this.updateState({status: t.TrackPlayerStatus.Stopped});
        break;
      }
      case 'playing': {
        console.log('playing');
        this.updateState({ status: t.TrackPlayerStatus.Running, buffering: false, seeking: false });
        break;
      }
      case 'waiting': {
        console.log('waiting');
        this.updateState({ buffering: true });
        break;
      }
      case 'play': {
        console.log('play');
        // this.updateState({status: t.TrackPlayerStatus.Playing});
        break;
      }
      case 'pause': {
        console.log('pause');
        this.updateState({ status: t.TrackPlayerStatus.Paused });
        break;
      }
      case 'ended': {
        console.log('ended');
        this.updateState({ status: t.TrackPlayerStatus.Stopped });
        // await this.afterPauseOrStop(t.PlayerStatus.Paused);
        break;
      }
      case 'seeking': {
        console.log('seeking');
        this.updateState({ seeking: true });
        break;
      }
      case 'seeked': {
        console.log('seeked');
        this.updateState({ seeking: false });
        break;
      }
      case 'timeupdate': {
        console.log('timeupdate', e.clock);
        // We might receive progress update before seeking to another position is complete.
        // In which case, just ignore the progress update.
        if (!this.state.seeking) {
          this.clock = e.clock;
          this.onProgress?.(this.clock);
        }
        break;
      }
      case 'volumechange': {
        console.log('volumechange', e.volume);
        break;
      }
      case 'error': {
        console.error('error', e.error);
        this.gotError(e.error);
        break;
      }
      default: {
        lib.unreachable(e);
      }
    }
  }

  private gotError = (error?: any) => {
    this.updateState({ status: t.TrackPlayerStatus.Error });
  };

  private updateState(partial: Partial<t.TrackPlayerState>) {
    this.state = { ...this.state, ...partial };
    this.onStateChange?.(this.state);
  }
}
