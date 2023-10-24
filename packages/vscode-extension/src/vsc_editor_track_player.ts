import { types as t, path, lib, editorTrack as et, ClockTrackPlayer } from '@codecast/lib';
import VscEditorWorkspace from './vsc_editor_workspace.js';
import VscEditorEventStepper from './vsc_editor_event_stepper.js';
import Db, { type WriteOptions } from './db.js';
import * as vscode from 'vscode';
import _ from 'lodash';
import assert from 'assert';
import fs from 'fs';

class VscEditorTrackPlayer implements t.TrackPlayer {
  name = 'vsc player';

  state: t.TrackPlayerState = {
    status: t.TrackPlayerStatus.Init,
    loading: false,
    loaded: false,
    buffering: false,
    seeking: false,
  };
  isRecorder = false;

  onProgress?: (clock: number) => any;
  onStateChange?: (state: t.TrackPlayerState) => any;

  get clock(): number {
    return this.clockTrackPlayer.clock;
  }

  get playbackRate(): number {
    return this.clockTrackPlayer.playbackRate;
  }

  get track(): et.EditorTrack {
    return this.workspace.editorTrack;
  }

  private vscEditorEventStepper = new VscEditorEventStepper(this.workspace);
  private clockTrackPlayer = new ClockTrackPlayer(100);
  private disposables: vscode.Disposable[] = [];
  private updateQueue = lib.taskQueue(this.updateImmediately.bind(this), 1);
  private lastUpdateClock = 0;

  constructor(public context: vscode.ExtensionContext, public workspace: VscEditorWorkspace) {}

  load() {
    assert(this.state.status !== t.TrackPlayerStatus.Error, 'Track has error');
    if (this.state.loaded || this.state.loading) return;

    this.clockTrackPlayer.load();
    this.updateState({ loading: false, loaded: true });
  }

  start() {
    assert(this.state.status !== t.TrackPlayerStatus.Error, 'Track has error');
    if (this.state.status === t.TrackPlayerStatus.Running) return;

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

    this.clockTrackPlayer.start();
    this.clockTrackPlayer.onProgress = this.clockTrackProgressHandler.bind(this);
    this.updateState({ status: t.TrackPlayerStatus.Running });
  }

  pause() {
    assert(this.state.status !== t.TrackPlayerStatus.Error, 'Track has error');
    if (this.state.status === t.TrackPlayerStatus.Paused) return;

    this.dispose();
    this.clockTrackPlayer.pause();
    this.updateState({ status: t.TrackPlayerStatus.Paused });
  }

  stop() {
    if (this.state.status === t.TrackPlayerStatus.Stopped || this.state.status === t.TrackPlayerStatus.Error) return;

    this.dispose();
    this.clockTrackPlayer.stop();
    this.updateState({ status: t.TrackPlayerStatus.Stopped });
  }

  /**
   * Throws an error if seek had an error but not if it was cancelled.
   */
  seek(clock: number) {
    assert(this.state.status !== t.TrackPlayerStatus.Error, 'Track has error');
    assert(this.state.loaded, 'Track is not loaded');

    this.seekHelper(clock);
  }

  setClock(clock: number) {
    this.updateQueue.rejectAllInQueue();
    this.clockTrackPlayer.setClock(clock);
    this.lastUpdateClock = clock;
  }

  extend(clock: number) {
    throw new Error('VscEditorTrackPlayer not extendable');
  }

  setPlaybackRate(rate: number) {
    this.clockTrackPlayer.setPlaybackRate(rate);
  }

  dispose() {
    this.updateQueue.rejectAllInQueue();
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
  }

  private async seekHelper(clock: number) {
    try {
      // Pause clock while seeking.
      this.updateState({ seeking: true });
      this.clockTrackPlayer.pause();
      this.clockTrackPlayer.seek(clock);
      await this.enqueueUpdate(clock);
    } catch (error) {
      if (!(error instanceof lib.CancelledError)) {
        this.gotError(error);
      }
    }
  }

  private clockTrackProgressHandler(clock: number) {
    this.enqueueUpdate(clock).catch(error => {
      if (!(error instanceof lib.CancelledError)) {
        this.gotError(error);
      }
    });
  }

  private async enqueueUpdate(clock: number) {
    this.updateQueue.rejectAllInQueue();
    await this.updateQueue(clock);
  }

  private async updateImmediately(clock: number) {
    const { editorTrack } = this.workspace;
    const seekData = editorTrack.getSeekData(clock);

    if (Math.abs(seekData.clock - this.lastUpdateClock) > 10 && seekData.events.length > 10) {
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
      await editorTrack.finalizeSeek(seekData);
      await this.vscEditorEventStepper.finalizeSeek(seekData);
    }

    this.lastUpdateClock = seekData.clock;

    // End seeking
    if (this.state.seeking) {
      this.updateState({ seeking: false });
    }

    this.onProgress?.(seekData.clock);

    // Start clock again if running.
    if (this.state.status === t.TrackPlayerStatus.Running) {
      this.clockTrackPlayer.start();
    }

    if (seekData.stop) this.stop();
  }

  private gotError(error: any) {
    console.error(error);
    this.dispose();
    this.updateState({ status: t.TrackPlayerStatus.Error });
  }

  private updateState(partial: Partial<t.TrackPlayerState>) {
    this.state = { ...this.state, ...partial };
    this.onStateChange?.(this.state);
  }
}

export default VscEditorTrackPlayer;
