import { SessionIO } from './session.js';
import { types as t, path, lib, AudioTrackPlayer, SessionTrackPlayer } from '@codecast/lib';
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

  get clock(): number {
    return this.sessionTrackPlayer.clock;
  }

  // private vscEditorEventStepper = new VscEditorEventStepper(this.workspace);

  constructor(
    public context: vscode.ExtensionContext,
    public db: Db,
    public sessionSummary: t.SessionSummary,
    private sessionTrackPlayer: SessionTrackPlayer,
    private vscEditorTrackPlayer: VscEditorTrackPlayer,
    private audioTrackPlayers: { [key: string]: AudioTrackPlayer },
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
      const sessionTrackPlayer = new SessionTrackPlayer();
      const vscEditorTrackPlayer = new VscEditorTrackPlayer(context, workspace);
      const audioTrackPlayers: { [key: string]: AudioTrackPlayer } = {};
      for (const audioTrack of session.audioTracks) {
        const p = new AudioTrackPlayer(audioTrack, postAudioMessage, getSessionBlobWebviewUri, sessionIO);
        audioTrackPlayers[audioTrack.id] = p;
        sessionTrackPlayer.addTrack(p);
      }
      sessionTrackPlayer.addTrack(vscEditorTrackPlayer);
      sessionTrackPlayer.load();
      return new Player(
        context,
        db,
        setup.sessionSummary,
        sessionTrackPlayer,
        vscEditorTrackPlayer,
        audioTrackPlayers,
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

  dispose() {
    this.sessionTrackPlayer.dispose();
  }

  afterPauseOrStop() {
    this.saveHistoryClock().catch(console.error);
  }

  handleFrontendAudioEvent(e: t.FrontendAudioEvent) {
    const p = this.audioTrackPlayers[e.id];
    if (p) {
      p.handleAudioEvent(e);
    } else {
      console.error(`handleFrontendAudioEvent audio track player with id ${e.id} not found`);
    }
  }

  updateState(changes: t.PlayerUpdate) {
    if (changes.root !== undefined) throw new Error('Player: cannot modify root while playing');
    // if (changes.clock !== undefined) await this.enqueueUpdate(changes.clock);
  }

  private async saveHistoryClock(options?: WriteOptions) {
    this.db.mergeSessionHistory({
      id: this.sessionSummary.id,
      lastWatchedClock: this.clock,
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
