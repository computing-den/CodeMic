import { types as t, path, lib, editorTrack as et, ClockTrackPlayer } from '@codecast/lib';
import VscEditorWorkspace from './vsc_editor_workspace.js';
import { SessionIO } from './session.js';
import * as misc from './misc.js';
import Db, { type WriteOptions } from './db.js';
import * as vscode from 'vscode';
import fs from 'fs';
import _ from 'lodash';
import assert from 'assert';
import { v4 as uuid } from 'uuid';

const SCROLL_LINES_TRIGGER = 2;

class VscEditorTrackRecorder implements t.TrackPlayer {
  name = 'vsc recorder';
  state: t.TrackPlayerState = {
    status: t.TrackPlayerStatus.Init,
    loading: false,
    loaded: false,
    buffering: false,
    seeking: false,
  };
  isRecorder = true;

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

  private clockTrackPlayer = new ClockTrackPlayer(100);
  private disposables: vscode.Disposable[] = [];
  private scrolling: boolean = false;
  private scrollStartRange?: t.Range;

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

  seek(clock: number) {
    assert(this.state.status !== t.TrackPlayerStatus.Error, 'Track has error');

    this.clockTrackPlayer.seek(clock);
    this.onProgress?.(clock);
  }

  setClock(clock: number) {
    this.clockTrackPlayer.setClock(clock);
  }

  extend(clock: number) {
    this.track.clockRange.end = Math.max(clock, this.track.clockRange.end);
    // this.clockTrackPlayer.extend(clock);
  }

  setPlaybackRate(rate: number) {
    this.clockTrackPlayer.setPlaybackRate(rate);
  }

  dispose() {
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
  }

  private clockTrackProgressHandler(clock: number) {
    this.extend(clock);
    this.onProgress?.(clock);
  }

  private textChange(
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

    const irTextDocument = this.openTextDocumentWithUri(vscTextDocument, uri, false);
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
  }

  private openTextDocument(vscTextDocument: vscode.TextDocument) {
    if (!this.workspace.shouldRecordVscUri(vscTextDocument.uri)) return;

    const uri = this.workspace.uriFromVsc(vscTextDocument.uri);
    console.log(`adding openTextDocument for ${uri}`);

    this.openTextDocumentWithUri(vscTextDocument, uri, true);
  }

  private showTextEditor(vscTextEditor: vscode.TextEditor) {
    if (!this.workspace.shouldRecordVscUri(vscTextEditor.document.uri)) return;

    const uri = this.workspace.uriFromVsc(vscTextEditor.document.uri);
    console.log(`adding showTextEditor for ${uri}`);

    const revUri = this.track.activeTextEditor?.document.uri;
    const revSelections = this.track.activeTextEditor?.selections;
    const revVisibleRange = this.track.activeTextEditor?.visibleRange;

    // Possibly inserts an openTextDocument or textChange event if the document wasn't found in internal editorTrack or
    // its contents were different.
    const irTextEditor = this.openTextEditorHelper(vscTextEditor, uri, true);
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
  ): et.TextDocument {
    let irTextDocument = this.track.findTextDocumentByUri(uri);

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
            clock: this.clock,
            uri,
            contentChanges: [{ range, text, revRange, revText }],
          });
        }
      }
    } else {
      irTextDocument = this.workspace.textDocumentFromVsc(vscTextDocument, uri);
      this.track.insertTextDocument(irTextDocument);
      this.pushEvent({
        type: 'openTextDocument',
        clock: this.clock,
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
  private openTextEditorHelper(vscTextEditor: vscode.TextEditor, uri: t.Uri, checkContent: boolean): et.TextEditor {
    const selections = this.workspace.selectionsFromVsc(vscTextEditor.selections);
    const visibleRange = this.workspace.rangeFromVsc(vscTextEditor.visibleRanges[0]);
    const textDocument = this.openTextDocumentWithUri(vscTextEditor.document, uri, checkContent);
    let textEditor = this.track.findTextEditorByUri(textDocument.uri);
    if (!textEditor) {
      textEditor = new et.TextEditor(textDocument, selections, visibleRange);
      this.track.insertTextEditor(textEditor);
    } else {
      textEditor.select(selections, visibleRange);
    }
    return textEditor;
  }

  private updateState(partial: Partial<t.TrackPlayerState>) {
    this.state = { ...this.state, ...partial };
    this.onStateChange?.(this.state);
  }
}

export default VscEditorTrackRecorder;
