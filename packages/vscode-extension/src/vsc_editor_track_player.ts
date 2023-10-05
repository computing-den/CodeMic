import { types as t, path, lib, editorTrack as et, ClockTrackPlayer } from '@codecast/lib';
import VscEditorWorkspace from './vsc_editor_workspace.js';
import VscEditorEventStepper from './vsc_editor_event_stepper.js';
import Db, { type WriteOptions } from './db.js';
import * as vscode from 'vscode';
import _ from 'lodash';
import assert from 'assert';
import fs from 'fs';

class VscEditorTrackPlayer implements t.TrackPlayer {
  status: t.TrackPlayerStatus = t.TrackPlayerStatus.Init;
  onProgress?: (clock: number) => any;
  onStatusChange?: (status: t.TrackPlayerStatus) => any;

  get clock(): number {
    return this.clockTrackPlayer.clock;
  }

  private vscEditorEventStepper = new VscEditorEventStepper(this.workspace);
  private clockTrackPlayer = new ClockTrackPlayer(100);
  private disposables: vscode.Disposable[] = [];
  private enqueueUpdate = lib.taskQueue(this.updateImmediately.bind(this), 1);

  constructor(public context: vscode.ExtensionContext, public workspace: VscEditorWorkspace) {}

  async start() {
    // assert(
    //   this.status === t.PlayerStatus.Initialized ||
    //     this.status === t.PlayerStatus.Paused ||
    //     this.status === t.PlayerStatus.Stopped,
    // );

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

    this.setStatusAndNotify(t.TrackPlayerStatus.Playing);
    this.clockTrackPlayer.start();
    this.clockTrackPlayer.onProgress = this.clockTrackProgressHandler.bind(this);
  }

  async pause() {
    this.dispose();
    this.clockTrackPlayer.pause();
    this.setStatusAndNotify(t.TrackPlayerStatus.Paused);
  }

  async stop() {
    this.dispose();
    this.clockTrackPlayer.stop();
    this.setStatusAndNotify(t.TrackPlayerStatus.Stopped);
  }

  /**
   * Throws an error if seek had an error but not if it was cancelled.
   */
  async seek(clock: number) {
    const originalStatus = this.status;
    try {
      // Pause clock while loading.
      this.setStatusAndNotify(t.TrackPlayerStatus.Loading);
      this.clockTrackPlayer.pause();
      this.clockTrackPlayer.seek(clock);
      await this.enqueueUpdate(clock);

      // Restore the original status.
      this.setStatusAndNotify(originalStatus);
      if (originalStatus === t.TrackPlayerStatus.Playing) {
        this.clockTrackPlayer.start();
      }
    } catch (error) {
      if (!(error instanceof lib.CancelledError)) {
        this.gotError(error);
        throw error;
      }
    }
  }

  dispose() {
    this.enqueueUpdate.rejectAllInQueue();
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
  }

  private async clockTrackProgressHandler(clock: number) {
    try {
      await this.enqueueUpdate(clock);
    } catch (error) {
      if (!(error instanceof lib.CancelledError)) {
        this.gotError(error);
        throw error;
      }
    }
  }

  private gotError(error: any) {
    console.error(error);
    this.dispose();
    this.setStatusAndNotify(t.TrackPlayerStatus.Error);
  }

  private setStatusAndNotify(status: t.TrackPlayerStatus) {
    this.status = status;
    this.onStatusChange?.(status);
  }

  private async updateImmediately(clock: number) {
    const { editorTrack } = this.workspace;
    const seekData = editorTrack.getSeekData(clock);

    if (Math.abs(seekData.clock - editorTrack.clock) > 10 && seekData.events.length > 10) {
      // Update by seeking the internal editorTrack first, then syncing the editorTrack to vscode and disk
      const uriSet: t.UriSet = {};
      await editorTrack.seek(seekData, uriSet);
      await this.workspace.syncEditorTrackToVscodeAndDisk(Object.keys(uriSet));
    } else {
      // Apply updates one at a time
      for (let i = 0; i < seekData.events.length; i++) {
        await editorTrack.applySeekStep(seekData, i);
        await this.vscEditorEventStepper.applySeekStep(seekData, i);
      }
      await editorTrack.finalizeSeek(seekData);
      await this.vscEditorEventStepper.finalizeSeek(seekData);
    }

    this.onProgress?.(seekData.clock);
    if (seekData.stop) await this.stop();
  }
}

export default VscEditorTrackPlayer;
