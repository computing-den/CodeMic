import Workspace from './workspace.js';
import * as misc from './misc.js';
import Db, { type WriteOptions } from './db.js';
import { types as t, path, ir, lib } from '@codecast/lib';
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

  constructor(
    public context: vscode.ExtensionContext,
    public db: Db,
    public workspace: Workspace,
    public isDirty: boolean,
    private startTimeMs: number,
  ) {}

  /**
   * root must be already resolved.
   */
  static async fromDirAndVsc(
    context: vscode.ExtensionContext,
    db: Db,
    root: t.AbsPath,
    sessionSummary: t.SessionSummary,
    baseSessionSummary?: t.SessionSummary,
    fork?: boolean,
    forkAtClock?: number,
  ): Promise<Recorder | undefined> {
    assert(forkAtClock === undefined, 'TODO fork at specific time.');

    let workspace: Workspace | undefined;
    let isDirty = true;
    let startTimeMs: number;
    if (baseSessionSummary) {
      forkAtClock ??= sessionSummary.duration;
      workspace = await Workspace.populateSessionSummary(db, sessionSummary, root, forkAtClock);
      isDirty = Boolean(fork);
      startTimeMs = Date.now() - baseSessionSummary.duration * 1000;
    } else {
      workspace = await Workspace.fromDirAndVsc(sessionSummary, root);
      startTimeMs = Date.now();
    }
    return workspace && new Recorder(context, db, workspace, isDirty, startTimeMs);
  }

  static makeSessionSummary(base?: t.SessionSummary, fork?: boolean): t.SessionSummary {
    if (base) {
      return {
        ...base,
        id: fork ? uuid() : base.id,
        author: {
          name: 'sean_shir',
          avatar: 'avatar1.png',
        },
        timestamp: new Date().toISOString(), // will be overwritten at the end
      };
    } else {
      return {
        id: uuid(),
        title: '',
        description: '',
        author: {
          name: 'sean_shir',
          avatar: 'avatar1.png',
        },
        published: false,
        duration: 0,
        views: 0,
        likes: 0,
        timestamp: new Date().toISOString(), // will be overwritten at the end
        toc: [],
      };
    }
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

    await this.saveHistoryOpenClose();
  }

  async pause() {
    this.status = t.RecorderStatus.Paused;
    this.dispose();
  }

  dispose() {
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
  }

  async stop(injectStopEvent: boolean) {
    const lastEvent = _.last(this.workspace.session!.events);
    if (injectStopEvent && lastEvent && lastEvent.type !== 'stop') {
      const clock = this.getClock();
      this.pushEvent({ type: 'stop', clock });
      this.workspace.session!.summary.duration = clock;
      this.workspace.session!.summary.timestamp = new Date().toISOString();
      this.status = t.RecorderStatus.Stopped;
    }
    this.dispose();
    await this.saveHistoryOpenClose();
  }

  async save() {
    // Inform user there was nothing to save
    if (this.isSessionEmpty() || !this.isDirty) {
      vscode.window.showInformationMessage('Nothing to save.');
    } else {
      const session = this.workspace.session!;
      await this.db.writeSession(session.toJSON(), session.summary);
      await this.saveHistoryOpenClose();
      // We can't set isDirty it to false here, because it doesn't inject the stop event.
      // this.isDirty = false;
      vscode.window.showInformationMessage('Saved session.');
    }
  }

  setSessionSummary(sessionSummary: t.SessionSummary) {
    this.isDirty = true;
    this.workspace.session!.summary = sessionSummary;
  }

  isSessionEmpty(): boolean {
    // there must be more than a stop event
    return (
      !this.workspace.session ||
      !this.workspace.session.events.length ||
      this.workspace.session.events[0].type === 'stop'
    );
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

    const irTextDocument = this.openDocumentWithUri(vscTextDocument, uri, false);
    const irContentChanges = vscContentChanges.map(({ range: vscRange, text }) => {
      const range = this.workspace.rangeFromVsc(vscRange);
      const [revRange, revText] = irTextDocument.applyContentChange(range, text, true);
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

    this.openDocumentWithUri(vscTextDocument, uri, true);
  }

  showTextEditor(vscTextEditor: vscode.TextEditor) {
    if (!this.workspace.shouldRecordVscUri(vscTextEditor.document.uri)) return;

    const uri = this.workspace.uriFromVsc(vscTextEditor.document.uri);
    console.log(`adding showTextEditor for ${uri}`);

    const revUri = this.workspace.session!.activeTextEditor?.document.uri;
    const revSelections = this.workspace.session!.activeTextEditor?.selections;
    const revVisibleRange = this.workspace.session!.activeTextEditor?.visibleRange;

    // Possibly inserts an openDocument or textChange event if the document wasn't found in internal session or
    // its contents were different.
    const irTextEditor = this.openTextEditorHelper(vscTextEditor, uri, true);
    this.workspace.session!.activeTextEditor = irTextEditor;

    this.pushEvent({
      type: 'showTextEditor',
      clock: this.getClock(),
      uri,
      selections: irTextEditor.selections,
      visibleRange: irTextEditor.visibleRange,
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

  private pushEvent(e: t.PlaybackEvent) {
    if (e.type !== 'scroll') {
      this.scrolling = false;
      this.scrollStartRange = undefined;
    }
    this.isDirty = true;
    this.workspace.session!.events.push(e);
  }

  private async saveHistoryOpenClose() {
    this.db.mergeSessionHistory({
      id: this.workspace.session!.summary.id,
      lastRecordedTimestamp: new Date().toISOString(),
      root: this.workspace.root,
    });
    await this.db.write();
  }

  /**
   * Inserts an 'openDocument' event only if session does not have the document open.
   * When checkContent is true, it will compare the content of the vsc text document with that of the internal document
   * and if they are different, it will update internal document and insert a textChange event.
   * Even if openDocument was not emitted before, it might still exist in the internal session if it was scanned
   * from the disk.
   * So, 'openDocument' event always has the text field since if the document was already in checkpoint, no
   * 'openDocument' event would be generated at all.
   * Assumes a valid uri which has already been approved by this.workspace.shouldRecordVscUri().
   */
  private openDocumentWithUri(
    vscTextDocument: vscode.TextDocument,
    uri: t.Uri,
    checkContent: boolean,
  ): ir.TextDocument {
    let irTextDocument = this.workspace.session!.findTextDocumentByUri(uri);

    if (irTextDocument) {
      if (checkContent) {
        const linesMatch =
          irTextDocument.lines.length === vscTextDocument.lineCount &&
          irTextDocument.lines.every((line, i) => line === vscTextDocument.lineAt(i).text);
        if (!linesMatch) {
          // TOOD I think this might happen if the file is changed externally, but maybe vscode automatically
          //      detects that and emits a textChange event, or maybe it'll emit a second openDocument.
          //      What if it changed on disk before it was opened in vscode? vscode wouldn't be able to detect changes anyways.

          const range = irTextDocument.getRange();
          const text = vscTextDocument.getText();
          const [revRange, revText] = irTextDocument.applyContentChange(range, text, true);
          this.pushEvent({
            type: 'textChange',
            clock: this.getClock(),
            uri,
            contentChanges: [{ range, text, revRange, revText }],
          });
        }
      }
    } else {
      irTextDocument = this.workspace.textDocumentFromVsc(vscTextDocument, uri);
      this.workspace.session!.textDocuments.push(irTextDocument);
      this.pushEvent({
        type: 'openDocument',
        clock: this.getClock(),
        text: vscTextDocument.getText(),
        uri,
        eol: irTextDocument.eol,
      });
    }
    return irTextDocument;
  }

  /**
   * It does not push a showTextEditor event but it might push an 'openDocument' or a 'textChange' event.
   */
  private openTextEditorHelper(vscTextEditor: vscode.TextEditor, uri: t.Uri, checkContent: boolean): ir.TextEditor {
    const selections = this.workspace.selectionsFromVsc(vscTextEditor.selections);
    const visibleRange = this.workspace.rangeFromVsc(vscTextEditor.visibleRanges[0]);
    const textDocument = this.openDocumentWithUri(vscTextEditor.document, uri, checkContent);
    let textEditor = this.workspace.session!.findTextEditorByUri(textDocument.uri);
    if (!textEditor) {
      textEditor = new ir.TextEditor(textDocument, selections, visibleRange);
      this.workspace.session!.textEditors.push(textEditor);
    } else {
      textEditor.select(selections, visibleRange);
    }
    return textEditor;
  }
}

export default Recorder;
