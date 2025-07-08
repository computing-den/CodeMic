import * as t from '../../lib/types.js';
import * as lib from '../../lib/lib.js';
import InternalWorkspace, { SeekData } from './internal_workspace.js';
import VscWorkspaceStepper from './vsc_workspace_stepper.js';
import config from '../config.js';
import * as vscode from 'vscode';
import _ from 'lodash';
import { LoadedSession } from './session.js';
import VscWorkspace from './vsc_workspace.js';

const STEP_COUNT_THRESHOLD = 50;

class WorkspacePlayer {
  playing = false;
  // onError?: (error: Error) => any;

  private session: LoadedSession;

  private internalWorkspace: InternalWorkspace;
  private vscWorkspace: VscWorkspace;

  private vscWorkspaceStepper: VscWorkspaceStepper;
  private disposables: vscode.Disposable[] = [];
  // private updateQueue = lib.taskQueue(this.updateImmediately.bind(this), 1);

  constructor(session: LoadedSession, internalWorkspace: InternalWorkspace, vscWorkspace: VscWorkspace) {
    this.session = session;
    this.internalWorkspace = internalWorkspace;
    this.vscWorkspace = vscWorkspace;
    this.vscWorkspaceStepper = new VscWorkspaceStepper(session, internalWorkspace, vscWorkspace);
  }

  async play() {
    if (this.playing) return;

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

  async seek(clock: number, useStepper?: boolean) {
    await this.seekWithData(this.internalWorkspace.getSeekData(clock), useStepper);
  }

  async seekWithData(seekData: SeekData, useStepper?: boolean) {
    if (seekData.steps.length > STEP_COUNT_THRESHOLD && useStepper !== true && !config.stepOnly) {
      if (config.logTrackPlayerUpdateStep) {
        console.log('updateImmediately: applying wholesale', seekData);
      }
      // Update by seeking the internal this.internalWorkspace first, then syncing the this.internalWorkspace to vscode and disk
      const uriSet: t.UriSet = new Set();
      await this.internalWorkspace.seekWithData(seekData, uriSet);
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
      // this.internalWorkspace.finalizeSeek(seekData);
    }
  }

  // async applyEditorEvent(e: t.EditorEvent, uri: string, dir: t.Direction) {
  //   await this.internalWorkspace.stepper.applyEditorEvent(e, uri, dir);
  //   await this.vscWorkspaceStepper.applyEditorEvent(e, uri, dir);
  // }

  private dispose() {
    // this.updateQueue.rejectAllInQueue();
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
  }
}

export default WorkspacePlayer;
