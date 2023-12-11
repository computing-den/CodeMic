import { types as t, path, lib, editorTrack as et } from '@codecast/lib';
import VscEditorWorkspace from './vsc_editor_workspace.js';
import * as vscode from 'vscode';
import _ from 'lodash';

const SCROLL_LINES_TRIGGER = 2;

class VscEditorRecorder implements t.EditorRecorder {
  isRecording = false;
  onChange?: () => any;
  onError?: (error: Error) => any;

  get track(): et.EditorTrack {
    return this.workspace.editorTrack;
  }

  private clock = 0;
  private disposables: vscode.Disposable[] = [];
  private scrolling: boolean = false;
  private scrollStartRange?: t.Range;

  constructor(public context: vscode.ExtensionContext, public workspace: VscEditorWorkspace) {}

  record() {
    if (this.isRecording) return;
    this.isRecording = true;

    // listen for open document events
    {
      const disposable = vscode.workspace.onDidOpenTextDocument(async vscTextDocument => {
        await this.openTextDocument(vscTextDocument);
      });
      this.disposables.push(disposable);
    }

    // listen for show document events
    {
      const disposable = vscode.window.onDidChangeActiveTextEditor(async vscTextEditor => {
        if (vscTextEditor) await this.showTextEditor(vscTextEditor);
      });
      this.disposables.push(disposable);
    }

    // listen for text change events
    {
      const disposable = vscode.workspace.onDidChangeTextDocument(async e => {
        await this.textChange(e.document, e.contentChanges);
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
    if (!this.isRecording) return;
    this.isRecording = false;

    this.dispose();
  }

  setClock(clock: number) {
    this.clock = clock;
  }

  dispose() {
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
  }

  private async textChange(
    vscTextDocument: vscode.TextDocument,
    vscContentChanges: readonly vscode.TextDocumentContentChangeEvent[],
  ) {
    if (!this.workspace.shouldRecordVscUri(vscTextDocument.uri)) return;

    const uri = this.workspace.uriFromVsc(vscTextDocument.uri);
    console.log(`adding textChange for ${uri}`);

    if (vscContentChanges.length === 0) {
      console.log(`textChange: vscContentChanges for ${uri} is empty`);
      return;
    }

    // Here, we assume that it is possible to get a textChange without a text editor
    // because vscode's event itself does not provide a text editor.

    const irTextDocument = this.track.getTextDocumentByUri(uri);
    if (irTextDocument) {
      const irContentChanges = vscContentChanges.map(({ range: vscRange, text }) => {
        const range = this.workspace.rangeFromVsc(vscRange);
        const [revRange, revText] = irTextDocument.applyContentChange(range, text, true);
        return { range, text, revRange, revText };
      });

      this.pushEvent({
        type: 'textChange',
        clock: this.clock,
        uri: irTextDocument.uri,
        contentChanges: irContentChanges,
      });
    } else {
      // It will insert the latest text in 'openTextDocument' if necessary.
      await this.openTextDocumentByUri(vscTextDocument, uri);
    }
  }

  private async openTextDocument(vscTextDocument: vscode.TextDocument) {
    if (!this.workspace.shouldRecordVscUri(vscTextDocument.uri)) return;

    const uri = this.workspace.uriFromVsc(vscTextDocument.uri);
    console.log(`adding openTextDocument for ${uri}`);

    await this.openTextDocumentByUri(vscTextDocument, uri);
  }

  private async showTextEditor(vscTextEditor: vscode.TextEditor) {
    if (!this.workspace.shouldRecordVscUri(vscTextEditor.document.uri)) return;

    const uri = this.workspace.uriFromVsc(vscTextEditor.document.uri);
    console.log(`adding showTextEditor for ${uri}`);

    const revUri = this.track.activeTextEditor?.document.uri;
    const revSelections = this.track.activeTextEditor?.selections;
    const revVisibleRange = this.track.activeTextEditor?.visibleRange;

    // Possibly inserts an openTextDocument or textChange event if the document wasn't found in internal editorTrack or
    // its contents were different.
    const irTextEditor = await this.openTextEditorHelper(vscTextEditor, uri);
    this.track.activeTextEditor = irTextEditor;

    this.pushEvent({
      type: 'showTextEditor',
      clock: this.clock,
      uri,
      selections: irTextEditor.selections,
      visibleRange: irTextEditor.visibleRange,
      revUri,
      revSelections,
      revVisibleRange,
    });
  }

  private select(vscTextEditor: vscode.TextEditor, selections: readonly vscode.Selection[]) {
    if (!this.workspace.shouldRecordVscUri(vscTextEditor.document.uri)) return;

    const uri = this.workspace.uriFromVsc(vscTextEditor.document.uri);
    console.log(`adding select for ${uri}`);
    console.log(
      `visibleRange: ${vscTextEditor.visibleRanges[0].start.line}:${vscTextEditor.visibleRanges[0].end.line}`,
    );

    const irTextEditor = this.track.getTextEditorByUri(uri);
    const revSelections = irTextEditor.selections;
    const revVisibleRanges = irTextEditor.visibleRange;
    irTextEditor.select(
      this.workspace.selectionsFromVsc(selections),
      this.workspace.rangeFromVsc(vscTextEditor.visibleRanges[0]),
    );

    this.pushEvent({
      type: 'select',
      clock: this.clock,
      uri,
      selections: irTextEditor.selections,
      visibleRange: irTextEditor.visibleRange,
      revSelections,
      revVisibleRange: revVisibleRanges,
    });
  }

  private saveTextDocument(vscTextDocument: vscode.TextDocument) {
    if (!this.workspace.shouldRecordVscUri(vscTextDocument.uri)) return;

    const uri = this.workspace.uriFromVsc(vscTextDocument.uri);
    console.log(`adding save for ${uri}`);

    this.pushEvent({
      type: 'save',
      clock: this.clock,
      uri,
    });
  }

  private scroll(vscTextEditor: vscode.TextEditor, visibleRanges: readonly vscode.Range[]) {
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

    const irTextEditor = this.track.getTextEditorByUri(uri);
    const revVisibleRange = irTextEditor.visibleRange;
    irTextEditor.scroll(visibleRange);

    this.pushEvent({
      type: 'scroll',
      clock: this.clock,
      uri,
      visibleRange,
      revVisibleRange,
    });
  }

  private pushEvent(e: t.EditorEvent) {
    if (e.type !== 'scroll') {
      this.scrolling = false;
      this.scrollStartRange = undefined;
    }
    this.track.events.push(e);
    this.onChange?.();
  }

  /**
   * Inserts an 'openTextDocument' event only if:
   * - item does NOT exist in internal worktree, or
   * - item exists in internal worktree but has no document.
   *
   * The 'openTextDocument' will only have a text field if:
   * - worktree item's content (document or file) is different from that of vscTextDocument.
   *
   * If worktree item has a document but its content is different from that of vscTextDocument,
   * a 'textChange' will be inserted on the entire document.
   *
   * Assumes a valid uri which has already been approved by this.workspace.shouldRecordVscUri().
   */
  private async openTextDocumentByUri(vscTextDocument: vscode.TextDocument, uri: t.Uri): Promise<et.TextDocument> {
    const isInWorktree = this.track.doesUriExist(uri);
    let irTextDocument = this.track.findTextDocumentByUri(uri);

    let irText: string | undefined;
    const vscText = vscTextDocument.getText();

    if (isInWorktree) {
      irText = new TextDecoder().decode(await this.track.getContentByUri(uri));
    }

    if (irTextDocument && irText !== vscText) {
      const irRange = irTextDocument.getRange();
      const [revRange, revText] = irTextDocument.applyContentChange(irRange, vscText, true);
      this.pushEvent({
        type: 'textChange',
        clock: this.clock,
        uri,
        contentChanges: [{ range: irRange, text: vscText, revRange, revText }],
      });
    } else if (!irTextDocument) {
      irTextDocument = this.workspace.textDocumentFromVsc(vscTextDocument, uri);
      this.track.insertTextDocument(irTextDocument); // will insert into worktree as well
      this.pushEvent({
        type: 'openTextDocument',
        clock: this.clock,
        text: irText === vscText ? undefined : vscText,
        uri,
        eol: irTextDocument.eol,
        isInWorktree,
      });
    }

    return irTextDocument;
  }

  /**
   * It does not push a showTextEditor event but it might open the text document.
   * Then, it will create or update the internal text editor.
   */
  private async openTextEditorHelper(vscTextEditor: vscode.TextEditor, uri: t.Uri): Promise<et.TextEditor> {
    const selections = this.workspace.selectionsFromVsc(vscTextEditor.selections);
    const visibleRange = this.workspace.rangeFromVsc(vscTextEditor.visibleRanges[0]);
    const textDocument = await this.openTextDocumentByUri(vscTextEditor.document, uri);
    let textEditor = this.track.findTextEditorByUri(textDocument.uri);
    if (!textEditor) {
      textEditor = new et.TextEditor(textDocument, selections, visibleRange);
      this.track.insertTextEditor(textEditor);
    } else {
      textEditor.select(selections, visibleRange);
    }
    return textEditor;
  }
}

export default VscEditorRecorder;
