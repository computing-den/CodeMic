import * as lib from './lib.js';
import assert from './assert.js';
import * as t from './types.js';

export default class AudioTrackPlayer implements t.TrackPlayer {
  clock: number = 0;
  status: t.TrackPlayerStatus = t.TrackPlayerStatus.Init;
  onProgress?: (clock: number) => any;
  onStatusChange?: (status: t.TrackPlayerStatus) => any;

  constructor(
    public audioTrack: t.AudioTrack,
    public postAudioMessage: t.PostAudioMessageToFrontend,
    public getSessionBlobUri: (sha1: string) => t.Uri,
    public sessionIO: t.SessionIO,
  ) {}

  async start() {
    if (this.status === t.TrackPlayerStatus.Init) {
      assert(this.audioTrack.file.type === 'local', 'AudioTrackPlayer: only supports local files');
      await this.postAudioMessage({
        type: 'audio/load',
        id: this.audioTrack.id,
        src: this.getSessionBlobUri(this.audioTrack.file.sha1),
      });
    }
    await this.postAudioMessage({ type: 'audio/play', id: this.audioTrack.id });
  }

  async pause() {
    await this.postAudioMessage({ type: 'audio/pause', id: this.audioTrack.id });
  }

  async stop() {
    await this.postAudioMessage({ type: 'audio/stop', id: this.audioTrack.id });
  }

  async seek(clock: number) {
    await this.postAudioMessage({ type: 'audio/seek', clock, id: this.audioTrack.id });
  }

  dispose() {
    this.stop();
  }

  async handleAudioEvent(e: t.FrontendAudioEvent) {
    switch (e.type) {
      case 'loadstart': {
        console.log('loadstart');
        this.setStatusAndNotify(t.TrackPlayerStatus.Loading);
        return;
      }
      case 'durationchange': {
        console.log('durationchange');
        // this.setStatusAndNotify(t.TrackPlayerStatus.Loading);
        return;
      }
      case 'loadedmetadata': {
        console.log('loadedmetadata');
        // this.setStatusAndNotify(t.TrackPlayerStatus.Loading);
        return;
      }
      case 'loadeddata': {
        console.log('loadeddata');
        // this.setStatusAndNotify(t.TrackPlayerStatus.Loading);
        return;
      }
      case 'progress': {
        console.log('progress');
        // this.setStatusAndNotify(t.TrackPlayerStatus.Loading);
        return;
      }
      case 'canplay': {
        console.log('canplay');
        // this.setStatusAndNotify(t.TrackPlayerStatus.Paused);
        return;
      }
      case 'canplaythrough': {
        console.log('canplaythrough');
        // this.setStatusAndNotify(t.TrackPlayerStatus.Paused);
        return;
      }
      case 'suspend': {
        console.log('suspend');
        // this.setStatusAndNotify(t.TrackPlayerStatus.Stopped);
        return;
      }
      case 'abort': {
        console.log('abort');
        // this.setStatusAndNotify(t.TrackPlayerStatus.Stopped);
        return;
      }
      case 'emptied': {
        console.log('emptied');
        // this.setStatusAndNotify(t.TrackPlayerStatus.Stopped);
        return;
      }
      case 'stalled': {
        console.log('stalled');
        // this.setStatusAndNotify(t.TrackPlayerStatus.Stopped);
        return;
      }
      case 'playing': {
        console.log('playing');
        this.setStatusAndNotify(t.TrackPlayerStatus.Playing);
        return;
      }
      case 'waiting': {
        console.log('waiting');
        this.setStatusAndNotify(t.TrackPlayerStatus.Loading);
        return;
      }
      case 'play': {
        console.log('play');
        // this.setStatusAndNotify(t.TrackPlayerStatus.Playing);
        return;
      }
      case 'pause': {
        console.log('pause');
        this.setStatusAndNotify(t.TrackPlayerStatus.Paused);
        return;
      }
      case 'ended': {
        console.log('ended');
        this.setStatusAndNotify(t.TrackPlayerStatus.Stopped);
        // await this.afterPauseOrStop(t.PlayerStatus.Paused);
        return;
      }
      case 'seeking': {
        console.log('seeking');
        // this.setStatusAndNotify(t.TrackPlayerStatus.Loading)
        return;
      }
      case 'seeked': {
        console.log('seeked');
        // this.setStatusAndNotify(t.TrackPlayerStatus.Paused)
        return;
      }
      case 'timeupdate': {
        console.log('timeupdate', e.clock);
        this.clock = e.clock;
        this.onProgress?.(e.clock);
        return;
      }
      case 'volumechange': {
        console.log('volumechange', e.volume);
        return;
      }
      case 'error': {
        console.log('error');
        this.setStatusAndNotify(t.TrackPlayerStatus.Error);
        // await this.afterPauseOrStop(t.PlayerStatus.Stopped);
        // error will be caught and will call this.pause()
        throw new Error(e.error);
      }
      default: {
        lib.unreachable(e);
      }
    }
  }

  private setStatusAndNotify(status: t.TrackPlayerStatus) {
    this.status = status;
    this.onStatusChange?.(status);
  }
}
