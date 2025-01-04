import * as t from '../../lib/types.js';
import { Selection, ContentChange } from '../../lib/lib.js';
import * as lib from '../../lib/lib.js';
import InternalWorkspace from './internal_workspace.js';
import InternalTextEditor from './internal_text_editor.js';
import InternalTextDocument from './internal_text_document.js';
import assert from '../../lib/assert.js';
import config from '../config.js';
import vscode from 'vscode';
import _ from 'lodash';
import { LoadedSession } from './session.js';
import VscWorkspace from './vsc_workspace.js';

// const SCROLL_LINES_TRIGGER = 2;

class WorkspaceRecorder {
  recording = false;
  onError?: (error: Error) => any;

  private session: LoadedSession;
  private vscWorkspace: VscWorkspace;
  private clock = 0;
  private disposables: vscode.Disposable[] = [];
  // private scrolling: boolean = false;
  // private scrollStartRange?: Range;
  // private lastUri?: t.Uri;
  // private lastPosition?: Position;
  // private lastLine: number | undefined;

  get internalWorkspace(): InternalWorkspace {
    return this.session.rr.internalWorkspace;
  }

  constructor(session: LoadedSession, vscWorkspace: VscWorkspace) {
    this.session = session;
    this.vscWorkspace = vscWorkspace;
  }

  async record() {
    if (this.recording) return;

    await this.vscWorkspace.sync();

    this.recording = true;

    // update focus
    // this.updateFocus();

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
    // this.isLastLineFocusTrivial();
    this.recording = false;
    // this.scrolling = false;
    // this.scrollStartRange = undefined;

    this.dispose();
  }

  setClock(clock: number) {
    this.clock = clock;

    // if (this.recording) {
    //   this.updateFocus();
    // }
  }

  dispose() {
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
  }

  private setFocus() {
    const irTextEditor = this.internalWorkspace.activeTextEditor;
    if (!irTextEditor) return;

    const cmd = this.session.editor.createSetFocus({
      clock: this.clock,
      uri: irTextEditor.document.uri,
      number: irTextEditor.currentLine,
      text: irTextEditor.currentLineText,
    });
    if (cmd) this.session.editor.applySetFocus(cmd);
  }
  // private updateFocus() {
  //   const { documents, lines } = this.session.body.focusTimeline;
  //   const { activeTextEditor } = this.internalWorkspace;
  //   const activeUri = activeTextEditor?.document.uri;

  //   if (activeUri!) return;

  //   const currentLine = this.getCurrentLine();
  //   const sameUri = activeUri === documents.at(-1)?.uri;
  //   const lastLineFocus = lines.at(-1);
  //   const lastDocumentFocus = documents.at(-1);
  //   const sameLine = currentLine !== undefined && currentLine === lastLineFocus?.number;

  //   // Update or insert line focus.
  //   if (currentLine !== undefined) {
  //     if (sameLine) {
  //     }
  //   }

  //   // If we're on the same uri and the same line, update focus line, otherwise push a new one.
  //   if (lines.length && sameUri && sameLine) {
  //     this.session.editor.updateLineFocusAt(lines.length - 1, {
  //       text: this.getCurrentLineText() ?? '',
  //       clockRange: { start: lastLineFocus.clockRange.start, end: this.clock },
  //     });
  //   } else if (currentLine !== undefined) {
  //     // If last line focus is trivial, remove it before pusing a new one.
  //     if (lines.at(-1) && lib.getClockRangeDur(lines.at(-1)!.clockRange) < 2) {
  //       this.session.editor.deleteLineFocusAt(lines.length - 1);
  //     }
  //     this.session.editor.insertLineFocus({
  //       number: currentLine,
  //       text: this.getCurrentLineText() ?? '',
  //       clockRange: { start: this.clock, end: this.clock },
  //     });
  //   }

  //   // Update last document focus clockRange.
  //   if (lastDocumentFocus) {
  //     this.session.editor.updateDocumentFocusAt(documents.length - 1, {
  //       clockRange: { start: lastDocumentFocus.clockRange.start, end: this.clock },
  //     });
  //   }

  //   // If uri has changed, push a new document focus.
  //   if (!sameUri) {
  //     this.session.editor.insertDocumentFocus({
  //       uri: activeUri,
  //       clockRange: { start: this.clock, end: this.clock },
  //     });
  //   }
  // }

  // private getCurrentLineText(): string | undefined {
  //   const line = this.getCurrentLine();
  //   if (line !== undefined) {
  //     return this.internalWorkspace.activeTextEditor?.document.lines[line];
  //   }
  // }

  // private getCurrentLine(): number | undefined {
  //   const { activeTextEditor } = this.internalWorkspace;
  //   return activeTextEditor?.selections[0]?.active.line;
  // }

  private async textChange(
    vscTextDocument: vscode.TextDocument,
    vscContentChanges: readonly vscode.TextDocumentContentChangeEvent[],
  ) {
    logRawEvent(`event: textChange ${vscTextDocument.uri} ${JSON.stringify(vscContentChanges)}`);
    if (!this.vscWorkspace.shouldRecordVscUri(vscTextDocument.uri)) return;

    const uri = this.vscWorkspace.uriFromVsc(vscTextDocument.uri);
    if (vscContentChanges.length === 0) {
      console.log(`textChange vscContentChanges for ${uri} is empty`);
      return;
    }

    logAcceptedEvent(`accepted textChange for ${uri}`);

    // Here, we assume that it is possible to get a textChange without a text editor
    // because vscode's event itself does not provide a text editor.

    const irTextDocument = this.internalWorkspace.findTextDocumentByUri(uri);
    if (irTextDocument) {
      let debugInitIrText: string | undefined;
      if (config.debug) {
        debugInitIrText = irTextDocument.getText();
      }

      // Read https://github.com/microsoft/vscode/issues/11487 about contentChanges array.
      let irContentChanges = vscContentChanges.map(c => new ContentChange(c.text, VscWorkspace.fromVscRange(c.range)));

      // Order content changes.
      irContentChanges.sort((a, b) => a.range.start.compareTo(b.range.start));

      // Validate ranges and make sure there are no overlaps.
      for (const [i, cc] of irContentChanges.entries()) {
        assert(irTextDocument.isRangeValid(cc.range), 'textChange: invalid range');
        if (i > 0) {
          assert(
            cc.range.start.isAfterOrEqual(irContentChanges[i - 1].range.end),
            // ih.isRangeNonOverlapping(irContentChanges[i - 1].range, cc.range),
            'textChange: got content changes with overlapping ranges',
          );
        }
      }

      const irRevContentChanges = irTextDocument.applyContentChanges(irContentChanges, true);

      let coalescing = false;

      // Try to simplify it to textInsert event when:
      // - There is only one cursor: only one content change.
      // - No text is replaced: the range's start and end are the same.
      let irEvent: t.EditorEvent;
      if (irContentChanges.length === 1 && irContentChanges[0].range.start.isEqual(irContentChanges[0].range.end)) {
        // example:
        // contentChanges:    [{"text":"a\nb","range":{"start":{"line":0,"character":5},"end":{"line":0,"character":5}}}]
        // revContentChanges: [{"range":{"start":{"line":0,"character":5},"end":{"line":1,"character":1}},"text":""}]
        irEvent = {
          type: 'textInsert',
          clock: this.clock,
          revRange: irRevContentChanges[0].range, // range.start is the position before text insert, while range.end is the position after text insert
          text: irContentChanges[0].text,
          updateSelection: false,
        };

        coalescing = true;

        // console.log('XXX textInsert:', irEvent);
        // console.log('XXX equivalent textChange:', lib.getTextChangeEventFromTextInsertEvent(irEvent));
        // console.log('XXX expected textChange:', {
        //   type: 'textChange',
        //   clock: this.clock,
        //   contentChanges: irContentChanges,
        //   revContentChanges: irRevContentChanges,
        //   updateSelection: false,
        // });
      } else {
        irEvent = {
          type: 'textChange',
          clock: this.clock,
          contentChanges: irContentChanges,
          revContentChanges: irRevContentChanges,
          updateSelection: false,
        };
      }

      this.insertEvent(irEvent, uri, { coalescing });
      this.setFocus();

      // DEBUG
      if (config.debug) {
        assert(
          irTextDocument.getText() === vscTextDocument.getText(),
          "textChange: internal text doesn't match vscode text after applying changes",
        );

        const debugNextIrText = irTextDocument.getText();
        await this.internalWorkspace.stepper.applyEditorEvent(irEvent, uri, t.Direction.Backwards);
        const debugReInitIrText = irTextDocument.getText();
        assert(
          debugInitIrText === debugReInitIrText,
          "textChange: text doesn't match what it was after applying changes in reverse",
        );

        await this.internalWorkspace.stepper.applyEditorEvent(irEvent, uri, t.Direction.Forwards);
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
    if (!this.vscWorkspace.shouldRecordVscUri(vscTextDocument.uri)) return;

    const uri = this.vscWorkspace.uriFromVsc(vscTextDocument.uri);
    logAcceptedEvent(`accepted openTextDocument for ${uri}`);

    await this.openTextDocumentByUri(vscTextDocument, uri);
  }

  private async closeTextDocument(vscTextDocument: vscode.TextDocument) {
    // When user closes a tab without saving it, vscode issues a textChange event
    // to restore the original content before issuing a closeTextDocument

    logRawEvent(`event: closeTextDocument ${vscTextDocument.uri}`);
    if (!this.vscWorkspace.shouldRecordVscUri(vscTextDocument.uri)) return;

    const uri = this.vscWorkspace.uriFromVsc(vscTextDocument.uri);
    let irTextDocument = this.internalWorkspace.findTextDocumentByUri(uri);
    const irTextEditor = this.internalWorkspace.findTextEditorByUri(uri);

    if (!irTextDocument) return;

    logAcceptedEvent(`accepted closeTextDocument for ${uri}`);

    const revSelections = irTextEditor?.selections;
    const revVisibleRange = irTextEditor?.visibleRange;
    this.internalWorkspace.closeTextEditorByUri(uri);
    this.insertEvent(
      {
        type: 'closeTextEditor',
        clock: this.clock,
        revSelections,
        revVisibleRange,
      },
      uri,
      { coalescing: false },
    );

    // No reason to remove/close the text document if it's not an untitled.
    if (vscTextDocument.uri.scheme === 'untitled') {
      const revText = irTextDocument.getText();
      this.internalWorkspace.closeAndRemoveTextDocumentByUri(uri);
      this.insertEvent(
        {
          type: 'closeTextDocument',
          clock: this.clock,
          revText,
          revEol: irTextDocument.eol,
        },
        uri,
        { coalescing: true },
      );
    }
  }

  private async showTextEditor(vscTextEditor: vscode.TextEditor) {
    logRawEvent(`event: showTextEditor ${vscTextEditor.document.uri}`);
    if (!this.vscWorkspace.shouldRecordVscUri(vscTextEditor.document.uri)) return;

    const uri = this.vscWorkspace.uriFromVsc(vscTextEditor.document.uri);
    logAcceptedEvent(`accepted showTextEditor for ${uri}`);

    const revUri = this.internalWorkspace.activeTextEditor?.document.uri;
    const revSelections = this.internalWorkspace.activeTextEditor?.selections;
    const revVisibleRange = this.internalWorkspace.activeTextEditor?.visibleRange;

    // Possibly inserts an openTextDocument or textChange event if the document wasn't found in internal editorTrack or
    // its contents were different.
    const irTextEditor = await this.openTextEditorHelper(vscTextEditor, uri);
    this.internalWorkspace.activeTextEditor = irTextEditor;

    this.insertEvent(
      {
        type: 'showTextEditor',
        preserveFocus: false,
        clock: this.clock,
        selections: irTextEditor.selections,
        visibleRange: irTextEditor.visibleRange,
        revUri,
        revSelections,
        revVisibleRange,
      },
      uri,
      { coalescing: false },
    );
    this.setFocus();
  }

  private select(vscTextEditor: vscode.TextEditor, vscSelections: readonly vscode.Selection[]) {
    const selections = VscWorkspace.fromVscSelections(vscSelections);
    logRawEvent(`event: select ${vscTextEditor.document.uri} ${JSON.stringify(selections)}`);
    if (!this.vscWorkspace.shouldRecordVscUri(vscTextEditor.document.uri)) return;

    // const visibleRange = VscWorkspace.fromVscRange(vscTextEditor.visibleRanges[0]);
    const uri = this.vscWorkspace.uriFromVsc(vscTextEditor.document.uri);

    const irTextEditor = this.internalWorkspace.findTextEditorByUri(uri);

    if (!irTextEditor) {
      this.showTextEditor(vscTextEditor); // Will insert selection too.
      return;
    }

    const lastEvent = this.session.body.eventContainer.getTrack(uri)?.at(-1);
    const revSelections = irTextEditor.selections;
    irTextEditor.select(selections);

    // Avoid inserting unnecessary select event if the selections can be calculated
    // from the last textChange event.
    if (lastEvent?.type === 'textChange' && lastEvent.clock > this.clock - 1) {
      const calculatedSelections = lib.getSelectionsAfterTextChangeEvent(lastEvent);
      const calculatedRevSelections = lib.getSelectionsBeforeTextChangeEvent(lastEvent);
      if (
        Selection.areEqual(calculatedSelections, irTextEditor.selections) &&
        Selection.areEqual(calculatedRevSelections, revSelections)
      ) {
        const cmd = this.session.editor.createUpdateTrackLastEvent(uri, { updateSelection: true });
        if (cmd) this.session.editor.applyUpdateTrackLastEvent(cmd);
        this.setFocus();
        return;
      }
    }

    // Avoid inserting unnecessary select event if the selections can be calculated
    // from the last textInsert event.
    if (lastEvent?.type === 'textInsert' && lastEvent.clock > this.clock - 1) {
      const calculatedSelections = lib.getSelectionsAfterTextInsertEvent(lastEvent);
      const calculatedRevSelections = lib.getSelectionsBeforeTextInsertEvent(lastEvent);
      if (
        Selection.areEqual(calculatedSelections, irTextEditor.selections) &&
        Selection.areEqual(calculatedRevSelections, revSelections)
      ) {
        const cmd = this.session.editor.createUpdateTrackLastEvent(uri, { updateSelection: true });
        if (cmd) this.session.editor.applyUpdateTrackLastEvent(cmd);
        this.setFocus();
        return;
      }
    }

    // Merge successive select events.
    if (lastEvent?.type === 'select' && lastEvent.clock > this.clock - 0.5) {
      logAcceptedEvent(`accepted select for ${uri} (SHORTCUT)`);
      const cmd = this.session.editor.createUpdateTrackLastEvent(uri, { selections });
      if (cmd) this.session.editor.applyUpdateTrackLastEvent(cmd);
      this.setFocus();
      return;
    }

    logAcceptedEvent(`accepted select for ${uri}`);

    this.insertEvent(
      {
        type: 'select',
        clock: this.clock,
        selections,
        revSelections,
      },
      uri,
      { coalescing: false },
    );
    this.setFocus();
  }

  private saveTextDocument(vscTextDocument: vscode.TextDocument) {
    logRawEvent(`event: saveTextDocument ${vscTextDocument.uri}`);
    if (!this.vscWorkspace.shouldRecordVscUri(vscTextDocument.uri)) return;

    const uri = this.vscWorkspace.uriFromVsc(vscTextDocument.uri);
    logAcceptedEvent(`accepted save for ${uri}`);

    this.insertEvent(
      {
        type: 'save',
        clock: this.clock,
      },
      uri,
      { coalescing: false },
    );
  }

  private scroll(vscTextEditor: vscode.TextEditor, vscVisibleRanges: readonly vscode.Range[]) {
    const visibleRanges = vscVisibleRanges.map(VscWorkspace.fromVscLineRange);
    logRawEvent(`event: scroll ${vscTextEditor.document.uri} ${JSON.stringify(visibleRanges)}`);
    if (!this.vscWorkspace.shouldRecordVscUri(vscTextEditor.document.uri)) return;

    const visibleRange = visibleRanges[0];
    const uri = this.vscWorkspace.uriFromVsc(vscTextEditor.document.uri);
    const irTextEditor = this.internalWorkspace.findTextEditorByUri(uri);
    if (!irTextEditor) {
      this.showTextEditor(vscTextEditor); // Will insert selection.
      return;
    }

    // if (!this.scrolling) {
    //   this.scrollStartRange ??= visibleRange;
    //   const delta = Math.abs(visibleRange.start.line - this.scrollStartRange.start.line);
    //   if (delta > SCROLL_LINES_TRIGGER) {
    //     this.scrolling = true;
    //   }
    // }

    // if (!this.scrolling) return;

    // Avoid redundant scrolls.
    if (irTextEditor.visibleRange.isEqual(visibleRange)) return;

    const revVisibleRange = irTextEditor.visibleRange;
    irTextEditor.scroll(visibleRange);

    // Merge successive scrolls.
    const lastEvent = this.session.body.eventContainer.getTrack(uri)?.at(-1);
    if (lastEvent?.type === 'scroll' && lastEvent.clock > this.clock - 0.5) {
      logAcceptedEvent(
        `accepted scroll for ${uri} visible range: ${visibleRange.start}:${visibleRange.end} (SHORTCUT)`,
      );
      const cmd = this.session.editor.createUpdateTrackLastEvent(uri, { visibleRange });
      if (cmd) this.session.editor.applyUpdateTrackLastEvent(cmd);
      return;
    }

    logAcceptedEvent(`accepted scroll for ${uri} visible range: ${visibleRange.start}:${visibleRange.end}`);

    this.insertEvent(
      {
        type: 'scroll',
        clock: this.clock,
        visibleRange,
        revVisibleRange,
      },
      uri,
      { coalescing: true },
    );
  }

  private insertEvent(e: t.EditorEvent, uri: string, opts: { coalescing: boolean }) {
    // if (e.type !== 'scroll') {
    //   this.scrolling = false;
    //   this.scrollStartRange = undefined;
    // }

    const cmd = this.session.editor.createInsertEvent(e, uri, opts);
    this.session.editor.applyInsertEvent(cmd);
    // this.onChange?.();
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
   * Assumes a valid uri which has already been approved by this.vscWorkspace.shouldRecordVscUri().
   */
  private async openTextDocumentByUri(
    vscTextDocument: vscode.TextDocument,
    uri: string,
  ): Promise<InternalTextDocument> {
    const isInWorktree = this.internalWorkspace.doesUriExist(uri);
    let irTextDocument = this.internalWorkspace.findTextDocumentByUri(uri);

    let irText: string | undefined;
    const vscText = vscTextDocument.getText();

    if (isInWorktree) {
      irText = new TextDecoder().decode(await this.internalWorkspace.getContentByUri(uri));
    }

    if (irTextDocument && irText !== vscText) {
      const irRange = irTextDocument.getRange();
      const irContentChanges: ContentChange[] = [{ range: irRange, text: vscText }];
      const irRevContentChanges = irTextDocument.applyContentChanges(irContentChanges, true);
      this.insertEvent(
        {
          type: 'textChange',
          clock: this.clock,
          contentChanges: irContentChanges,
          revContentChanges: irRevContentChanges,
          updateSelection: false,
        },
        uri,
        { coalescing: false },
      );
    } else if (!irTextDocument) {
      irTextDocument = this.vscWorkspace.textDocumentFromVsc(vscTextDocument, uri);
      this.internalWorkspace.insertTextDocument(irTextDocument); // will insert into worktree as well
      this.insertEvent(
        {
          type: 'openTextDocument',
          clock: this.clock,
          text: irText === vscText ? undefined : vscText,
          eol: irTextDocument.eol,
          isInWorktree,
        },
        uri,
        { coalescing: false },
      );
    }

    return irTextDocument;
  }

  /**
   * It does not push a showTextEditor event but it might open the text document.
   * Then, it will create or update the internal text editor.
   */
  private async openTextEditorHelper(vscTextEditor: vscode.TextEditor, uri: string): Promise<InternalTextEditor> {
    const selections = VscWorkspace.fromVscSelections(vscTextEditor.selections);
    const visibleRange = VscWorkspace.fromVscLineRange(vscTextEditor.visibleRanges[0]);
    const textDocument = await this.openTextDocumentByUri(vscTextEditor.document, uri);
    let textEditor = this.internalWorkspace.findTextEditorByUri(textDocument.uri);
    if (!textEditor) {
      textEditor = new InternalTextEditor(textDocument, selections, visibleRange);
      this.internalWorkspace.insertTextEditor(textEditor);
    } else {
      textEditor.select(selections);
      textEditor.scroll(visibleRange);
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

export default WorkspaceRecorder;
