import { types as t, path } from '@codecast/lib';
import getMp3Duration from './get_mp3_duration.js';
import * as misc from './misc.js';
import type { SessionCtrls } from './types.js';
import type Session from './session/session.js';
import type SessionTracksCtrl from './session/session_tracks_ctrl.js';
import _ from 'lodash';
import assert from 'assert';
import fs from 'fs';
import { v4 as uuid } from 'uuid';

class Recorder {
  constructor(public session: Session) {}

  get sessionTracksCtrl(): SessionTracksCtrl {
    return this.session.ctrls!.sessionTracksCtrl;
  }

  dirty: boolean = false;

  // private lastSavedClock: number;

  /**
   * root must be already resolved.
   */
  async scan() {
    await this.session.scan();
    await this.save();
    this.initSessionTracksCtrlsHandlers();
  }

  async load() {
    // let clock = setup.sessionSummary.duration;
    // if (setup.fork) {
    //   clock = setup.fork.clock;
    //   assert(setup.baseSessionSummary);
    //   await db.copySessionDir(setup.baseSessionSummary, setup.sessionSummary);
    // }

    // TODO pass seekclock and cutclock
    await this.session.load();
    await this.save();
    this.initSessionTracksCtrlsHandlers();
  }

  initSessionTracksCtrlsHandlers() {
    assert(this.session.ctrls);
    this.sessionTracksCtrl.onChangeOrProgress = this.sessionCtrlChangeOrProgressHandler.bind(this);
    this.sessionTracksCtrl.onChange = this.sessionCtrlChangeHandler.bind(this);
    this.sessionTracksCtrl.onError = this.sessionCtrlErrorHandler.bind(this);
  }

  sessionCtrlChangeOrProgressHandler() {
    this.session.context.updateFrontend?.();
  }

  sessionCtrlChangeHandler() {
    this.dirty = true;
  }

  sessionCtrlErrorHandler(error: Error) {
    // TODO show error to user
    console.error(error);
  }

  record() {
    this.sessionTracksCtrl.record();
    this.saveHistoryOpenClose().catch(console.error);
  }

  play() {
    this.sessionTracksCtrl.play();
    this.saveHistoryOpenClose().catch(console.error);
  }

  pause() {
    this.sessionTracksCtrl.pause();
  }

  seek(clock: number) {
    this.sessionTracksCtrl.seek(clock);
  }

  dispose() {
    // this.sessionTracksCtrl.dispose();
  }

  isSessionEmpty(): boolean {
    return this.session.body?.editorTrack.events.length === 0 && this.session.ctrls?.audioTrackCtrls.length === 0;
  }

  updateState(changes: t.RecorderUpdate) {
    if (changes.title !== undefined) this.session.summary.title = changes.title;
    if (changes.description !== undefined) this.session.summary.description = changes.description;
    // if (changes.clock !== undefined) this.sessionSummary.duration = this.sessionTracksCtrl.clock = changes.clock;
    if (changes.workspace !== undefined)
      throw new Error('Recorder.updateState cannot change workspace after initialization');

    this.dirty = true;
  }

  /**
   * May be called without pause().
   */
  async save() {
    this.session.summary.modificationTimestamp = new Date().toISOString();
    await this.session.write();
    await this.saveHistoryOpenClose();
    this.dirty = false;
  }

  async insertAudio(uri: t.Uri, clock: number) {
    const absPath = path.getFileUriPath(uri);
    const data = await fs.promises.readFile(absPath);
    const duration = getMp3Duration(data);
    const sha1 = await misc.computeSHA1(data);
    await this.session.copyToBlob(absPath, sha1);
    const audioTrack: t.AudioTrack = {
      id: uuid(),
      clockRange: { start: clock, end: clock + duration },
      file: { type: 'local', sha1: sha1 },
      title: path.basename(absPath, { omitExt: true }),
    };
    this.sessionTracksCtrl.insertAudioAndLoad(audioTrack);
  }

  async deleteAudio(id: string) {
    this.sessionTracksCtrl.deleteAudio(id);
  }

  private async saveHistoryOpenClose() {
    await this.session.writeHistory(history => ({
      ...history,
      lastRecordedTimestamp: new Date().toISOString(),
      workspace: this.session.workspace,
    }));
  }
}

export default Recorder;
