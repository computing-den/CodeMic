// import type Session from './session/session.js';
// import type SessionRuntime from './session/session_runtime.js';
// import _ from 'lodash';
// import assert from 'assert';

// type WriteOptions = { ifDirtyForLong: boolean };

// class Player {
//   constructor(public session: Session) {
//     // assert(session.runtime);
//   }

//   get runtime(): SessionRuntime | undefined {
//     return this.session.runtime;
//   }

//   async runtimeChangeOrProgressHandler() {
//     this.session.context.updateFrontend?.();
//     await this.saveHistoryClock({ ifDirtyForLong: true });
//   }

//   runtimeErrorHandler(error: Error) {
//     // TODO show error to user
//     console.error(error);
//   }

//   async load() {
//     // TODO continue from last position left off
//     await this.session.load();
//     assert(this.runtime);
//     this.runtime.onChangeOrProgress = this.runtimeChangeOrProgressHandler.bind(this);
//     this.runtime.onError = this.runtimeErrorHandler.bind(this);
//   }

//   async play() {
//     assert(this.runtime);
//     await this.runtime.play();
//     this.saveHistoryOpenClose().catch(console.error);
//   }

//   pause() {
//     assert(this.runtime);
//     this.runtime.pause();
//     this.saveHistoryClock().catch(console.error);
//   }

//   seek(clock: number) {
//     assert(this.runtime);
//     this.runtime.seek(clock);
//   }

//   dispose() {
//     // this.runtime.dispose();
//   }

//   private async saveHistoryClock(options?: WriteOptions) {
//     // TODO support options.ifDirtyForLong
//     await this.session.writeHistory(history => ({
//       ...history,
//       lastWatchedClock: this.session.clock!,
//       workspace: this.session.workspace,
//     }));
//   }

//   private async saveHistoryOpenClose() {
//     await this.session.writeHistory(history => ({
//       ...history,
//       lastWatchedTimestamp: new Date().toISOString(),
//       workspace: this.session.workspace,
//     }));
//   }
// }

// export default Player;
