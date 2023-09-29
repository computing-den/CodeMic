import { types as t, path, lib, ir } from '@codecast/lib';
import Workspace from './workspace.js';
import Db, { type WriteOptions } from './db.js';
import * as vscode from 'vscode';
import _ from 'lodash';
import assert from 'assert';
import fs from 'fs';

class Player implements t.ApplyPlaybackEvent {
  status: t.PlayerStatus = t.PlayerStatus.Ready;

  private disposables: vscode.Disposable[] = [];
  private eventIndex: number = -1;
  private clock: number = 0;
  private enqueueUpdate = lib.taskQueue(this.updateImmediately.bind(this), 1);

  constructor(
    public context: vscode.ExtensionContext,
    public db: Db,
    public workspace: Workspace,
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
    const workspace = await Workspace.populateSession(db, setup.root, setup.sessionSummary);
    postMessage({ type: 'backendMediaEvent', event: { type: 'load', src: audioSrc.toString() } });
    return workspace && new Player(context, db, workspace, postMessage, audioSrc);
  }

  async start() {
    const oldStatus = this.status;
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

  async applyPlaybackEvent(e: t.PlaybackEvent, direction: t.Direction) {
    console.log(`Applying ${t.Direction[direction]}: `, JSON.stringify(e));
    return lib.dispatchPlaybackEvent(this, e, direction);
  }

  async applyTextChangeEvent(e: t.TextChangeEvent, direction: t.Direction) {
    if (e.contentChanges.length > 1) {
      throw new Error('applyTextChangeEvent: TODO textChange does not yet support contentChanges.length > 1');
    }

    // Apply to session
    await this.workspace.session!.applyTextChangeEvent(e, direction);

    // We use WorkspaceEdit here because we don't necessarily want to focus on the text editor yet.
    // There will be a separate select event after this if the editor had focus during recording.

    const vscUri = this.workspace.uriToVsc(e.uri);
    const edit = new vscode.WorkspaceEdit();
    if (direction === t.Direction.Forwards) {
      for (const cc of e.contentChanges) {
        edit.replace(vscUri, this.workspace.rangeToVsc(cc.range), cc.text);
      }
    } else {
      for (const cc of e.contentChanges) {
        // TODO shouldn't we apply these in reverse order?
        edit.replace(vscUri, this.workspace.rangeToVsc(cc.revRange), cc.revText);
      }
    }
    await vscode.workspace.applyEdit(edit);
  }

  /**
   * 'openTextDocument' event always has the text field since if the document was already in checkpoint, no
   * 'openTextDocument' event would be generated at all.
   */
  async applyOpenTextDocumentEvent(e: t.OpenTextDocumentEvent, direction: t.Direction) {
    if (direction === t.Direction.Forwards) {
      // Apply to session
      await this.workspace.session!.applyOpenTextDocumentEvent(e, direction);

      // Open vsc document first.
      const vscTextDocument = await vscode.workspace.openTextDocument(this.workspace.uriToVsc(e.uri));

      // We use WorkspaceEdit here because we don't necessarily want to open the text editor yet.
      const edit = new vscode.WorkspaceEdit();
      edit.replace(vscTextDocument.uri, this.workspace.getVscTextDocumentRange(vscTextDocument), e.text);
      await vscode.workspace.applyEdit(edit);
    } else {
      await this.workspace.closeVscTextEditorByUri(e.uri, true);
    }
  }

  async applyShowTextEditorEvent(e: t.ShowTextEditorEvent, direction: t.Direction) {
    await this.workspace.session!.applyShowTextEditorEvent(e, direction);

    if (direction === t.Direction.Forwards) {
      const vscTextEditor = await vscode.window.showTextDocument(this.workspace.uriToVsc(e.uri), {
        preview: false,
        preserveFocus: false,
      });
      vscTextEditor.selections = this.workspace.selectionsToVsc(e.selections);
      await vscode.commands.executeCommand('revealLine', { lineNumber: e.visibleRange.start.line, at: 'top' });
    } else if (e.revUri) {
      const vscTextEditor = await vscode.window.showTextDocument(this.workspace.uriToVsc(e.revUri), {
        preview: false,
        preserveFocus: false,
      });
      vscTextEditor.selections = this.workspace.selectionsToVsc(e.revSelections!);
      await vscode.commands.executeCommand('revealLine', { lineNumber: e.revVisibleRange!.start.line, at: 'top' });
    }
  }

  async applySelectEvent(e: t.SelectEvent, direction: t.Direction) {
    await this.workspace.session!.applySelectEvent(e, direction);

    const vscTextEditor = await vscode.window.showTextDocument(this.workspace.uriToVsc(e.uri), {
      preview: false,
      preserveFocus: false,
    });

    if (direction === t.Direction.Forwards) {
      vscTextEditor.selections = this.workspace.selectionsToVsc(e.selections);
      await vscode.commands.executeCommand('revealLine', { lineNumber: e.visibleRange.start.line, at: 'top' });
    } else {
      vscTextEditor.selections = this.workspace.selectionsToVsc(e.revSelections);
      await vscode.commands.executeCommand('revealLine', { lineNumber: e.revVisibleRange.start.line, at: 'top' });
    }
  }

  async applyScrollEvent(e: t.ScrollEvent, direction: t.Direction) {
    await this.workspace.session!.applyScrollEvent(e, direction);

    await vscode.window.showTextDocument(this.workspace.uriToVsc(e.uri), { preview: false, preserveFocus: false });

    if (direction === t.Direction.Forwards) {
      await vscode.commands.executeCommand('revealLine', { lineNumber: e.visibleRange.start.line, at: 'top' });
    } else {
      await vscode.commands.executeCommand('revealLine', { lineNumber: e.revVisibleRange.start.line, at: 'top' });
    }
  }

  async applySaveEvent(e: t.SaveEvent, direction: t.Direction) {
    const vscTextDocument = await vscode.workspace.openTextDocument(this.workspace.uriToVsc(e.uri));
    if (!(await vscTextDocument.save())) {
      throw new Error(`Could not save ${e.uri}`);
    }
  }

  getClock(): number {
    return this.clock;
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
      id: this.workspace.session!.summary.id,
      lastWatchedClock: this.clock,
    });
    await this.db.write(options);
  }

  private async saveHistoryOpenClose() {
    this.db.mergeSessionHistory({
      id: this.workspace.session!.summary.id,
      lastWatchedTimestamp: new Date().toISOString(),
      root: this.workspace.root,
    });
    await this.db.write();
  }

  private async updateImmediately(clock: number) {
    // FORWARD

    // events/clock:        -1  0  1  2  3  4  5  6
    // clock:                   ^
    // eventIndex:           ^
    // apply:                   ^
    // new eventIndex:          ^

    // events/clock:        -1  0  1  2  3  4  5  6
    // clock:                          ^
    // eventIndex:              ^
    // apply:                      ^  ^
    // new eventIndex:                ^

    // events/clock:        -1  0  1  2  3  4  5  6
    // clock:                            ^
    // eventIndex:                       ^
    // apply:
    // new eventIndex:                   ^

    // events/clock:        -1  0  1  2  3  4  5  6
    // clock:                             ^
    // eventIndex:                       ^
    // apply:
    // new eventIndex:                   ^

    // events/clock:        -1  0  1  2  3  4  5  6
    // clock:                                     ^
    // eventIndex:                                ^
    // apply:
    // new eventIndex:                            ^

    // BACKWARD

    // events/clock:        -1  0  1  2  3  4  5  6
    // clock:                                   ^
    // eventIndex:                                ^
    // apply reverse:                             ^
    // new eventIndex:                         ^

    // events/clock:        -1  0  1  2  3  4  5  6
    // clock:                                  ^
    // eventIndex:                             ^
    // apply reverse:
    // new eventIndex:                         ^

    // events/clock:        -1  0  1  2  3  4  5  6
    // clock:                            ^
    // eventIndex:                             ^
    // apply reverse:                       ^  ^
    // new eventIndex:                   ^

    // events/clock:        -1  0  1  2  3  4  5  6
    // clock:                   ^
    // eventIndex:                    ^
    // apply reverse:              ^  ^
    // new eventIndex:          ^

    // events/clock:        -1  0  1  2  3  4  5  6
    // clock:                   ^
    // eventIndex:                 ^
    // apply reverse:              ^
    // new eventIndex:          ^

    // events/clock:        -1  0  1  2  3  4  5  6
    // clock:                   ^
    // eventIndex:              ^
    // apply reverse:
    // new eventIndex:          ^

    let i = this.eventIndex;
    const seekData = this.workspace.session!.getSeekData(i, clock);

    if (Math.abs(seekData.clock - this.clock) > 10 && seekData.events.length > 10) {
      // Update by seeking the internal session first, then syncing the session to vscode and disk
      const uriSet: t.UriSet = {};
      await this.workspace.session!.seek(seekData, uriSet);
      await this.workspace.syncSessionToVscodeAndDisk(Object.keys(uriSet));
    } else {
      // Apply updates one at a time
      for (const event of seekData.events) {
        await this.applyPlaybackEvent(event, seekData.direction);
      }
    }

    this.eventIndex = seekData.i;
    this.clock = seekData.clock;

    if (seekData.stop) await this.stop();

    // save history
    await this.saveHistoryClock({ ifDirtyForLong: true });
  }
}

export default Player;
