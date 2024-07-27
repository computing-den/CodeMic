import type { SessionCtrls } from './types.js';
import type Session from './session/session.js';
import type SessionTracksCtrl from './session/session_tracks_ctrl.js';
import _ from 'lodash';
import assert from 'assert';

type WriteOptions = { ifDirtyForLong: boolean };

class Player {
  constructor(public session: Session) {
    // assert(session.ctrls);
  }

  get ctrls(): SessionCtrls {
    return this.session.ctrls!;
  }

  get sessionTracksCtrl(): SessionTracksCtrl {
    return this.ctrls.sessionTracksCtrl;
  }

  async sessionCtrlChangeOrProgressHandler() {
    this.session.context.updateFrontend?.();
    await this.saveHistoryClock({ ifDirtyForLong: true });
  }

  sessionCtrlErrorHandler(error: Error) {
    // TODO show error to user
    console.error(error);
  }

  async load() {
    // TODO continue from last position left off
    await this.session.readBody({ download: true });
    await this.session.load();
    this.ctrls.sessionTracksCtrl.onChangeOrProgress = this.sessionCtrlChangeOrProgressHandler.bind(this);
    this.ctrls.sessionTracksCtrl.onError = this.sessionCtrlErrorHandler.bind(this);
  }

  play() {
    this.sessionTracksCtrl.play();
    this.saveHistoryOpenClose().catch(console.error);
  }

  pause() {
    this.sessionTracksCtrl.pause();
    this.saveHistoryClock().catch(console.error);
  }

  seek(clock: number) {
    this.sessionTracksCtrl.seek(clock);
  }

  dispose() {
    // this.sessionTracksCtrl.dispose();
  }

  private async saveHistoryClock(options?: WriteOptions) {
    // TODO support options.ifDirtyForLong
    await this.session.writeHistory(history => ({
      ...history,
      lastWatchedClock: this.session.clock!,
      workspace: this.session.workspace,
    }));
  }

  private async saveHistoryOpenClose() {
    await this.session.writeHistory(history => ({
      ...history,
      lastWatchedTimestamp: new Date().toISOString(),
      workspace: this.session.workspace,
    }));
  }
}

export default Player;
