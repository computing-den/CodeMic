import { types as t, path, lib, assert } from '@codecast/lib';
import type { Session } from './session.js';
import type { SessionCtrls } from '../types.js';
import AudioTrackCtrl from './audio_track_ctrl.js';
import _ from 'lodash';

export enum SessionTracksCtrlStatus {
  Init,
  Error,
  Running,
  Paused,
}

export type SessionTracksCtrlMode = {
  status: SessionTracksCtrlStatus;
  recordingEditor: boolean;
};

export default class SessionTracksCtrl {
  clock = 0;
  mode: SessionTracksCtrlMode = {
    status: SessionTracksCtrlStatus.Init,
    recordingEditor: false,
  };

  onChangeOrProgress?: () => any;
  onChange?: () => any;
  onError?: (error: Error) => any;

  private session: Session;
  private timeout: any;
  private timeoutTimestamp = 0;

  get running(): boolean {
    return this.mode.status === SessionTracksCtrlStatus.Running;
  }

  get ctrls(): SessionCtrls {
    return this.session.ctrls!;
  }

  constructor(session: Session) {
    this.session = session;
  }

  init() {
    for (const c of this.ctrls.audioTrackCtrls) this.initAudioCtrl(c);
    this.ctrls.combinedEditorTrackPlayer.onError = this.gotError.bind(this);
    this.ctrls.combinedEditorTrackRecorder.onChange = this.combinedEditorTrackRecorderChangeHandler.bind(this);
    this.ctrls.combinedEditorTrackRecorder.onError = this.gotError.bind(this);
  }

  load() {
    // Load all audios so that they're ready to play when they come into range.
    for (const c of this.ctrls.audioTrackCtrls) c.load();
  }

  play() {
    assert(!this.running);

    this.mode.recordingEditor = false;
    this.mode.status = SessionTracksCtrlStatus.Running;

    if (this.isAlmostAtTheEnd()) {
      this.seek(0, { noUpdate: true });
    }

    // this.playInRangeAudios();
    this.ctrls.combinedEditorTrackPlayer.play();
    this.update();
  }

  record() {
    assert(!this.running);

    assert(this.clock === this.session.summary.duration);

    this.mode.recordingEditor = true;
    this.mode.status = SessionTracksCtrlStatus.Running;

    // this.playInRangeAudios();
    this.ctrls.combinedEditorTrackRecorder.record();

    this.update();
  }

  pause() {
    this.mode.status = SessionTracksCtrlStatus.Paused;
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

  insertAudioAndLoad(audioTrack: t.AudioTrack) {
    const audioTrackCtrl = new AudioTrackCtrl(this.session, audioTrack);
    this.session.summary.duration = Math.max(this.session.summary.duration, audioTrack.clockRange.end);
    this.session.body!.audioTracks.push(audioTrack);
    this.ctrls.audioTrackCtrls.push(audioTrackCtrl);
    this.initAudioCtrl(audioTrackCtrl);
    this.onChange?.();
  }

  deleteAudio(id: string) {
    const i = this.ctrls.audioTrackCtrls.findIndex(c => c.audioTrack.id === id);
    if (i === -1) {
      console.error(`SessionTracksCtrl deleteAudio did not find audio track with id ${id}`);
      return;
    }

    const j = this.session.body!.audioTracks.findIndex(t => t.id === id);
    if (j !== -1) {
      this.session.body!.audioTracks.splice(j, 1);
    }

    this.ctrls.audioTrackCtrls[i].pause();
    this.ctrls.audioTrackCtrls.splice(i, 1);
    this.onChange?.();
  }

  handleFrontendAudioEvent(e: t.FrontendAudioEvent) {
    const audioCtrl = this.ctrls.audioTrackCtrls.find(a => a.audioTrack.id === e.id);
    if (audioCtrl) {
      audioCtrl.handleAudioEvent(e);
    } else {
      console.error(`handleFrontendAudioEvent audio track player with id ${e.id} not found`);
    }
  }

  private initAudioCtrl(c: AudioTrackCtrl) {
    c.onError = this.gotError.bind(this);
  }

  private seekEditor() {
    this.ctrls.combinedEditorTrackRecorder.setClock(this.clock);

    if (this.mode.recordingEditor) {
      this.ctrls.combinedEditorTrackPlayer.setClock(this.clock);
    } else {
      this.ctrls.combinedEditorTrackPlayer.seek(this.clock);
    }
  }

  private pauseEditor() {
    if (this.mode.recordingEditor) {
      this.ctrls.combinedEditorTrackRecorder.pause();
    } else {
      this.ctrls.combinedEditorTrackPlayer.pause();
    }
  }

  private seekInRangeAudios() {
    for (const c of this.ctrls.audioTrackCtrls) {
      if (this.isAudioInRange(c)) this.seekAudio(c);
    }
  }

  private seekInRangeAudiosThatAreNotRunning() {
    for (const c of this.ctrls.audioTrackCtrls) {
      if (!c.running && this.isAudioInRange(c)) this.seekAudio(c);
    }
  }

  private seekAudio(c: AudioTrackCtrl) {
    c.seek(this.globalClockToAudioLocal(c));
  }

  private playInRangeAudios() {
    for (const c of this.ctrls.audioTrackCtrls) {
      if (!c.running && this.isAudioInRange(c)) c.play();
    }
  }

  private pauseAudios() {
    for (const c of this.ctrls.audioTrackCtrls) {
      if (c.running) c.pause();
    }
  }

  private pauseOutOfRangeAudios() {
    for (const c of this.ctrls.audioTrackCtrls) {
      if (c.running && !this.isAudioInRange(c)) c.pause();
    }
  }

  private clearTimeout() {
    clearTimeout(this.timeout);
    this.timeout = 0;
  }

  private isAlmostAtTheEnd() {
    return this.clock > this.session.summary.duration - 1;
  }

  private isAudioInRange(c: AudioTrackCtrl): boolean {
    return lib.isClockInRange(this.clock, c.audioTrack.clockRange);
  }

  private globalClockToAudioLocal(c: AudioTrackCtrl): number {
    return lib.clockToLocal(this.clock, c.audioTrack.clockRange);
  }

  private combinedEditorTrackRecorderChangeHandler() {
    this.onChange?.();
    this.onChangeOrProgress?.();
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
        `SessionTracksCtrl duration ${this.session.summary.duration} -> ${Math.max(
          this.session.summary.duration,
          this.clock,
        )}`,
      );
      this.session.summary.duration = Math.max(this.session.summary.duration, this.clock);
    } else {
      this.clock = Math.min(this.session.summary.duration, this.clock);
    }

    this.seekEditor();
    this.seekInRangeAudiosThatAreNotRunning();
    if (this.running) this.playInRangeAudios();
    this.pauseOutOfRangeAudios();

    if (!this.mode.recordingEditor && this.clock === this.session.summary.duration) {
      this.pause();
    }

    this.onChangeOrProgress?.();

    if (this.running) {
      this.timeoutTimestamp = timeAtUpdate;
      this.timeout = setTimeout(this.updateStep, 100);
    }
  };

  private gotError(error: Error) {
    this.pause();
    this.mode.status = SessionTracksCtrlStatus.Error;
    this.onError?.(error);
  }
}
