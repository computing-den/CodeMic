import { types as t, path, lib, editorTrack as et } from '@codecast/lib';
import VscEditorWorkspace from './vsc_editor_workspace.js';
import VscEditorEventStepper from './vsc_editor_event_stepper.js';
import Db, { type WriteOptions } from './db.js';
import * as vscode from 'vscode';
import _ from 'lodash';
import assert from 'assert';
import fs from 'fs';

class VscEditorPlayer implements t.EditorPlayer {
  isPlaying = false;
  onError?: (error: Error) => any;

  get track(): et.EditorTrack {
    return this.workspace.editorTrack;
  }

  private vscEditorEventStepper = new VscEditorEventStepper(this.workspace);
  private disposables: vscode.Disposable[] = [];
  private updateQueue = lib.taskQueue(this.updateImmediately.bind(this), 1);

  constructor(public context: vscode.ExtensionContext, public workspace: VscEditorWorkspace) {}

  play() {
    if (this.isPlaying) return;
    this.isPlaying = true;

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
  }

  pause() {
    if (!this.isPlaying) return;
    this.isPlaying = false;
    this.dispose();
  }

  seek(clock: number) {
    this.seekHelper(clock);
  }

  /**
   * Assumes that the editor track is modified externally.
   */
  setClock(clock: number) {
    assert(this.updateQueue.length === 0, 'VscEditorPlayer setClock requires updateQueue to be empty');
    const seekData = this.workspace.editorTrack.getSeekData(clock);
    this.workspace.editorTrack.finalizeSeek(seekData);
  }

  private dispose() {
    this.updateQueue.rejectAllInQueue();
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
  }

  private async seekHelper(clock: number) {
    try {
      await this.enqueueUpdate(clock);
    } catch (error) {
      if (!(error instanceof lib.CancelledError)) {
        this.gotError(error as Error);
      }
    }
  }

  private async enqueueUpdate(clock: number) {
    this.updateQueue.rejectAllInQueue(); // Remove the previous seeks that have not been handled yet
    await this.updateQueue(clock);
  }

  private async updateImmediately(clock: number) {
    const { editorTrack } = this.workspace;
    const seekData = editorTrack.getSeekData(clock);

    if (seekData.events.length > 10) {
      console.log('updateImmediately: applying wholesale', seekData);
      // Update by seeking the internal editorTrack first, then syncing the editorTrack to vscode and disk
      const uriSet: t.UriSet = {};
      await editorTrack.seek(seekData, uriSet);
      await this.workspace.syncEditorTrackToVscodeAndDisk(Object.keys(uriSet));
    } else {
      console.log('updateImmediately: applying one at a time', seekData);
      // Apply updates one at a time
      for (let i = 0; i < seekData.events.length; i++) {
        await editorTrack.applySeekStep(seekData, i);
        await this.vscEditorEventStepper.applySeekStep(seekData, i);
      }
      editorTrack.finalizeSeek(seekData);
      this.vscEditorEventStepper.finalizeSeek(seekData);
    }
  }

  private gotError = (error: Error) => {
    this.onError?.(error);
  };
}

export default VscEditorPlayer;
