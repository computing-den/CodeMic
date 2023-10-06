import { SessionIO } from './session.js';
import { types as t, path, lib, editorTrack as et, AudioTrackPlayer } from '@codecast/lib';
import VscEditorWorkspace from './vsc_editor_workspace.js';
import VscEditorTrackPlayer from './vsc_editor_track_player.js';
import Db, { type WriteOptions } from './db.js';
import * as vscode from 'vscode';
import _ from 'lodash';
import assert from 'assert';

class Player {
  status: t.PlayerStatus = t.PlayerStatus.Initialized;

  get root(): t.AbsPath {
    return this.vscEditorTrackPlayer.workspace.root;
  }

  // private vscEditorEventStepper = new VscEditorEventStepper(this.workspace);

  constructor(
    public context: vscode.ExtensionContext,
    public db: Db,
    public sessionSummary: t.SessionSummary,
    private vscEditorTrackPlayer: VscEditorTrackPlayer,
    private audioTrackPlayer: AudioTrackPlayer,
    private onChange: () => any,
  ) {
    vscEditorTrackPlayer.onProgress = this.vscEditorTrackProgressHandler.bind(this);
    vscEditorTrackPlayer.onStatusChange = this.vscEditorTrackStatusChangeHandler.bind(this);
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
    getSessionBlobUri: (sha1: string) => t.Uri,
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
        getSessionBlobUri,
        sessionIO,
      );
      return new Player(context, db, setup.sessionSummary, vscEditorTrackPlayer, audioTrackPlayer, onChange);
    }
  }

  async vscEditorTrackProgressHandler(clock: number) {
    // console.log(`vscEditorTrackProgressHandler: ${clock}`);

    // update frontend
    this.onChange();

    // save history
    await this.saveHistoryClock({ ifDirtyForLong: true });
  }

  async vscEditorTrackStatusChangeHandler(status: t.TrackPlayerStatus) {
    switch (status) {
      case t.TrackPlayerStatus.Init:
        this.status = t.PlayerStatus.Initialized;
        break;
      case t.TrackPlayerStatus.Error:
        this.status = t.PlayerStatus.Error;
        break;
      case t.TrackPlayerStatus.Loading:
        this.status = t.PlayerStatus.Loading;
        break;
      case t.TrackPlayerStatus.Paused:
        this.status = t.PlayerStatus.Paused;
        break;
      case t.TrackPlayerStatus.Stopped:
        this.status = t.PlayerStatus.Stopped;
        break;
      case t.TrackPlayerStatus.Playing:
        this.status = t.PlayerStatus.Playing;
        break;
      default:
        lib.unreachable(status);
    }
  }

  async start() {
    await this.vscEditorTrackPlayer.start();
    await this.audioTrackPlayer.start();
    await this.saveHistoryOpenClose();
  }

  dispose() {
    this.vscEditorTrackPlayer.dispose();
  }

  async pause() {
    await this.vscEditorTrackPlayer.pause();
    await this.audioTrackPlayer.pause();
    await this.afterPauseOrStop();
  }

  async stop() {
    await this.vscEditorTrackPlayer.pause();
    await this.audioTrackPlayer.stop();
    await this.afterPauseOrStop();
  }

  async afterPauseOrStop() {
    await this.saveHistoryClock();
  }

  async updateState(changes: t.PlayerUpdate) {
    try {
      if (changes.root !== undefined) throw new Error('Player: cannot modify root while playing');
      // if (changes.clock !== undefined) await this.enqueueUpdate(changes.clock);
    } catch (error) {
      console.error(error);
      vscode.window.showErrorMessage('ERROR', { detail: (error as Error).message });
      await this.pause();
    }
  }

  async seek(clock: number) {
    await this.vscEditorTrackPlayer.seek(clock);
    await this.audioTrackPlayer.seek(clock);
  }

  async handleFrontendAudioEvent(e: t.FrontendAudioEvent) {
    try {
      await this.audioTrackPlayer.handleAudioEvent(e);
    } catch (error) {
      console.error(error);
      vscode.window.showErrorMessage('ERROR', { detail: (error as Error).message });
      await this.stop();
    }
  }

  getClock(): number {
    return this.vscEditorTrackPlayer.clock;
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
