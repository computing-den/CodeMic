import * as t from '../../lib/types.js';
import * as lib from '../../lib/lib.js';
import * as ietc from './internal_workspace.js';
import VscWorkspaceStepper from './vsc_workspace_stepper.js';
import type Session from './session.js';
import config from '../config.js';
import * as vscode from 'vscode';
import _ from 'lodash';
import assert from 'assert';

class WorkspacePlayer {
  playing = false;
  onError?: (error: Error) => any;

  private session: Session;
  private disposables: vscode.Disposable[] = [];
  private updateQueue = lib.taskQueue(this.updateImmediately.bind(this), 1);

  get internalCtrl(): ietc.InternalWorkspace {
    return this.session.ctrls!.internalWorkspace;
  }

  get vscWorkspaceStepper(): VscWorkspaceStepper {
    return this.session.ctrls!.vscWorkspaceStepper;
  }

  constructor(session: Session) {
    this.session = session;
  }

  async play() {
    if (this.playing) return;

    await this.session.syncInternalWorkspaceToVscodeAndDisk();

    this.playing = true;

    // ignore user input
    {
      const disposable = vscode.commands.registerCommand('type', (e: { text: string }) => {
        const uri = vscode.window.activeTextEditor?.document.uri;
        if (!uri || !this.session.shouldRecordVscUri(uri)) {
          // approve the default type command
          vscode.commands.executeCommand('default:type', e);
        }
      });
      this.disposables.push(disposable);
    }

    // register disposables
    this.session.context.extension.subscriptions.push(...this.disposables);
  }

  pause() {
    this.playing = false;
    this.dispose();
  }

  async seek(clock: number) {
    try {
      await this.enqueueUpdate(clock);
    } catch (error) {
      if (!(error instanceof lib.CancelledError)) {
        this.gotError(error as Error);
      }
    }
  }

  /**
   * Assumes that the internal workspace was modified externally.
   */
  setClock(clock: number) {
    assert(this.updateQueue.length === 0, 'WorkspacePlayer setClock requires updateQueue to be empty');
    const seekData = this.internalCtrl.getSeekData(clock);
    this.internalCtrl.finalizeSeek(seekData);
  }

  private dispose() {
    this.updateQueue.rejectAllInQueue();
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
  }

  private async enqueueUpdate(clock: number) {
    this.updateQueue.rejectAllInQueue(); // Remove the previous seeks that have not been handled yet
    await this.updateQueue(clock);
  }

  private async updateImmediately(clock: number) {
    const seekData = this.internalCtrl.getSeekData(clock);

    if (seekData.events.length > 10) {
      if (config.logTrackPlayerUpdateStep) {
        console.log('updateImmediately: applying wholesale', seekData);
      }
      // Update by seeking the internal this.internalCtrl first, then syncing the this.internalCtrl to vscode and disk
      const uriSet: t.UriSet = {};
      await this.internalCtrl.seek(seekData, uriSet);
      await this.session.syncInternalWorkspaceToVscodeAndDisk(Object.keys(uriSet));
    } else {
      if (config.logTrackPlayerUpdateStep) {
        console.log('updateImmediately: applying one at a time', seekData);
      }
      // Apply updates one at a time
      for (let i = 0; i < seekData.events.length; i++) {
        await this.internalCtrl.applySeekStep(seekData, i);
        await this.vscWorkspaceStepper.applySeekStep(seekData, i);
      }
      this.internalCtrl.finalizeSeek(seekData);
      this.vscWorkspaceStepper.finalizeSeek(seekData);
    }
  }

  private gotError = (error: Error) => {
    this.onError?.(error);
  };
}

export default WorkspacePlayer;
