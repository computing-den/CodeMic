import { SessionIO } from './session.js';
import { types as t, path, lib, editorTrack as et, AudioTrackPlayer, SessionTrackPlayer } from '@codecast/lib';
import VscEditorWorkspace from './vsc_editor_workspace.js';
import VscEditorTrackPlayer from './vsc_editor_track_player.js';
import Db, { type WriteOptions } from './db.js';
import * as vscode from 'vscode';
import _ from 'lodash';
import assert from 'assert';

class Player {
  get trackPlayerSummary(): t.TrackPlayerSummary {
    return lib.getTrackPlayerSummary(this.sessionTrackPlayer);
  }

  get DEV_trackPlayerSummaries(): t.TrackPlayerSummary[] {
    return this.sessionTrackPlayer.DEV_trackPlayerSummaries;
  }

  get root(): t.AbsPath {
    return this.vscEditorTrackPlayer.workspace.root;
  }

  // private vscEditorEventStepper = new VscEditorEventStepper(this.workspace);

  constructor(
    public context: vscode.ExtensionContext,
    public db: Db,
    public sessionSummary: t.SessionSummary,
    private sessionTrackPlayer: SessionTrackPlayer,
    private vscEditorTrackPlayer: VscEditorTrackPlayer,
    private audioTrackPlayer: AudioTrackPlayer,
    private onChange: () => any,
  ) {
    sessionTrackPlayer.onChange = this.changeHandler.bind(this);
  }

  /**
   * root must be already resolved.
   * May return undefined if user decides not to overwrite root or create it.
   */
  static async populateSession(
    context: vscode.ExtensionContext,
    db: Db,
    setup: t.PlayerSetup,
    postAudioMessage: t.PostAudioMessageToFrontend,
    getSessionBlobWebviewUri: (sha1: string) => t.Uri,
    onChange: () => any,
    // audioSrc: string,
  ): Promise<Player | undefined> {
    assert(setup.root);
    const sessionIO = new SessionIO(db, setup.sessionSummary.id);
    const session = await db.readSession(setup.sessionSummary.id);
    const workspace = await VscEditorWorkspace.populateEditorTrack(setup.root, session, sessionIO);
    if (workspace) {
      // postMessage({ type: 'backendMediaEvent', event: { type: 'load', src: audioSrc.toString() } });
      const vscEditorTrackPlayer = new VscEditorTrackPlayer(context, workspace);
      const audioTrackPlayer = new AudioTrackPlayer(
        session.audioTracks[0],
        postAudioMessage,
        getSessionBlobWebviewUri,
        sessionIO,
      );
      const sessionTrackPlayer = new SessionTrackPlayer();
      sessionTrackPlayer.addTrack(vscEditorTrackPlayer);
      sessionTrackPlayer.addTrack(audioTrackPlayer);
      sessionTrackPlayer.load();
      return new Player(
        context,
        db,
        setup.sessionSummary,
        sessionTrackPlayer,
        vscEditorTrackPlayer,
        audioTrackPlayer,
        onChange,
      );
    }
  }

  async changeHandler() {
    // update frontend
    this.onChange();

    // save history
    await this.saveHistoryClock({ ifDirtyForLong: true });
  }

  start() {
    this.sessionTrackPlayer.start();
    this.saveHistoryOpenClose().catch(console.error);
  }

  dispose() {
    this.sessionTrackPlayer.dispose();
  }

  pause() {
    this.sessionTrackPlayer.pause();
    this.afterPauseOrStop();
  }

  stop() {
    this.sessionTrackPlayer.stop();
    this.afterPauseOrStop();
  }

  seek(clock: number) {
    this.sessionTrackPlayer.seek(clock);
  }

  afterPauseOrStop() {
    this.saveHistoryClock().catch(console.error);
  }

  updateState(changes: t.PlayerUpdate) {
    if (changes.root !== undefined) throw new Error('Player: cannot modify root while playing');
    // if (changes.clock !== undefined) await this.enqueueUpdate(changes.clock);
  }

  handleFrontendAudioEvent(e: t.FrontendAudioEvent) {
    this.audioTrackPlayer.handleAudioEvent(e);
  }

  getClock(): number {
    return this.sessionTrackPlayer.clock;
  }

  private async saveHistoryClock(options?: WriteOptions) {
    this.db.mergeSessionHistory({
      id: this.sessionSummary.id,
      lastWatchedClock: this.getClock(),
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
