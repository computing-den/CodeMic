import * as t from '../../lib/types.js';
import * as lib from '../../lib/lib.js';
import InternalWorkspace, { SeekData } from './internal_workspace.js';
import VscWorkspaceStepper from './vsc_workspace_stepper.js';
import config from '../config.js';
import * as vscode from 'vscode';
import _ from 'lodash';
import { LoadedSession } from './session.js';
import VscWorkspace from './vsc_workspace.js';

class WorkspacePlayer {
  playing = false;
  // onError?: (error: Error) => any;

  private session: LoadedSession;

  private internalWorkspace: InternalWorkspace;
  private vscWorkspace: VscWorkspace;

  private vscWorkspaceStepper: VscWorkspaceStepper;
  private disposables: vscode.Disposable[] = [];

  constructor(session: LoadedSession, internalWorkspace: InternalWorkspace, vscWorkspace: VscWorkspace) {
    this.session = session;
    this.internalWorkspace = internalWorkspace;
    this.vscWorkspace = vscWorkspace;
    this.vscWorkspaceStepper = new VscWorkspaceStepper(session, internalWorkspace, vscWorkspace);
  }

  async play() {
    if (this.playing) return;

    this.playing = true;

    // Ignore user input.
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

    // Prevent auto closing tags and other auto insertions during playback.
    {
      const KEYS = [
        ['editor', 'autoClosingBrackets', 'never'],
        ['editor', 'autoClosingQuotes', 'never'],
        ['editor', 'autoSurround', 'never'],
        ['editor', 'autoClosingOvertype', 'never'],
        ['editor', 'formatOnType', false],
        ['editor', 'linkedEditing', false],
        ['editor', 'renameOnType', false],

        ['html', 'autoClosingTags', false],
        ['javascript', 'autoClosingTags', false],
        ['typescript', 'autoClosingTags', false],
        // ['xml', 'autoClosingTags.enabled', false],
        // ['php', 'autoClosingTags', false],
        // ['razor', 'autoClosingTags', false],
        // ['vue', 'autoClosingTags', false],

        ['javascript.suggest', 'completeFunctionCalls', false],
        ['typescript.suggest', 'completeFunctionCalls', false],
        ['python.analysis', 'completeFunctionParens', false],
        ['C_Cpp', 'autocompleteAddParentheses', false],
        ['go', 'useCodeSnippetsOnFunctionSuggest', false],
        ['rust-analyzer.completion', 'callable.snippets', 'none'],
        ['java.completion', 'guessMethodArguments', false],
      ] as const;

      for (const [section, key, value] of KEYS) {
        const cfg = vscode.workspace.getConfiguration(section);
        if (cfg.has(key)) {
          await cfg.update(key, value, vscode.ConfigurationTarget.Workspace);
        }
      }

      this.disposables.push(
        new vscode.Disposable(() => {
          for (const [section, key] of KEYS) {
            const cfg = vscode.workspace.getConfiguration(section);
            if (cfg.has(key)) {
              cfg.update(key, undefined, vscode.ConfigurationTarget.Workspace);
            }
          }
        }),
      );
    }

    // register disposables
    this.session.context.extension.subscriptions.push(...this.disposables);
  }

  pause() {
    this.playing = false;
    this.dispose();
  }

  async seek(clock: number, useStepper: boolean) {
    await this.seekWithData(this.internalWorkspace.getSeekData(clock), useStepper);
  }

  async seekWithData(seekData: SeekData, useStepper: boolean) {
    if (seekData.steps.length === 0) return;

    if (useStepper || config.stepOnly) {
      if (config.logTrackPlayerUpdateStep) console.log('player seek: stepping');
      // Apply updates one at a time.
      // If stepper fails for any reason, fall back to sync (unless config.stepOnly is set
      // which is only for debugging).
      // Stepper may fail if for example the user messed with the editor during playback.
      let fallback = false;
      const uriSet: t.UriSet = new Set();
      for (const step of seekData.steps) {
        await this.internalWorkspace.applySeekStep(step, seekData.direction, uriSet);
        if (!fallback) {
          const [error] = await lib.tryCatch(this.vscWorkspaceStepper.applySeekStep(step, seekData.direction));
          if (error && config.stepOnly) throw error;
          fallback = Boolean(error);
        }
      }
      if (fallback) {
        if (config.logTrackPlayerUpdateStep) console.log('player seek: falling back to sync');
        await this.vscWorkspace.sync(Array.from(uriSet));
      }
    } else {
      if (config.logTrackPlayerUpdateStep) console.log('player seek: syncing');
      // Update by seeking the internal this.internalWorkspace first, then syncing the this.internalWorkspace to vscode and fs
      const uriSet: t.UriSet = new Set();
      await this.internalWorkspace.seekWithData(seekData, uriSet);
      await this.vscWorkspace.sync(Array.from(uriSet));
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
