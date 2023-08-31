import Workspace from './workspace.js';
import * as misc from './misc.js';
import Db from './db.js';
import { types as t, path, ir } from '@codecast/lib';
import * as vscode from 'vscode';
import fs from 'fs';
import _ from 'lodash';
import assert from 'assert';
import { v4 as uuid } from 'uuid';

const SCROLL_LINES_TRIGGER = 2;

class Recorder {
  status: t.RecorderStatus = t.RecorderStatus.Ready;

  private disposables: vscode.Disposable[] = [];
  private scrolling: boolean = false;
  private scrollStartRange?: t.Range;
  private startTimeMs: number = Date.now();

  constructor(public context: vscode.ExtensionContext, public db: Db, public workspace: Workspace) {}

  /**
   * root must be already resolved.
   */
  static async fromDirAndVsc(context: vscode.ExtensionContext, db: Db, root: t.AbsPath): Promise<Recorder> {
    const summary: t.SessionSummary = {
      id: uuid(),
      title: 'Untitled',
      description: 'No description',
      author: {
        name: 'sean_shir',
        avatar: 'avatar1.png',
      },
      published: false,
      defaultRoot: root,
      duration: 0,
      views: 0,
      likes: 0,
      timestamp: new Date().toISOString(), // will be overwritten at the end
      toc: [],
    };
    const workspace = await Workspace.fromDirAndVsc(root, summary);
    return new Recorder(context, db, workspace);
  }

  async start() {
    assert(this.status === t.RecorderStatus.Ready || this.status === t.RecorderStatus.Paused);

    this.status = t.RecorderStatus.Recording;

    // listen for open document events
    {
      const disposable = vscode.workspace.onDidOpenTextDocument(vscTextDocument => {
        this.openDocument(vscTextDocument);
      });
      this.disposables.push(disposable);
    }

    // listen for show document events
    {
      const disposable = vscode.window.onDidChangeActiveTextEditor(vscTextEditor => {
        if (vscTextEditor) this.showTextEditor(vscTextEditor);
      });
      this.disposables.push(disposable);
    }

    // listen for text change events
    {
      const disposable = vscode.workspace.onDidChangeTextDocument(e => {
        this.textChange(e.document, e.contentChanges);
      });
      this.disposables.push(disposable);
    }

    // listen for selection change events
    {
      const disposable = vscode.window.onDidChangeTextEditorSelection(e => {
        // checking for e.kind !== TextEditorSelectionChangeKind.Keyboard isn't helpful
        // because shift+arrow keys would trigger this event kind
        this.select(e.textEditor, e.selections);
      });
      this.disposables.push(disposable);
    }

    // listen for save events
    {
      const disposable = vscode.workspace.onDidSaveTextDocument(vscTextDocument => {
        this.saveTextDocument(vscTextDocument);
      });
      this.disposables.push(disposable);
    }

    // listen for scroll events
    {
      const disposable = vscode.window.onDidChangeTextEditorVisibleRanges(e => {
        this.scroll(e.textEditor, e.visibleRanges);
      });
      this.disposables.push(disposable);
    }

    // register disposables
    this.context.subscriptions.push(...this.disposables);
  }

  pause() {
    this.status = t.RecorderStatus.Paused;
    this.dispose();
  }

  dispose() {
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
  }

  async stop() {
    if (this.workspace.session!.events.length > 0) {
      const clock = this.getClock();
      this.pushEvent({ type: 'stop', clock });
      this.workspace.session!.summary.duration = clock;
      this.workspace.session!.summary.timestamp = new Date().toISOString();
      this.status = t.RecorderStatus.Stopped;
    }
    this.dispose();
  }

  canSave(): boolean {
    // there must be more than a stop event
    return this.workspace.session!.events.length > 1;
  }

  textChange(
    vscTextDocument: vscode.TextDocument,
    vscContentChanges: readonly vscode.TextDocumentContentChangeEvent[],
  ) {
    if (!this.workspace.shouldRecordVscUri(vscTextDocument.uri)) return;

    const uri = this.workspace.uriFromVsc(vscTextDocument.uri);
    console.log(`adding textChange for ${uri}`);

    // Here, we assume that it is possible to get a textChange without a text editor
    // because vscode's event itself does not provide a text editor.

    const irTextDocument = this.workspace.openTextDocumentFromVsc(vscTextDocument, uri);
    const irContentChanges = vscContentChanges.map(({ range, text }) => {
      const [revRange, revText] = irTextDocument.applyContentChange(range, text, true)!;
      return { range, text, revRange, revText };
    });

    this.pushEvent({
      type: 'textChange',
      clock: this.getClock(),
      uri: irTextDocument.uri,
      contentChanges: irContentChanges,
    });
  }

  openDocument(vscTextDocument: vscode.TextDocument) {
    if (!this.workspace.shouldRecordVscUri(vscTextDocument.uri)) return;

    const uri = this.workspace.uriFromVsc(vscTextDocument.uri);
    console.log(`adding openDocument for ${uri}`);

    const irTextDocument = this.workspace.openTextDocumentFromVsc(vscTextDocument, uri);
    this.pushEvent({
      type: 'openDocument',
      clock: this.getClock(),
      uri,
      eol: irTextDocument.eol,
    });
  }

  showTextEditor(vscTextEditor: vscode.TextEditor) {
    if (!this.workspace.shouldRecordVscUri(vscTextEditor.document.uri)) return;

    const uri = this.workspace.uriFromVsc(vscTextEditor.document.uri);
    console.log(`adding showTextEditor for ${uri}`);

    const revUri = this.workspace.session!.activeTextEditor?.document.uri;
    const revSelections = this.workspace.session!.activeTextEditor?.selections;
    const revVisibleRange = this.workspace.session!.activeTextEditor?.visibleRange;

    const selections = this.workspace.selectionsFromVsc(vscTextEditor.selections);
    const visibleRange = this.workspace.rangeFromVsc(vscTextEditor.visibleRanges[0]);
    const irTextEditor = this.workspace.openTextEditorFromVsc(vscTextEditor.document, uri, selections, visibleRange);
    this.workspace.session!.activeTextEditor = irTextEditor;

    this.pushEvent({
      type: 'showTextEditor',
      clock: this.getClock(),
      uri,
      selections,
      visibleRange,
      revUri,
      revSelections,
      revVisibleRange,
    });
  }

  select(vscTextEditor: vscode.TextEditor, selections: readonly vscode.Selection[]) {
    if (!this.workspace.shouldRecordVscUri(vscTextEditor.document.uri)) return;

    const uri = this.workspace.uriFromVsc(vscTextEditor.document.uri);
    console.log(`adding select for ${uri}`);
    console.log(
      `visibleRange: ${vscTextEditor.visibleRanges[0].start.line}:${vscTextEditor.visibleRanges[0].end.line}`,
    );

    const irTextEditor = this.workspace.session!.getTextEditorByUri(uri);
    const revSelections = irTextEditor.selections;
    const revVisibleRanges = irTextEditor.visibleRange;
    irTextEditor.select(
      this.workspace.selectionsFromVsc(selections),
      this.workspace.rangeFromVsc(vscTextEditor.visibleRanges[0]),
    );

    this.pushEvent({
      type: 'select',
      clock: this.getClock(),
      uri,
      selections: irTextEditor.selections,
      visibleRange: irTextEditor.visibleRange,
      revSelections,
      revVisibleRange: revVisibleRanges,
    });
  }

  saveTextDocument(vscTextDocument: vscode.TextDocument) {
    if (!this.workspace.shouldRecordVscUri(vscTextDocument.uri)) return;

    const uri = this.workspace.uriFromVsc(vscTextDocument.uri);
    console.log(`adding save for ${uri}`);

    this.pushEvent({
      type: 'save',
      clock: this.getClock(),
      uri,
    });
  }

  scroll(vscTextEditor: vscode.TextEditor, visibleRanges: readonly vscode.Range[]) {
    if (!this.workspace.shouldRecordVscUri(vscTextEditor.document.uri)) return;

    const uri = this.workspace.uriFromVsc(vscTextEditor.document.uri);
    const visibleRange = this.workspace.rangeFromVsc(visibleRanges[0]);
    console.log(`visible range: ${visibleRange.start.line}:${visibleRange.end.line}`);

    if (!this.scrolling) {
      this.scrollStartRange ??= visibleRange;
      const delta = Math.abs(visibleRange.start.line - this.scrollStartRange.start.line);
      if (delta > SCROLL_LINES_TRIGGER) {
        this.scrolling = true;
      }
    }

    if (!this.scrolling) return;

    console.log(`adding scroll for ${uri}`);

    const irTextEditor = this.workspace.session!.getTextEditorByUri(uri);
    const revVisibleRange = irTextEditor.visibleRange;
    irTextEditor.scroll(visibleRange);

    this.pushEvent({
      type: 'scroll',
      clock: this.getClock(),
      uri,
      visibleRange,
      revVisibleRange,
    });
  }

  getRoot(): t.AbsPath | undefined {
    return this.workspace.root;
  }

  getClock(): number {
    if (this.status === t.RecorderStatus.Recording) {
      return (Date.now() - this.startTimeMs) / 1000;
    } else {
      return _.last(this.workspace.session!.events)?.clock ?? 0;
    }
  }

  pushEvent(e: t.PlaybackEvent) {
    if (e.type !== 'scroll') {
      this.scrolling = false;
      this.scrollStartRange = undefined;
    }
    this.workspace.session!.events.push(e);
  }
}

export default Recorder;
