import * as lib from './lib.js';
import assert from './assert.js';
import * as t from './types.js';
import _ from 'lodash';

export default class SessionCtrl {
  name = 'Session';
  clock = 0;
  mode: t.SessionCtrlMode = {
    status: t.TrackCtrlStatus.Init,
    recordingEditor: false,
  };

  onUpdateFrontend?: () => any;
  onChange?: () => any;

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
    editorRecorder.onChange = this.editorRecorderChangeHandler.bind(this);
  }

  load() {
    // Load all audios so that they're ready to play when they come into range.
    for (const c of this.audioCtrls) c.load();
  }

  play() {
    assert(!this.isRunning);

    this.playInRangeAudios();
    this.editorPlayer.play();

    this.mode.recordingEditor = false;
    this.mode.status = t.TrackCtrlStatus.Running;

    this.startUpdating();
  }

  record() {
    assert(!this.isRunning);

    this.playInRangeAudios();
    this.editorRecorder.record();

    this.mode.recordingEditor = true;
    this.mode.status = t.TrackCtrlStatus.Running;
  }

  pause() {
    this.pauseAudios();
    this.pauseEditor();

    this.mode.status = t.TrackCtrlStatus.Paused;
  }

  seek(clock: number) {
    this.clock = clock;

    this.seekInRangeAudios();
    this.pauseOutOfRangeAudios();
    this.seekEditor();

    if (this.isRunning) {
      this.playInRangeAudios();
      this.startUpdating(); // Will clear previous timeouts.
    }
  }

  private seekEditor() {
    this.editorRecorder.setClock(this.clock);

    if (!this.mode.recordingEditor) {
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

  private seekAndPlayNewInRangeAudios() {
    for (const c of this.audioCtrls) {
      if (!c.isRunning && this.isAudioInRange(c)) {
        this.seekAudio(c);
        c.play();
      }
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

  private startUpdating() {
    this.clearTimeout();
    this.timeoutTimestamp = performance.now();
    this.update();
  }

  private update = () => {
    const timeAtUpdate = performance.now();
    this.clock += timeAtUpdate - this.timeoutTimestamp;

    if (this.mode.recordingEditor) {
      this.sessionSummary.duration = Math.max(this.sessionSummary.duration, this.clock);
    } else {
      this.clock = Math.min(this.sessionSummary.duration, this.clock);
    }

    // TODO should we await this?
    this.seekEditor();
    this.seekAndPlayNewInRangeAudios();
    this.pauseOutOfRangeAudios();

    if (!this.mode.recordingEditor && this.clock === this.sessionSummary.duration) {
      this.pause();
    }

    this.onUpdateFrontend?.();

    if (this.isRunning) {
      this.timeoutTimestamp = timeAtUpdate;
      this.timeout = setTimeout(this.update, 100);
    }
  };
}
