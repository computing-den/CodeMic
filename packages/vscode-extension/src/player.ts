import * as misc from './misc.js';
import { types as t, lib } from '@codecast/lib';
import * as ir from './internal_representation.js';
import * as vscode from 'vscode';
import _ from 'lodash';
import * as fs from 'fs';
import path from 'path';
import moment from 'moment';
import assert from 'assert';

enum Dir {
  Forwards,
  Backwards,
}

export default class Player {
  status: t.PlayerStatus = t.PlayerStatus.Init;

  private disposables: vscode.Disposable[] = [];
  private eventIndex: number = -1;
  private clock: number = 0;
  private enqueueUpdate = lib.taskQueue(this.updateImmediately.bind(this), 1);

  static open(context: vscode.ExtensionContext, sessionSummary: t.SessionSummary): Player {
    assert(sessionSummary.uri.scheme === 'file', 'TODO only local files are currently supported.');
    return new Player(context, sessionSummary, ir.Session.fromFile(sessionSummary.uri.path));
  }

  constructor(
    public context: vscode.ExtensionContext,
    public sessionSummary: t.SessionSummary,
    public session: ir.Session,
  ) {}

  start() {
    assert(
      this.status === t.PlayerStatus.Init ||
        this.status === t.PlayerStatus.Paused ||
        this.status === t.PlayerStatus.Stopped,
    );
    this.status = t.PlayerStatus.Playing;

    // ignore user input
    {
      const disposable = vscode.commands.registerCommand('type', (e: { text: string }) => {
        const uri = vscode.window.activeTextEditor?.document.uri;
        if (!uri || !misc.isUriPartOfRecording(uri)) {
          // approve the default type command
          vscode.commands.executeCommand('default:type', e);
        }
      });
      this.disposables.push(disposable);
    }

    // register disposables
    this.context.subscriptions.push(...this.disposables);
  }

  dispose() {
    this.enqueueUpdate.clear();
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
  }

  pause() {
    this.status = t.PlayerStatus.Paused;
    this.dispose();
  }

  stop() {
    this.status = t.PlayerStatus.Stopped;
    this.dispose();
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
    const n = this.session.events.length;
    const clockAt = (j: number) => this.session.events[j].clock;

    if (i < 0 || clock > clockAt(i)) {
      // go forwards
      for (i = i + 1; i < n && clock >= clockAt(i); i++) {
        await this.applyEvent(this.session.events[i], Dir.Forwards);
        this.eventIndex = i;
      }
    } else if (clock < clockAt(i)) {
      // go backwards
      for (; i >= 0 && clock <= clockAt(i); i--) {
        await this.applyEvent(this.session.events[i], Dir.Backwards);
        this.eventIndex = i - 1;
      }
    }

    this.clock = Math.max(0, Math.min(this.sessionSummary.duration, clock));

    if (this.eventIndex === n - 1) {
      this.stop();
    }
  }

  private async applyEvent(e: ir.PlaybackEvent, dir: Dir) {
    console.log(`Applying ${Dir[dir]}: `, ir.playbackEventToPlain(e));
    switch (e.type) {
      case 'stop': {
        this.stop();
        break;
      }
      case 'textChange': {
        if (e.contentChanges.length > 1) {
          throw new Error('applyEvent: textChange does not yet support contentChanges.length > 1');
        }

        // Here, we assume that it is possible to get a textChange without a text editor
        // because vscode's event itself does not provide a text editor.

        const irTextDocument = this.session.getTextDocumentByUri(e.uri);
        const vscTextEditor =
          this.findVscVisibleTextEditorByUri(e.uri) ||
          (await vscode.window.showTextDocument(irTextDocument.vscTextDocument, { preserveFocus: true }));

        if (dir === Dir.Forwards) {
          for (const cc of e.contentChanges) {
            irTextDocument.applyContentChange(cc.range, cc.text, false);
            await vscTextEditor.edit(editBuilder => {
              editBuilder.replace(cc.range, cc.text);
            });
          }
        } else {
          for (const cc of e.contentChanges) {
            irTextDocument.applyContentChange(cc.revRange, cc.revText, false);
            await vscTextEditor.edit(editBuilder => {
              editBuilder.replace(cc.revRange, cc.revText);
            });
          }
        }

        break;
      }
      case 'openDocument': {
        if (dir === Dir.Forwards) {
          const vscTextDocument = await vscode.workspace.openTextDocument(e.uri);
          const vscTextEditor = await vscode.window.showTextDocument(vscTextDocument, { preserveFocus: true });
          await vscTextEditor.edit(editBuilder => {
            editBuilder.replace(misc.getWholeTextDocumentRange(vscTextDocument), e.text);
          });
          this.session.openTextDocument(vscTextDocument);
        } else {
          // nothing
        }
        break;
      }
      case 'showTextEditor': {
        if (dir === Dir.Forwards) {
          const irTextDocument = this.session.getTextDocumentByUri(e.uri);
          const irTextEditor = this.session.openTextEditor(
            irTextDocument.vscTextDocument,
            e.selections,
            e.visibleRange,
          );
          this.session.activeTextEditor = irTextEditor;

          const vscTextEditor = await vscode.window.showTextDocument(irTextDocument.vscTextDocument);
          vscTextEditor.selections = e.selections;
          await vscode.commands.executeCommand('revealLine', { lineNumber: e.visibleRange.start.line, at: 'top' });
        } else if (e.revUri) {
          const irTextDocument = this.session.getTextDocumentByUri(e.revUri);
          const irTextEditor = this.session.openTextEditor(
            irTextDocument.vscTextDocument,
            e.revSelections!,
            e.revVisibleRange!,
          );
          this.session.activeTextEditor = irTextEditor;

          const vscTextEditor = await vscode.window.showTextDocument(irTextDocument.vscTextDocument);
          vscTextEditor.selections = e.revSelections!;
          await vscode.commands.executeCommand('revealLine', { lineNumber: e.revVisibleRange!.start.line, at: 'top' });
        }

        break;
      }
      case 'select': {
        const irTextEditor = this.session.getTextEditorByUri(e.uri);
        const vscTextEditor = await vscode.window.showTextDocument(irTextEditor.document.vscTextDocument);

        if (dir === Dir.Forwards) {
          irTextEditor.selections = e.selections;
          irTextEditor.visibleRange = e.visibleRange;

          vscTextEditor.selections = e.selections;
          await vscode.commands.executeCommand('revealLine', { lineNumber: e.visibleRange.start.line, at: 'top' });
        } else {
          irTextEditor.selections = e.revSelections;
          irTextEditor.visibleRange = e.revVisibleRange;

          vscTextEditor.selections = e.revSelections;
          await vscode.commands.executeCommand('revealLine', { lineNumber: e.revVisibleRange.start.line, at: 'top' });
        }
        break;
      }
      case 'scroll': {
        const irTextEditor = this.session.getTextEditorByUri(e.uri);
        await vscode.window.showTextDocument(irTextEditor.document.vscTextDocument);

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
        const irTextDocument = this.session.getTextDocumentByUri(e.uri);
        irTextDocument.isDirty = false;
        if (!(await irTextDocument.vscTextDocument.save())) {
          throw new Error(`Could not save ${e.uri}`);
        }
        break;
      }

      default:
        misc.unreachable(e, `Unknown playback event type: ${(e as any).type || ''}`);
    }
  }

  // findOrOpenTextEditor(uri: vscode.Uri, textEditorId: number) {
  //   const vscTextDocument = await vscode.workspace.openTextDocument(e.uri);
  //   const vscTextEditor = await vscode.window.showTextDocument(vscTextDocument, {preserveFocus: true,});
  //   await vscTextEditor.edit(editBuilder => {
  //     editBuilder.replace(misc.getWholeTextDocumentRange(vscTextDocument), e.text);
  //   });
  //   this.session.openTextDocumentByVsc(vscTextDocument);

  // }

  findVscVisibleTextEditorByUri(uri: vscode.Uri) {
    return vscode.window.visibleTextEditors.find(x => misc.isEqualUri(x.document.uri, uri));
  }

  getClock(): number {
    return this.clock;
  }
}
