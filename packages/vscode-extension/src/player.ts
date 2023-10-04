import { types as t, path, lib, ir } from '@codecast/lib';
import VscEditorWorkspace from './vsc_editor_workspace.js';
import VscEditorEventStepper from './vsc_editor_event_stepper.js';
import Db, { type WriteOptions } from './db.js';
import * as vscode from 'vscode';
import _ from 'lodash';
import assert from 'assert';
import fs from 'fs';

class Player {
  status: t.PlayerStatus = t.PlayerStatus.Ready;

  private disposables: vscode.Disposable[] = [];
  private enqueueUpdate = lib.taskQueue(this.updateImmediately.bind(this), 1);
  private vscEditorEventStepper = new VscEditorEventStepper(this.workspace);

  constructor(
    public context: vscode.ExtensionContext,
    public db: Db,
    public workspace: VscEditorWorkspace,
    private postMessage: t.PostMessageToFrontend,
    private audioSrc: string,
  ) {}

  /**
   * root must be already resolved.
   * May return undefined if user decides not to overwrite root or create it.
   */
  static async populateSession(
    context: vscode.ExtensionContext,
    db: Db,
    setup: t.PlayerSetup,
    postMessage: t.PostMessageToFrontend,
    audioSrc: string,
  ): Promise<Player | undefined> {
    assert(setup.root);
    const workspace = await VscEditorWorkspace.populateSession(db, setup.root, setup.sessionSummary);
    postMessage({ type: 'backendMediaEvent', event: { type: 'load', src: audioSrc.toString() } });
    return workspace && new Player(context, db, workspace, postMessage, audioSrc);
  }

  async start() {
    assert(
      this.status === t.PlayerStatus.Ready ||
        this.status === t.PlayerStatus.Paused ||
        this.status === t.PlayerStatus.Stopped,
    );
    this.status = t.PlayerStatus.Playing;

    // ignore user input
    {
      const disposable = vscode.commands.registerCommand('type', (e: { text: string }) => {
        const uri = vscode.window.activeTextEditor?.document.uri;
        if (!uri || !this.workspace.shouldRecordVscUri(uri)) {
          // approve the default type command
          vscode.commands.executeCommand('default:type', e);
        }
      });
      this.disposables.push(disposable);
    }

    // register disposables
    this.context.subscriptions.push(...this.disposables);

    await this.postMessage({ type: 'backendMediaEvent', event: { type: 'play' } });

    await this.saveHistoryOpenClose();
  }

  dispose() {
    this.enqueueUpdate.clear();
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
  }

  async pause() {
    await this.postMessage({ type: 'backendMediaEvent', event: { type: 'pause' } });
    await this.afterPauseOrStop(t.PlayerStatus.Paused);
  }

  async stop() {
    await this.postMessage({ type: 'backendMediaEvent', event: { type: 'pause' } });
    await this.afterPauseOrStop(t.PlayerStatus.Stopped);
  }

  async afterPauseOrStop(status: t.PlayerStatus) {
    this.status = status;
    this.dispose();
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
    console.log('player.ts: seek: ', clock);
    await this.postMessage({ type: 'backendMediaEvent', event: { type: 'seek', clock } });
  }

  async handleFrontendMediaEvent(e: t.FrontendMediaEvent) {
    try {
      switch (e.type) {
        case 'loadstart': {
          console.log('loadstart');
          return;
        }
        case 'durationchange': {
          console.log('durationchange');
          return;
        }
        case 'loadedmetadata': {
          console.log('loadedmetadata');
          return;
        }
        case 'loadeddata': {
          console.log('loadeddata');
          return;
        }
        case 'progress': {
          console.log('progress');
          return;
        }
        case 'canplay': {
          console.log('canplay');
          return;
        }
        case 'canplaythrough': {
          console.log('canplaythrough');
          return;
        }
        case 'suspend': {
          console.log('suspend');
          return;
        }
        case 'abort': {
          console.log('abort');
          await this.afterPauseOrStop(t.PlayerStatus.Stopped);
          return;
        }
        case 'emptied': {
          console.log('emptied');
          return;
        }
        case 'stalled': {
          console.log('stalled');
          return;
        }
        case 'playing': {
          console.log('playing');
          return;
        }
        case 'waiting': {
          console.log('waiting');
          return;
        }
        case 'play': {
          console.log('play');
          return;
        }
        case 'pause': {
          console.log('pause');
          return;
        }
        case 'ended': {
          console.log('ended');
          await this.afterPauseOrStop(t.PlayerStatus.Paused);
          return;
        }
        case 'seeking': {
          console.log('seeking');
          return;
        }
        case 'seeked': {
          console.log('seeked');
          return;
        }
        case 'timeupdate': {
          console.log('timeupdate', e.clock);
          await this.enqueueUpdate(e.clock);
          return;
        }
        case 'volumechange': {
          console.log('volumechange', e.volume);
          return;
        }
        case 'error': {
          console.log('error');
          // await this.afterPauseOrStop(t.PlayerStatus.Stopped);
          // error will be caught and will call this.pause()
          throw new Error(e.error);
        }
        default: {
          lib.unreachable(e);
        }
      }
    } catch (error) {
      console.error(error);
      vscode.window.showErrorMessage('ERROR', { detail: (error as Error).message });
      await this.stop();
    }
  }

  getClock(): number {
    return this.workspace.session.clock;
  }

  /**
   * Note that the lifecycle of the returned document from vscode.workspace.openTextDocument() is owned
   * by the editor and not by the extension. That means an onDidClose event can occur at any time after opening it.
   * We probably should not cache the vscTextDocument itself.
   */
  // private async openVscTextDocumentByUri(uri: t.Uri): Promise<vscode.TextDocument> {
  //   return await vscode.workspace.openTextDocument(this.workspace.uriToVsc(uri));
  // }

  private async saveHistoryClock(options?: WriteOptions) {
    this.db.mergeSessionHistory({
      id: this.workspace.session.summary.id,
      lastWatchedClock: this.getClock(),
    });
    await this.db.write(options);
  }

  private async saveHistoryOpenClose() {
    this.db.mergeSessionHistory({
      id: this.workspace.session.summary.id,
      lastWatchedTimestamp: new Date().toISOString(),
      root: this.workspace.root,
    });
    await this.db.write();
  }

  private async updateImmediately(clock: number) {
    const { session } = this.workspace;
    const seekData = session.getSeekData(clock);

    if (Math.abs(seekData.clock - session.clock) > 10 && seekData.events.length > 10) {
      // Update by seeking the internal session first, then syncing the session to vscode and disk
      const uriSet: t.UriSet = {};
      await session.seek(seekData, uriSet);
      await this.workspace.syncSessionToVscodeAndDisk(Object.keys(uriSet));
    } else {
      // Apply updates one at a time
      for (let i = 0; i < seekData.events.length; i++) {
        await session.applySeekStep(seekData, i);
        await this.vscEditorEventStepper.applySeekStep(seekData, i);
      }
      await session.finalizeSeek(seekData);
      await this.vscEditorEventStepper.finalizeSeek(seekData);
    }

    if (seekData.stop) await this.stop();

    // save history
    await this.saveHistoryClock({ ifDirtyForLong: true });
  }
}

export default Player;
