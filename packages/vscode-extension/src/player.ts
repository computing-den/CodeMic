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

  constructor(public context: vscode.ExtensionContext, public db: Db, public workspace: Workspace) {}

  /**
   * root must be already resolved.
   * May return undefined if user decides not to overwrite root or create it.
   */
  static async populate(
    context: vscode.ExtensionContext,
    db: Db,
    sessionSummary: t.SessionSummary,
    root: t.AbsPath,
  ): Promise<Player | undefined> {
    const workspace = await Workspace.populateSessionSummary(db, sessionSummary, root);
    return workspace && new Player(context, db, workspace);
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

    await this.saveHistoryOpenClose();
  }

  dispose() {
    this.enqueueUpdate.clear();
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
  }

  async pause() {
    this.status = t.PlayerStatus.Paused;
    this.dispose();
    await this.saveHistoryClock();
  }

  async stop() {
    this.status = t.PlayerStatus.Stopped;
    this.dispose();
    await this.saveHistoryClock();
  }

  async update(clock: number) {
    try {
      await this.enqueueUpdate(clock);
    } catch (error) {
      vscode.window.showErrorMessage('Sorry, something went wrong.', { detail: (error as Error).message });
      console.error(error);
      this.pause();
    }
  }

  async applyPlaybackEvent(e: t.PlaybackEvent, direction: t.Direction) {
    console.log(`Applying ${t.Direction[direction]}: `, JSON.stringify(e));
    return lib.dispatchPlaybackEvent(this, e, direction);
  }

  async applyStopEvent(e: t.StopEvent, direction: t.Direction) {
    await this.stop();
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
   * 'openDocument' event always has the text field since if the document was already in checkpoint, no
   * 'openDocument' event would be generated at all.
   */
  async applyOpenDocumentEvent(e: t.OpenDocumentEvent, direction: t.Direction) {
    if (direction === t.Direction.Forwards) {
      // Apply to session
      await this.workspace.session!.applyOpenDocumentEvent(e, direction);

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

    // console.log('Player: update ', clock);

    let i = this.eventIndex;
    const n = this.workspace.session!.events.length;
    const clockAt = (j: number) => this.workspace.session!.events[j].clock;

    if (i < 0 || clock > clockAt(i)) {
      // go forwards
      for (i = i + 1; i < n && clock >= clockAt(i); i++) {
        await this.applyPlaybackEvent(this.workspace.session!.events[i], t.Direction.Forwards);
        this.eventIndex = i;
      }
    } else if (clock < clockAt(i)) {
      // go backwards
      for (; i >= 0 && clock <= clockAt(i); i--) {
        await this.applyPlaybackEvent(this.workspace.session!.events[i], t.Direction.Backwards);
        this.eventIndex = i - 1;
      }
    }

    this.clock = Math.max(0, Math.min(this.workspace.session!.summary.duration, clock));

    if (this.eventIndex === n - 1) {
      await this.stop();
    }

    // save history
    await this.saveHistoryClock({ ifDirtyForLong: true });
  }
}

export default Player;
