import { types as t, path, lib, editorTrack as et } from '@codecast/lib';
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
    private postMessage: t.PostMessageToFrontend,
    private vscEditorTrackPlayer: VscEditorTrackPlayer,
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
    postMessage: t.PostMessageToFrontend,
    onChange: () => any,
    // audioSrc: string,
  ): Promise<Player | undefined> {
    assert(setup.root);
    const workspace = await VscEditorWorkspace.populateEditorTrack(db, setup.root, setup.sessionSummary);
    if (workspace) {
      // postMessage({ type: 'backendMediaEvent', event: { type: 'load', src: audioSrc.toString() } });
      const vscEditorTrackPlayer = new VscEditorTrackPlayer(context, workspace);
      return new Player(context, db, setup.sessionSummary, postMessage, vscEditorTrackPlayer, onChange);
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
    await this.saveHistoryOpenClose();
  }

  dispose() {
    this.vscEditorTrackPlayer.dispose();
  }

  async pause() {
    await this.vscEditorTrackPlayer.pause();
    await this.afterPauseOrStop();
  }

  async stop() {
    await this.vscEditorTrackPlayer.pause();
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
  }

  async handleFrontendMediaEvent(e: t.FrontendMediaEvent) {
    // try {
    //   switch (e.type) {
    //     case 'loadstart': {
    //       console.log('loadstart');
    //       return;
    //     }
    //     case 'durationchange': {
    //       console.log('durationchange');
    //       return;
    //     }
    //     case 'loadedmetadata': {
    //       console.log('loadedmetadata');
    //       return;
    //     }
    //     case 'loadeddata': {
    //       console.log('loadeddata');
    //       return;
    //     }
    //     case 'progress': {
    //       console.log('progress');
    //       return;
    //     }
    //     case 'canplay': {
    //       console.log('canplay');
    //       return;
    //     }
    //     case 'canplaythrough': {
    //       console.log('canplaythrough');
    //       return;
    //     }
    //     case 'suspend': {
    //       console.log('suspend');
    //       return;
    //     }
    //     case 'abort': {
    //       console.log('abort');
    //       await this.afterPauseOrStop(t.PlayerStatus.Stopped);
    //       return;
    //     }
    //     case 'emptied': {
    //       console.log('emptied');
    //       return;
    //     }
    //     case 'stalled': {
    //       console.log('stalled');
    //       return;
    //     }
    //     case 'playing': {
    //       console.log('playing');
    //       return;
    //     }
    //     case 'waiting': {
    //       console.log('waiting');
    //       return;
    //     }
    //     case 'play': {
    //       console.log('play');
    //       return;
    //     }
    //     case 'pause': {
    //       console.log('pause');
    //       return;
    //     }
    //     case 'ended': {
    //       console.log('ended');
    //       await this.afterPauseOrStop(t.PlayerStatus.Paused);
    //       return;
    //     }
    //     case 'seeking': {
    //       console.log('seeking');
    //       return;
    //     }
    //     case 'seeked': {
    //       console.log('seeked');
    //       return;
    //     }
    //     case 'timeupdate': {
    //       console.log('timeupdate', e.clock);
    //       await this.enqueueUpdate(e.clock);
    //       return;
    //     }
    //     case 'volumechange': {
    //       console.log('volumechange', e.volume);
    //       return;
    //     }
    //     case 'error': {
    //       console.log('error');
    //       // await this.afterPauseOrStop(t.PlayerStatus.Stopped);
    //       // error will be caught and will call this.pause()
    //       throw new Error(e.error);
    //     }
    //     default: {
    //       lib.unreachable(e);
    //     }
    //   }
    // } catch (error) {
    //   console.error(error);
    //   vscode.window.showErrorMessage('ERROR', { detail: (error as Error).message });
    //   await this.stop();
    // }
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
