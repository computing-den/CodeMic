import { types as t, path, lib, ir } from '@codecast/lib';
import Workspace from './workspace.js';
import Db, { type WriteOptions } from './db.js';
import * as vscode from 'vscode';
import _ from 'lodash';
import assert from 'assert';
import fs from 'fs';

enum Dir {
  Forwards,
  Backwards,
}

class Player {
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
        await this.applyEvent(this.workspace.session!.events[i], Dir.Forwards);
        this.eventIndex = i;
      }
    } else if (clock < clockAt(i)) {
      // go backwards
      for (; i >= 0 && clock <= clockAt(i); i--) {
        await this.applyEvent(this.workspace.session!.events[i], Dir.Backwards);
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

  private async applyEvent(e: t.PlaybackEvent, dir: Dir) {
    console.log(`Applying ${Dir[dir]}: `, JSON.stringify(e));

    switch (e.type) {
      case 'stop': {
        await this.stop();
        break;
      }
      case 'textChange': {
        if (e.contentChanges.length > 1) {
          throw new Error('applyEvent: textChange does not yet support contentChanges.length > 1');
        }

        // Here, we assume that it is possible to get a textChange without a text editor
        // because vscode's event itself does not provide a text editor.

        const irTextDocument = this.workspace.session!.getTextDocumentByUri(e.uri);
        const vscTextDocument = await this.workspace.openVscTextDocumentByUri(e.uri);
        const vscTextEditor =
          this.workspace.findVscTextEditorByUri(vscode.window.visibleTextEditors, e.uri) ||
          (await vscode.window.showTextDocument(vscTextDocument, { preserveFocus: true }));

        if (dir === Dir.Forwards) {
          for (const cc of e.contentChanges) {
            irTextDocument.applyContentChange(cc.range, cc.text, false);
            await vscTextEditor.edit(editBuilder => {
              editBuilder.replace(this.workspace.rangeToVsc(cc.range), cc.text);
            });
          }
        } else {
          for (const cc of e.contentChanges) {
            irTextDocument.applyContentChange(cc.revRange, cc.revText, false);
            await vscTextEditor.edit(editBuilder => {
              editBuilder.replace(this.workspace.rangeToVsc(cc.revRange), cc.revText);
            });
          }
        }

        break;
      }
      case 'openDocument': {
        if (dir === Dir.Forwards) {
          const vscTextDocument = await this.workspace.openVscTextDocumentByUri(e.uri);
          // const vscTextEditor = await vscode.window.showTextDocument(vscTextDocument, { preserveFocus: true });
          // await vscTextEditor.edit(editBuilder => {
          //   editBuilder.replace(misc.getWholeTextDocumentRange(vscTextDocument), e.text);
          // });
          this.workspace.openTextDocumentFromVsc(vscTextDocument, e.uri);
        } else {
          // nothing
        }
        break;
      }
      case 'showTextEditor': {
        if (dir === Dir.Forwards) {
          const vscTextDocument = await this.workspace.openVscTextDocumentByUri(e.uri);
          const irTextEditor = this.workspace.openTextEditorFromVsc(
            vscTextDocument,
            e.uri,
            e.selections,
            e.visibleRange,
          );
          this.workspace.session!.activeTextEditor = irTextEditor;

          const vscTextEditor = await vscode.window.showTextDocument(vscTextDocument);
          vscTextEditor.selections = this.workspace.selectionsToVsc(e.selections);
          await vscode.commands.executeCommand('revealLine', { lineNumber: e.visibleRange.start.line, at: 'top' });
        } else if (e.revUri) {
          const vscTextDocument = await this.workspace.openVscTextDocumentByUri(e.revUri);
          const irTextEditor = this.workspace.openTextEditorFromVsc(
            vscTextDocument,
            e.revUri,
            e.revSelections!,
            e.revVisibleRange!,
          );
          this.workspace.session!.activeTextEditor = irTextEditor;

          const vscTextEditor = await vscode.window.showTextDocument(vscTextDocument);
          vscTextEditor.selections = this.workspace.selectionsToVsc(e.revSelections!);
          await vscode.commands.executeCommand('revealLine', { lineNumber: e.revVisibleRange!.start.line, at: 'top' });
        }

        break;
      }
      case 'select': {
        const vscTextDocument = await this.workspace.openVscTextDocumentByUri(e.uri);
        const irTextEditor = this.workspace.session!.getTextEditorByUri(e.uri);
        const vscTextEditor = await vscode.window.showTextDocument(vscTextDocument);

        if (dir === Dir.Forwards) {
          irTextEditor.selections = e.selections;
          irTextEditor.visibleRange = e.visibleRange;

          vscTextEditor.selections = this.workspace.selectionsToVsc(e.selections);
          await vscode.commands.executeCommand('revealLine', { lineNumber: e.visibleRange.start.line, at: 'top' });
        } else {
          irTextEditor.selections = e.revSelections;
          irTextEditor.visibleRange = e.revVisibleRange;

          vscTextEditor.selections = this.workspace.selectionsToVsc(e.revSelections);
          await vscode.commands.executeCommand('revealLine', { lineNumber: e.revVisibleRange.start.line, at: 'top' });
        }
        break;
      }
      case 'scroll': {
        const vscTextDocument = await this.workspace.openVscTextDocumentByUri(e.uri);
        const irTextEditor = this.workspace.session!.getTextEditorByUri(e.uri);
        await vscode.window.showTextDocument(vscTextDocument);

        if (dir === Dir.Forwards) {
          irTextEditor.visibleRange = e.visibleRange;
          await vscode.commands.executeCommand('revealLine', { lineNumber: e.visibleRange.start.line, at: 'top' });
        } else {
          irTextEditor.visibleRange = e.revVisibleRange;
          await vscode.commands.executeCommand('revealLine', { lineNumber: e.revVisibleRange.start.line, at: 'top' });
        }
        break;
      }
      case 'save': {
        const vscTextDocument = await this.workspace.openVscTextDocumentByUri(e.uri);
        if (!(await vscTextDocument.save())) {
          throw new Error(`Could not save ${e.uri}`);
        }
        break;
      }

      default:
        lib.unreachable(e, `Unknown playback event type: ${(e as any).type || ''}`);
    }
  }

  getClock(): number {
    return this.clock;
  }

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
}

export default Player;
