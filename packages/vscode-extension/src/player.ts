import { SessionIO } from './session.js';
import { types as t, path, lib, SessionCtrl, AudioCtrl } from '@codecast/lib';
import VscEditorWorkspace from './vsc_editor_workspace.js';
import VscEditorPlayer from './vsc_editor_player.js';
import VscEditorRecorder from './vsc_editor_recorder.js';
import Db, { type WriteOptions } from './db.js';
import * as vscode from 'vscode';
import _ from 'lodash';
import assert from 'assert';

class Player {
  // get trackPlayerSummary(): t.TrackPlayerSummary {
  //   return lib.getTrackPlayerSummary(this.sessionCtrl);
  // }

  // get DEV_trackPlayerSummaries(): t.TrackPlayerSummary[] {
  //   return this.sessionCtrl.DEV_trackPlayerSummaries;
  // }

  get root(): t.AbsPath {
    return this.workspace.root;
  }

  get clock(): number {
    return this.sessionCtrl.clock;
  }

  get isPlaying(): boolean {
    return this.sessionCtrl.isRunning;
  }

  // private vscEditorEventStepper = new VscEditorEventStepper(this.workspace);

  constructor(
    public context: vscode.ExtensionContext,
    public db: Db,
    public sessionSummary: t.SessionSummary,
    public workspace: VscEditorWorkspace,
    private sessionCtrl: SessionCtrl,
    private audioCtrls: AudioCtrl[],
    private onUpdateFrontend: () => any,
  ) {
    sessionCtrl.onUpdateFrontend = this.sessionCtrlUpdateFrontendHandler.bind(this);
    sessionCtrl.onError = this.sessionCtrlErrorHandler.bind(this);
  }

  /**
   * root must be already resolved.
   * May return undefined if user decides not to overwrite root or create it.
   */
  static async populateSession(
    context: vscode.ExtensionContext,
    db: Db,
    setup: t.Setup,
    postAudioMessage: t.PostAudioMessageToFrontend,
    getSessionBlobWebviewUri: (sha1: string) => t.Uri,
    onUpdateFrontend: () => any,
    // audioSrc: string,
  ): Promise<Player | undefined> {
    assert(setup.root);
    const sessionIO = new SessionIO(db, setup.sessionSummary.id);
    const session = await db.readSession(setup.sessionSummary.id);
    const workspace = await VscEditorWorkspace.populateEditorTrack(setup.root, session, sessionIO);
    if (workspace) {
      const vscEditorPlayer = new VscEditorPlayer(context, workspace);
      const vscEditorRecorder = new VscEditorRecorder(context, workspace);
      const audioCtrls = session.audioTracks.map(
        audioTrack => new AudioCtrl(audioTrack, postAudioMessage, getSessionBlobWebviewUri, sessionIO),
      );

      const sessionCtrl = new SessionCtrl(setup.sessionSummary, audioCtrls, vscEditorPlayer, vscEditorRecorder);
      sessionCtrl.load();
      // sessionCtrl.seek(clock);

      return new Player(context, db, setup.sessionSummary, workspace, sessionCtrl, audioCtrls, onUpdateFrontend);
    }
  }

  async sessionCtrlUpdateFrontendHandler() {
    // update frontend
    this.onUpdateFrontend();

    // save history
    await this.saveHistoryClock({ ifDirtyForLong: true });
  }

  sessionCtrlErrorHandler(error: Error) {
    // TODO show error to user
    console.error(error);
  }

  play() {
    this.sessionCtrl.play();
    this.saveHistoryOpenClose().catch(console.error);
  }

  pause() {
    this.sessionCtrl.pause();
    this.saveHistoryClock().catch(console.error);
  }

  seek(clock: number) {
    this.sessionCtrl.seek(clock);
  }

  dispose() {
    // this.sessionCtrl.dispose();
  }

  handleFrontendAudioEvent(e: t.FrontendAudioEvent) {
    this.sessionCtrl.handleFrontendAudioEvent(e);
  }

  updateState(changes: t.PlayerUpdate) {
    if (changes.root !== undefined) throw new Error('Player: cannot modify root while playing');
    // if (changes.clock !== undefined) await this.enqueueUpdate(changes.clock);
  }

  private async saveHistoryClock(options?: WriteOptions) {
    this.db.mergeSessionHistory({
      id: this.sessionSummary.id,
      lastWatchedClock: this.clock,
      root: this.root,
    });
    await this.db.write(options);
  }

  private async saveHistoryOpenClose() {
    this.db.mergeSessionHistory({
      id: this.sessionSummary.id,
      lastWatchedTimestamp: new Date().toISOString(),
      root: this.root,
    });
    await this.db.write();
  }
}

export default Player;
