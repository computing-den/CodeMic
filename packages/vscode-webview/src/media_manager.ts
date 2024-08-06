import { types as t, lib, assert } from '@codecast/lib';
import postMessage from './api.js';
import AudioManager from './audio_manager.js';
import VideoManager from './video_manager.js';
import _ from 'lodash';

export default class MediaManager {
  audioManager = new AudioManager();
  videoManager = new VideoManager();

  updateResources(webviewUris: t.WebviewUris, audioTracks: t.AudioTrack[] = [], videoTracks: t.VideoTrack[] = []) {
    this.audioManager.updateResources(webviewUris, audioTracks);
    this.videoManager.updateResources(webviewUris, videoTracks);
  }

  async prepare(videoElem: HTMLVideoElement) {
    await this.audioManager.prepare();
    this.videoManager.prepare(videoElem);
  }

  close() {
    this.audioManager.close();
    this.videoManager.close();
  }
}
