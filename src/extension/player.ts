import type { SessionCtrls } from './types.js';
import type Session from './session/session.js';
import type SessionRuntime from './session/session_runtime.js';
import _ from 'lodash';
import assert from 'assert';

type WriteOptions = { ifDirtyForLong: boolean };

class Player {
  constructor(public session: Session) {
    // assert(session.ctrls);
  }

  get ctrls(): SessionCtrls | undefined {
    return this.session.ctrls;
  }

  get sessionRuntime(): SessionRuntime | undefined {
    return this.ctrls?.sessionRuntime;
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
    await this.session.load();
    assert(this.ctrls);
    this.ctrls.sessionRuntime.onChangeOrProgress = this.sessionCtrlChangeOrProgressHandler.bind(this);
    this.ctrls.sessionRuntime.onError = this.sessionCtrlErrorHandler.bind(this);
  }

  async play() {
    assert(this.sessionRuntime);
    await this.sessionRuntime.play();
    this.saveHistoryOpenClose().catch(console.error);
  }

  pause() {
    assert(this.sessionRuntime);
    this.sessionRuntime.pause();
    this.saveHistoryClock().catch(console.error);
  }

  seek(clock: number) {
    assert(this.sessionRuntime);
    this.sessionRuntime.seek(clock);
  }

  dispose() {
    // this.sessionRuntime.dispose();
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
