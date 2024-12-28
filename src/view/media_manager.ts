import * as t from '../lib/types.js';
import * as lib from '../lib/lib.js';
import assert from '../lib/assert.js';
import postMessage from './api.js';
import AudioManager from './audio_manager.js';
import VideoManager from './video_manager.js';
import _ from 'lodash';

export default class MediaManager {
  audioManager = new AudioManager();
  videoManager = new VideoManager();

  updateResources(session: t.SessionUIState) {
    this.audioManager.updateResources(session.audioTracks, session.dataPath);
    this.videoManager.updateResources(session.dataPath);
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
