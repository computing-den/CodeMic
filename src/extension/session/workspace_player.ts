import * as t from '../../lib/types.js';
import * as lib from '../../lib/lib.js';
import InternalWorkspace from './internal_workspace.js';
import VscWorkspaceStepper from './vsc_workspace_stepper.js';
import config from '../config.js';
import * as vscode from 'vscode';
import _ from 'lodash';
import assert from 'assert';
import { LoadedSession } from './session.js';
import VscWorkspace from './vsc_workspace.js';

const STEP_COUNT_THRESHOLD = 10;

class WorkspacePlayer {
  playing = false;
  onError?: (error: Error) => any;

  private session: LoadedSession;
  private vscWorkspace: VscWorkspace;
  private vscWorkspaceStepper: VscWorkspaceStepper;
  private disposables: vscode.Disposable[] = [];
  private updateQueue = lib.taskQueue(this.updateImmediately.bind(this), 1);

  get internalWorkspace(): InternalWorkspace {
    return this.session.rr.internalWorkspace;
  }

  constructor(session: LoadedSession, vscWorkspace: VscWorkspace) {
    this.session = session;
    this.vscWorkspace = vscWorkspace;
    this.vscWorkspaceStepper = new VscWorkspaceStepper(session, vscWorkspace);
  }

  async play() {
    if (this.playing) return;

    await this.vscWorkspace.sync();

    this.playing = true;

    // ignore user input
    {
      const disposable = vscode.commands.registerCommand('type', (e: { text: string }) => {
        const uri = vscode.window.activeTextEditor?.document.uri;
        if (!uri || !this.vscWorkspace.shouldRecordVscUri(uri)) {
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
    const seekData = this.internalWorkspace.getSeekData(clock);
    this.internalWorkspace.finalizeSeek(seekData);
  }

  async applyEditorEvent(e: t.EditorEvent, uri: string, dir: t.Direction) {
    await this.internalWorkspace.stepper.applyEditorEvent(e, uri, dir);
    await this.vscWorkspaceStepper.applyEditorEvent(e, uri, dir);
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
    const seekData = this.internalWorkspace.getSeekData(clock);

    if (seekData.steps.length > STEP_COUNT_THRESHOLD) {
      if (config.logTrackPlayerUpdateStep) {
        console.log('updateImmediately: applying wholesale', seekData);
      }
      // Update by seeking the internal this.internalWorkspace first, then syncing the this.internalWorkspace to vscode and disk
      const uriSet: t.UriSet = new Set();
      await this.internalWorkspace.seek(seekData, uriSet);
      await this.vscWorkspace.sync(Array.from(uriSet));
    } else {
      if (config.logTrackPlayerUpdateStep) {
        console.log('updateImmediately: applying one at a time', seekData);
      }
      // Apply updates one at a time
      for (const step of seekData.steps) {
        await this.internalWorkspace.applySeekStep(step, seekData.direction);
        await this.vscWorkspaceStepper.applySeekStep(step, seekData.direction);
      }
      this.internalWorkspace.finalizeSeek(seekData);
      this.vscWorkspaceStepper.finalizeSeek(seekData);
    }
  }

  private gotError = (error: Error) => {
    this.onError?.(error);
  };
}

export default WorkspacePlayer;
