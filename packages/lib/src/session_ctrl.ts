import * as lib from './lib.js';
import assert from './assert.js';
import * as t from './types.js';
import _ from 'lodash';

export default class SessionCtrl {
  clock = 0;
  mode: t.SessionCtrlMode = {
    status: t.TrackCtrlStatus.Init,
    recordingEditor: false,
  };

  onUpdateFrontend?: () => any;
  onChange?: () => any;
  onError?: (error: Error) => any;

  get isRunning(): boolean {
    return this.mode.status === t.TrackCtrlStatus.Running;
  }

  private timeout: any;
  private timeoutTimestamp = 0;

  constructor(
    public sessionSummary: t.SessionSummary,
    public audioCtrls: t.AudioCtrl[],
    public editorPlayer: t.EditorPlayer,
    public editorRecorder: t.EditorRecorder,
  ) {
    for (const c of audioCtrls) this.initAudioCtrl(c);
    editorPlayer.onError = this.gotError.bind(this);
    editorRecorder.onChange = this.editorRecorderChangeHandler.bind(this);
    editorRecorder.onError = this.gotError.bind(this);
  }

  load() {
    // Load all audios so that they're ready to play when they come into range.
    for (const c of this.audioCtrls) c.load();
  }

  play() {
    assert(!this.isRunning);

    this.mode.recordingEditor = false;
    this.mode.status = t.TrackCtrlStatus.Running;

    if (this.isAlmostAtTheEnd()) {
      this.seek(0, { noUpdate: true });
    }

    // this.playInRangeAudios();
    this.editorPlayer.play();
    this.update();
  }

  record() {
    assert(!this.isRunning);

    assert(this.clock === this.sessionSummary.duration);

    this.mode.recordingEditor = true;
    this.mode.status = t.TrackCtrlStatus.Running;

    // this.playInRangeAudios();
    this.editorRecorder.record();

    this.update();
  }

  pause() {
    this.mode.status = t.TrackCtrlStatus.Paused;
    this.pauseAudios();
    this.pauseEditor();
  }

  /**
   * If in recorder mode, it will pause and switch to player mode.
   */
  seek(clock: number, options?: { noUpdate: boolean }) {
    const noUpdate = options?.noUpdate ?? false;

    if (this.mode.recordingEditor) {
      this.pause();
      this.mode.recordingEditor = false;
    }

    this.clock = clock;
    this.seekInRangeAudios();
    this.seekEditor();

    if (!noUpdate) this.update(); // Will clear previous timeouts.
  }

  insertAudioAndLoad(c: t.AudioCtrl) {
    this.sessionSummary.duration = Math.max(this.sessionSummary.duration, c.track.clockRange.end);
    this.audioCtrls.push(c);
    this.initAudioCtrl(c);
    c.load();
  }

  handleFrontendAudioEvent(e: t.FrontendAudioEvent) {
    const p = this.audioCtrls.find(a => a.track.id === e.id);
    if (p) {
      p.handleAudioEvent(e);
    } else {
      console.error(`handleFrontendAudioEvent audio track player with id ${e.id} not found`);
    }
  }

  private initAudioCtrl(c: t.AudioCtrl) {
    c.onError = this.gotError.bind(this);
  }

  private seekEditor() {
    this.editorRecorder.setClock(this.clock);

    if (this.mode.recordingEditor) {
      this.editorPlayer.setClock(this.clock);
    } else {
      this.editorPlayer.seek(this.clock);
    }
  }

  private pauseEditor() {
    if (this.mode.recordingEditor) {
      this.editorRecorder.pause();
    } else {
      this.editorPlayer.pause();
    }
  }

  private seekInRangeAudios() {
    for (const c of this.audioCtrls) {
      if (this.isAudioInRange(c)) this.seekAudio(c);
    }
  }

  private seekInRangeAudiosThatAreNotRunning() {
    for (const c of this.audioCtrls) {
      if (!c.isRunning && this.isAudioInRange(c)) this.seekAudio(c);
    }
  }

  private seekAudio(c: t.AudioCtrl) {
    c.seek(this.globalClockToAudioLocal(c));
  }

  private playInRangeAudios() {
    for (const c of this.audioCtrls) {
      if (!c.isRunning && this.isAudioInRange(c)) c.play();
    }
  }

  private pauseAudios() {
    for (const c of this.audioCtrls) {
      if (c.isRunning) c.pause();
    }
  }

  private pauseOutOfRangeAudios() {
    for (const c of this.audioCtrls) {
      if (c.isRunning && !this.isAudioInRange(c)) c.pause();
    }
  }

  private clearTimeout() {
    clearTimeout(this.timeout);
    this.timeout = 0;
  }

  private isAlmostAtTheEnd() {
    return this.clock > this.sessionSummary.duration - 1;
  }

  private isAudioInRange(c: t.AudioCtrl): boolean {
    return lib.isClockInRange(this.clock, c.track.clockRange);
  }

  private globalClockToAudioLocal(c: t.AudioCtrl): number {
    return lib.clockToLocal(this.clock, c.track.clockRange);
  }

  private editorRecorderChangeHandler() {
    this.onChange?.();
    this.onUpdateFrontend?.();
  }

  private update() {
    this.clearTimeout();
    this.timeoutTimestamp = performance.now();
    this.updateStep();
  }

  private updateStep = () => {
    const timeAtUpdate = performance.now();
    this.clock += (timeAtUpdate - this.timeoutTimestamp) / 1000;

    if (this.mode.recordingEditor) {
      console.log(
        `SessionCtrl duration ${this.sessionSummary.duration} -> ${Math.max(this.sessionSummary.duration, this.clock)}`,
      );
      this.sessionSummary.duration = Math.max(this.sessionSummary.duration, this.clock);
    } else {
      this.clock = Math.min(this.sessionSummary.duration, this.clock);
    }

    // TODO should we await this?
    this.seekEditor();
    this.seekInRangeAudiosThatAreNotRunning();
    if (this.isRunning) this.playInRangeAudios();
    this.pauseOutOfRangeAudios();

    if (!this.mode.recordingEditor && this.clock === this.sessionSummary.duration) {
      this.pause();
    }

    this.onUpdateFrontend?.();

    if (this.isRunning) {
      this.timeoutTimestamp = timeAtUpdate;
      this.timeout = setTimeout(this.updateStep, 100);
    }
  };

  private gotError(error: Error) {
    this.pause();
    this.mode.status = t.TrackCtrlStatus.Error;
    this.onError?.(error);
  }
}
