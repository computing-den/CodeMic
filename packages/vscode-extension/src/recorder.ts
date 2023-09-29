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

  get session(): ir.Session {
    return this.workspace.session!;
  }

  constructor(
    public context: vscode.ExtensionContext,
    public db: Db,
    public workspace: Workspace,
    private clock: number = 0,
    private lastSavedClock: number = clock,
  ) {}

  /**
   * root must be already resolved.
   */
  static async fromDirAndVsc(context: vscode.ExtensionContext, db: Db, setup: t.RecorderSetup): Promise<Recorder> {
    assert(setup.root);
    const workspace = await Workspace.fromDirAndVsc(setup.sessionSummary, setup.root);
    return new Recorder(context, db, workspace);
  }

  /**
   * root must be already resolved.
   */
  static async populateSession(
    context: vscode.ExtensionContext,
    db: Db,
    { root, sessionSummary, baseSessionSummary, forkClock }: t.RecorderSetup,
  ): Promise<Recorder | undefined> {
    assert(root);
    const clock = forkClock ?? sessionSummary.duration;
    const workspace = await Workspace.populateSession(db, root, sessionSummary, baseSessionSummary, clock, clock);
    return workspace && new Recorder(context, db, workspace, clock);
  }

  /**
   * Always returns a new object; no shared state with base
   */
  static makeSessionSummary(base?: t.SessionSummary, fork?: boolean, forkClock?: number): t.SessionSummary {
    if (base) {
      return {
        ..._.cloneDeep(base),
        id: fork ? uuid() : base.id,
        title: fork ? `Fork: ${base.title}` : base.title,
        duration: forkClock ?? base.duration,
        author: {
          name: 'sean_shir',
          avatar: 'avatar1.png',
        },
        timestamp: new Date().toISOString(), // will be overwritten at the end
        forkedFrom: fork ? base.id : undefined,
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
        this.openTextDocument(vscTextDocument);
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

  async stop() {
    this.pause();
    this.status = t.RecorderStatus.Stopped;
    await this.saveHistoryOpenClose();
  }

  /**
   * May be called without pause() or stop().
   */
  async save() {
    this.session.summary.timestamp = new Date().toISOString();
    await this.db.writeSession(this.session.toJSON(), this.session.summary);
    await this.saveHistoryOpenClose();
    this.lastSavedClock = this.getClock();
  }

  updateState(changes: t.RecorderUpdate) {
    if (changes.title !== undefined) this.session.summary.title = changes.title;
    if (changes.description !== undefined) this.session.summary.description = changes.description;
    if (changes.clock !== undefined) this.session.summary.duration = this.clock = changes.clock;
    if (changes.root !== undefined) throw new Error('Recorder.updateState cannot changes root');
  }

  isSessionEmpty(): boolean {
    return this.session.events.length === 0;
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

    const irTextDocument = this.openTextDocumentWithUri(vscTextDocument, uri, false);
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

  openTextDocument(vscTextDocument: vscode.TextDocument) {
    if (!this.workspace.shouldRecordVscUri(vscTextDocument.uri)) return;

    const uri = this.workspace.uriFromVsc(vscTextDocument.uri);
    console.log(`adding openTextDocument for ${uri}`);

    this.openTextDocumentWithUri(vscTextDocument, uri, true);
  }

  showTextEditor(vscTextEditor: vscode.TextEditor) {
    if (!this.workspace.shouldRecordVscUri(vscTextEditor.document.uri)) return;

    const uri = this.workspace.uriFromVsc(vscTextEditor.document.uri);
    console.log(`adding showTextEditor for ${uri}`);

    const revUri = this.session.activeTextEditor?.document.uri;
    const revSelections = this.session.activeTextEditor?.selections;
    const revVisibleRange = this.session.activeTextEditor?.visibleRange;

    // Possibly inserts an openTextDocument or textChange event if the document wasn't found in internal session or
    // its contents were different.
    const irTextEditor = this.openTextEditorHelper(vscTextEditor, uri, true);
    this.session.activeTextEditor = irTextEditor;

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

    const irTextEditor = this.session.getTextEditorByUri(uri);
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

    const irTextEditor = this.session.getTextEditorByUri(uri);
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
    return this.clock;
    // if (this.status === t.RecorderStatus.Recording) {
    //   return (Date.now() - this.lastStartTimeMs) / 1000 + this.clock;
    // } else {
    //   return this.clock;
    // }
  }

  isDirty(): boolean {
    return this.getClock() > this.lastSavedClock;
  }

  private pushEvent(e: t.PlaybackEvent) {
    if (e.type !== 'scroll') {
      this.scrolling = false;
      this.scrollStartRange = undefined;
    }
    this.session.events.push(e);
  }

  private async saveHistoryOpenClose() {
    this.db.mergeSessionHistory({
      id: this.session.summary.id,
      lastRecordedTimestamp: new Date().toISOString(),
      root: this.workspace.root,
    });
    await this.db.write();
  }

  /**
   * Inserts an 'openTextDocument' event only if session does not have the document open.
   * When checkContent is true, it will compare the content of the vsc text document with that of the internal document
   * and if they are different, it will update internal document and insert a textChange event.
   * Even if openTextDocument was not emitted before, it might still exist in the internal session if it was scanned
   * from the disk.
   * So, 'openTextDocument' event always has the text field since if the document was already in checkpoint, no
   * 'openTextDocument' event would be generated at all.
   * Assumes a valid uri which has already been approved by this.workspace.shouldRecordVscUri().
   */
  private openTextDocumentWithUri(
    vscTextDocument: vscode.TextDocument,
    uri: t.Uri,
    checkContent: boolean,
  ): ir.TextDocument {
    let irTextDocument = this.session.findTextDocumentByUri(uri);

    if (irTextDocument) {
      if (checkContent) {
        const linesMatch =
          irTextDocument.lines.length === vscTextDocument.lineCount &&
          irTextDocument.lines.every((line, i) => line === vscTextDocument.lineAt(i).text);
        if (!linesMatch) {
          // TOOD I think this might happen if the file is changed externally, but maybe vscode automatically
          //      detects that and emits a textChange event, or maybe it'll emit a second openTextDocument.
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
      this.session.textDocuments.push(irTextDocument);
      this.pushEvent({
        type: 'openTextDocument',
        clock: this.getClock(),
        text: vscTextDocument.getText(),
        uri,
        eol: irTextDocument.eol,
      });
    }
    return irTextDocument;
  }

  /**
   * It does not push a showTextEditor event but it might push an 'openTextDocument' or a 'textChange' event.
   */
  private openTextEditorHelper(vscTextEditor: vscode.TextEditor, uri: t.Uri, checkContent: boolean): ir.TextEditor {
    const selections = this.workspace.selectionsFromVsc(vscTextEditor.selections);
    const visibleRange = this.workspace.rangeFromVsc(vscTextEditor.visibleRanges[0]);
    const textDocument = this.openTextDocumentWithUri(vscTextEditor.document, uri, checkContent);
    let textEditor = this.session.findTextEditorByUri(textDocument.uri);
    if (!textEditor) {
      textEditor = new ir.TextEditor(textDocument, selections, visibleRange);
      this.session.textEditors.push(textEditor);
    } else {
      textEditor.select(selections, visibleRange);
    }
    return textEditor;
  }
}

export default Recorder;
