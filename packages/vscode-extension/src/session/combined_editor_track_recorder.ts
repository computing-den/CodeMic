import { types as t, path, lib, internalEditorTrackCtrl as ietc, assert } from '@codecast/lib';
import type Session from './session.js';
import config from '../config.js';
import * as vscode from 'vscode';

import _ from 'lodash';

const SCROLL_LINES_TRIGGER = 2;

class CombinedEditorTrackRecorder {
  recording = false;
  onChange?: () => any;
  onError?: (error: Error) => any;

  private session: Session;
  private clock = 0;
  private disposables: vscode.Disposable[] = [];
  private scrolling: boolean = false;
  private scrollStartRange?: t.Range;
  // private lastUri?: t.Uri;
  // private lastPosition?: t.Position;
  private lastLine: number | undefined;

  get internalCtrl(): ietc.InternalEditorTrackCtrl {
    return this.session.ctrls!.internalEditorTrackCtrl;
  }

  constructor(session: Session) {
    this.session = session;
  }

  record() {
    if (this.recording) return;
    this.recording = true;

    // update focus
    this.updateFocus();

    // listen for open document events
    {
      const disposable = vscode.workspace.onDidOpenTextDocument(async vscTextDocument => {
        await this.openTextDocument(vscTextDocument);
      });
      this.disposables.push(disposable);
    }
    // listen for close document events
    {
      const disposable = vscode.workspace.onDidCloseTextDocument(async vscTextDocument => {
        await this.closeTextDocument(vscTextDocument);
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
    this.session.context.extension.subscriptions.push(...this.disposables);
  }

  pause() {
    this.popLastLineFocusIfTrivial();
    this.recording = false;
    this.scrolling = false;
    this.scrollStartRange = undefined;

    this.dispose();
  }

  setClock(clock: number) {
    this.clock = clock;

    if (this.recording) {
      this.updateFocus();
    }
  }

  dispose() {
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
  }

  private updateFocus() {
    const { documents, lines } = this.session.body!.editorTrack.focusTimeline;
    const { activeTextEditor } = this.internalCtrl;
    const activeUri = activeTextEditor?.document.uri;
    const lastDocumentFocus = documents.at(-1);
    const lastLineFocus = lines.at(-1);

    if (activeUri) {
      const sameUri = activeUri === lastDocumentFocus?.uri;
      const currentLine = this.getCurrentLine();
      const sameLine = currentLine !== undefined && currentLine === this.lastLine;

      // If we're on the same uri and the same line, update focus line, otherwise push a new one.
      if (lastLineFocus && sameUri && sameLine) {
        lastLineFocus.clockRange.end = this.clock;
        lastLineFocus.text = this.getCurrentLineText() ?? '';
      } else {
        this.popLastLineFocusIfTrivial();
        lines.push({ text: this.getCurrentLineText() ?? '', clockRange: { start: this.clock, end: this.clock } });
        this.lastLine = currentLine;
      }

      // Update last document focus clockRange.
      if (lastDocumentFocus) {
        lastDocumentFocus.clockRange.end = this.clock;
      }

      // If uri has changed, push a new document focus.
      if (!sameUri) {
        documents.push({ uri: activeUri, clockRange: { start: this.clock, end: this.clock } });
      }
    }
  }

  private getCurrentLineText(): string | undefined {
    const line = this.getCurrentLine();
    if (line !== undefined) {
      return this.internalCtrl.activeTextEditor?.document.lines[line];
    }
  }

  private getCurrentLine(): number | undefined {
    const { activeTextEditor } = this.internalCtrl;
    const selection = activeTextEditor?.selections[0];
    return selection && ietc.getSelectionStart(selection).line;
  }

  // private pushLineFocus() {
  //   const { lines } = this.session.body!.editorTrack.focusTimeline;
  // }

  private popLastLineFocusIfTrivial() {
    const { lines } = this.session.body!.editorTrack.focusTimeline;
    const lastLineFocus = lines.at(-1);
    // const last2LineFocus = lines.at(-1);
    if (!lastLineFocus) return;

    if (lib.getClockRangeDur(lastLineFocus.clockRange) < 3 || lastLineFocus.text.trim().length < 5) {
      lines.pop();
    }
  }

  private async textChange(
    vscTextDocument: vscode.TextDocument,
    vscContentChanges: readonly vscode.TextDocumentContentChangeEvent[],
  ) {
    logRawEvent(`event: textChange ${vscTextDocument.uri} ${JSON.stringify(vscContentChanges)}`);
    if (!this.session.shouldRecordVscUri(vscTextDocument.uri)) return;

    const uri = this.session.uriFromVsc(vscTextDocument.uri);
    if (vscContentChanges.length === 0) {
      console.log(`textChange vscContentChanges for ${uri} is empty`);
      return;
    }

    logAcceptedEvent(`accepted textChange for ${uri}`);

    // Here, we assume that it is possible to get a textChange without a text editor
    // because vscode's event itself does not provide a text editor.

    const irTextDocument = this.internalCtrl.findTextDocumentByUri(uri);
    if (irTextDocument) {
      let debugInitIrText: string | undefined;
      if (config.debug) {
        debugInitIrText = irTextDocument.getText();
      }

      // Read https://github.com/microsoft/vscode/issues/11487 about contentChanges array.
      let irContentChanges = this.session.contentChangesFromVsc(vscContentChanges);

      // Order content changes.
      irContentChanges.sort(ietc.compareContentChanges);

      // Validate ranges and make sure there are no overlaps.
      for (const [i, cc] of irContentChanges.entries()) {
        assert(irTextDocument.isRangeValid(cc.range), 'textChange: invalid range');
        if (i > 0) {
          assert(
            ietc.isRangeNonOverlapping(irContentChanges[i - 1].range, cc.range),
            'textChange: got content changes with overlapping ranges',
          );
        }
      }

      const irRevContentChanges = irTextDocument.applyContentChanges(irContentChanges, true);

      const irTextChangeEvent: t.EditorEvent = {
        type: 'textChange',
        clock: this.clock,
        uri: irTextDocument.uri,
        contentChanges: irContentChanges,
        revContentChanges: irRevContentChanges,
      };
      this.pushEvent(irTextChangeEvent);

      if (config.debug) {
        assert(
          irTextDocument.getText() === vscTextDocument.getText(),
          "textChange: internal text doesn't match vscode text after applying changes",
        );

        const debugNextIrText = irTextDocument.getText();
        await this.internalCtrl.applyTextChangeEvent(irTextChangeEvent, t.Direction.Backwards);
        const debugReInitIrText = irTextDocument.getText();
        assert(
          debugInitIrText === debugReInitIrText,
          "textChange: text doesn't match what it was after applying changes in reverse",
        );

        await this.internalCtrl.applyTextChangeEvent(irTextChangeEvent, t.Direction.Forwards);
        assert(
          debugNextIrText === irTextDocument.getText(),
          "textChange: text doesn't match what it was after applying changes again",
        );
      }
    } else {
      // It will insert the latest text in 'openTextDocument' if necessary.
      await this.openTextDocumentByUri(vscTextDocument, uri);
    }
  }

  private async openTextDocument(vscTextDocument: vscode.TextDocument) {
    logRawEvent(`event: openTextDocument ${vscTextDocument.uri}`);
    if (!this.session.shouldRecordVscUri(vscTextDocument.uri)) return;

    const uri = this.session.uriFromVsc(vscTextDocument.uri);
    logAcceptedEvent(`accepted openTextDocument for ${uri}`);

    await this.openTextDocumentByUri(vscTextDocument, uri);
  }

  private async closeTextDocument(vscTextDocument: vscode.TextDocument) {
    // When user closes a tab without saving it, vscode issues a textChange event
    // to restore the original content before issuing a closeTextDocument

    logRawEvent(`event: closeTextDocument ${vscTextDocument.uri}`);
    if (!this.session.shouldRecordVscUri(vscTextDocument.uri)) return;

    const uri = this.session.uriFromVsc(vscTextDocument.uri);
    let irTextDocument = this.internalCtrl.findTextDocumentByUri(uri);
    const irTextEditor = this.internalCtrl.findTextEditorByUri(uri);

    if (!irTextDocument) return;

    logAcceptedEvent(`accepted closeTextDocument for ${uri}`);

    const revSelections = irTextEditor?.selections;
    const revVisibleRange = irTextEditor?.visibleRange;
    this.internalCtrl.closeTextEditorByUri(uri);
    this.pushEvent({
      type: 'closeTextEditor',
      clock: this.clock,
      uri,
      revSelections,
      revVisibleRange,
    });

    // No reason to remove/close the text document if it's not an untitled.
    if (vscTextDocument.uri.scheme === 'untitled') {
      const revText = irTextDocument.getText();
      this.internalCtrl.closeAndRemoveTextDocumentByUri(uri);
      this.pushEvent({
        type: 'closeTextDocument',
        clock: this.clock,
        uri,
        revText,
        revEol: irTextDocument.eol,
      });
    }
  }

  private async showTextEditor(vscTextEditor: vscode.TextEditor) {
    logRawEvent(`event: showTextEditor ${vscTextEditor.document.uri}`);
    if (!this.session.shouldRecordVscUri(vscTextEditor.document.uri)) return;

    const uri = this.session.uriFromVsc(vscTextEditor.document.uri);
    logAcceptedEvent(`accepted showTextEditor for ${uri}`);

    const revUri = this.internalCtrl.activeTextEditor?.document.uri;
    const revSelections = this.internalCtrl.activeTextEditor?.selections;
    const revVisibleRange = this.internalCtrl.activeTextEditor?.visibleRange;

    // Possibly inserts an openTextDocument or textChange event if the document wasn't found in internal editorTrack or
    // its contents were different.
    const irTextEditor = await this.openTextEditorHelper(vscTextEditor, uri);
    this.internalCtrl.activeTextEditor = irTextEditor;

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
    logRawEvent(`event: select ${vscTextEditor.document.uri} ${JSON.stringify(selections)}`);
    if (!this.session.shouldRecordVscUri(vscTextEditor.document.uri)) return;

    const uri = this.session.uriFromVsc(vscTextEditor.document.uri);
    logAcceptedEvent(
      `accepted select for ${uri} visibleRange: ${vscTextEditor.visibleRanges[0].start.line}:${vscTextEditor.visibleRanges[0].end.line}`,
    );

    const irTextEditor = this.internalCtrl.getTextEditorByUri(uri);
    const revSelections = irTextEditor.selections;
    const revVisibleRanges = irTextEditor.visibleRange;
    irTextEditor.select(
      this.session.selectionsFromVsc(selections),
      this.session.rangeFromVsc(vscTextEditor.visibleRanges[0]),
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
    logRawEvent(`event: saveTextDocument ${vscTextDocument.uri}`);
    if (!this.session.shouldRecordVscUri(vscTextDocument.uri)) return;

    const uri = this.session.uriFromVsc(vscTextDocument.uri);
    logAcceptedEvent(`accepted save for ${uri}`);

    this.pushEvent({
      type: 'save',
      clock: this.clock,
      uri,
    });
  }

  private scroll(vscTextEditor: vscode.TextEditor, visibleRanges: readonly vscode.Range[]) {
    logRawEvent(`event: scroll ${vscTextEditor.document.uri} ${JSON.stringify(visibleRanges)}`);
    if (!this.session.shouldRecordVscUri(vscTextEditor.document.uri)) return;

    const uri = this.session.uriFromVsc(vscTextEditor.document.uri);
    const visibleRange = this.session.rangeFromVsc(visibleRanges[0]);

    if (!this.scrolling) {
      this.scrollStartRange ??= visibleRange;
      const delta = Math.abs(visibleRange.start.line - this.scrollStartRange.start.line);
      if (delta > SCROLL_LINES_TRIGGER) {
        this.scrolling = true;
      }
    }

    if (!this.scrolling) return;

    logAcceptedEvent(`accepted scroll for ${uri} visible range: ${visibleRange.start.line}:${visibleRange.end.line}`);

    const irTextEditor = this.internalCtrl.getTextEditorByUri(uri);
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

    this.session.body!.editorTrack.events.push(e);
    // this.simplifyEvents();
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
   * Assumes a valid uri which has already been approved by this.session.shouldRecordVscUri().
   */
  private async openTextDocumentByUri(vscTextDocument: vscode.TextDocument, uri: t.Uri): Promise<ietc.TextDocument> {
    const isInWorktree = this.internalCtrl.doesUriExist(uri);
    let irTextDocument = this.internalCtrl.findTextDocumentByUri(uri);

    let irText: string | undefined;
    const vscText = vscTextDocument.getText();

    if (isInWorktree) {
      irText = new TextDecoder().decode(await this.internalCtrl.getContentByUri(uri));
    }

    if (irTextDocument && irText !== vscText) {
      const irRange = irTextDocument.getRange();
      const irContentChanges = [{ range: irRange, text: vscText }];
      const irRevContentChanges = irTextDocument.applyContentChanges(irContentChanges, true);
      this.pushEvent({
        type: 'textChange',
        clock: this.clock,
        uri,
        contentChanges: irContentChanges,
        revContentChanges: irRevContentChanges,
      });
    } else if (!irTextDocument) {
      irTextDocument = this.session.textDocumentFromVsc(vscTextDocument, uri);
      this.internalCtrl.insertTextDocument(irTextDocument); // will insert into worktree as well
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
  private async openTextEditorHelper(vscTextEditor: vscode.TextEditor, uri: t.Uri): Promise<ietc.TextEditor> {
    const selections = this.session.selectionsFromVsc(vscTextEditor.selections);
    const visibleRange = this.session.rangeFromVsc(vscTextEditor.visibleRanges[0]);
    const textDocument = await this.openTextDocumentByUri(vscTextEditor.document, uri);
    let textEditor = this.internalCtrl.findTextEditorByUri(textDocument.uri);
    if (!textEditor) {
      textEditor = new ietc.TextEditor(textDocument, selections, visibleRange);
      this.internalCtrl.insertTextEditor(textEditor);
    } else {
      textEditor.select(selections, visibleRange);
    }
    return textEditor;
  }

  // private simplifyEvents() {
  // TODO
  // Remove useless selections by checking internal editor's current selection
  // Merge sequential textChange by checking internal editor's current state.
  // Since we need access to the internal editor, we must not do it here but in the event handlers above.
  //
  // const { events } = this.session.body!.editorTrack;
  // // Remove select events immediately after textChange.
  // {
  //   const [event1, event2] = [events.at(-1), events.at(-2)];
  //   if (
  //     event1 &&
  //     event2 &&
  //     event1.type === 'select' &&
  //     event2.type === 'textChange' &&
  //     event1.clock - event2.clock < 0.1
  //   ) {
  //     events.pop();
  //   }
  // }
  // }
}

function logRawEvent(str: string) {
  if (config.logRecorderRawVscEvents) console.log(str);
}
function logAcceptedEvent(str: string) {
  if (config.logRecorderAcceptedVscEvents) console.log(str);
}

export default CombinedEditorTrackRecorder;
