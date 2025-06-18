/**
 * When saving an untitled document to disk, VSCode first opens the document, changes its content,
 * possibly issue a showTextEditor, then maybe (!) writes the document to disk.
 * Here's the order of events when saving Untitled-1 to "New stuff.perl":
 *
 * openTextDocument "New stuff.perl"
 * textChange "New stuff.perl" with WHOLE CONTENT from untitled on range [0, 0, 0, 0]
 * fsCreate "New stuff.perl"
 *
 * textChange "Untitled-1" WHOLE RANGE to ""
 * select "Untitled-1" [0, 0, 0, 0]
 * scroll "Untitled-1" [0, 0]
 * closeTextEditor "Untitled-1"
 *
 * showTextEditor "New stuff.perl"
 * select "New stuff.perl" to what it was in untitled
 *
 * This order is not stable. Another time I ran it and fsCreate was issued last.
 *
 * But we cannot actually replay this sequence of events in vscode because it's not
 * possible to open a text document with file uri if the file doesn't exist on disk.
 * So, during recording, we have to issue an fsCreate event ourselves possibly with
 * empty content. Essentially reversing the order of events.
 */

import * as t from '../../lib/types.js';
import { Selection, ContentChange } from '../../lib/lib.js';
import * as lib from '../../lib/lib.js';
import InternalWorkspace from './internal_workspace.js';
import assert from '../../lib/assert.js';
import config from '../config.js';
import vscode from 'vscode';
import _ from 'lodash';
import { LoadedSession } from './session.js';
import VscWorkspace from './vsc_workspace.js';
import * as misc from '../misc.js';
import * as fs from 'fs';

// const SCROLL_LINES_TRIGGER = 2;

class WorkspaceRecorder {
  recording = false;
  // onError?: (error: Error) => any;

  private session: LoadedSession;

  private internalWorkspace: InternalWorkspace;
  private vscWorkspace: VscWorkspace;

  private disposables: vscode.Disposable[] = [];
  // private scrolling: boolean = false;
  // private scrollStartRange?: Range;
  // private lastUri?: t.Uri;
  // private lastPosition?: Position;
  // private lastLine: number | undefined;

  // private textDocumentsUrisBeingCreated = new Set<string>();

  private get clock(): number {
    return this.session.rr.clock;
  }

  constructor(session: LoadedSession, internalWorkspace: InternalWorkspace, vscWorkspace: VscWorkspace) {
    this.session = session;
    this.internalWorkspace = internalWorkspace;
    this.vscWorkspace = vscWorkspace;
  }

  async record() {
    if (this.recording) return;

    this.recording = true;

    // update focus
    // this.updateFocus();

    // {
    //   const disposable = vscode.window.tabGroups.onDidChangeTabGroups(async tabGroupChangeEvent => {
    //     console.log('onDidChangeTabGroups');
    //   });
    //   this.disposables.push(disposable);
    // }

    // Listen to tabs opening/closing/changing.
    {
      const disposable = vscode.window.tabGroups.onDidChangeTabs(async tabChangeEvent => {
        await this.changeTabs(tabChangeEvent);
      });
      this.disposables.push(disposable);
    }

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

    // listen for show text editor events
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

    // NOTE: We now listen to file changes. So no need for listening to save event.
    // listen for save events
    // {
    //   const disposable = vscode.workspace.onDidSaveTextDocument(vscTextDocument => {
    //     this.saveTextDocument(vscTextDocument);
    //   });
    //   this.disposables.push(disposable);
    // }

    // listen for scroll events
    {
      const disposable = vscode.window.onDidChangeTextEditorVisibleRanges(e => {
        this.scroll(e.textEditor, e.visibleRanges);
      });
      this.disposables.push(disposable);
    }

    // listen for filesystem events
    {
      const watcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(this.session.workspace, '**/*'),
      );
      watcher.onDidCreate(uri => this.fsCreate(uri));
      watcher.onDidChange(uri => this.fsChange(uri));
      watcher.onDidDelete(uri => this.fsDelete(uri));
      this.disposables.push(watcher);
    }

    // register disposables
    this.session.context.extension.subscriptions.push(...this.disposables);

    // update or create focus
    this.setFocus();
  }

  pause() {
    // this.isLastLineFocusTrivial();
    this.recording = false;
    // this.scrolling = false;
    // this.scrollStartRange = undefined;

    this.dispose();
  }

  // setClock(clock: number) {
  //   this.clock = clock;

  //   // if (this.recording) {
  //   //   this.updateFocus();
  //   // }
  // }

  dispose() {
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
  }

  private setFocus() {
    const irTextEditor = this.internalWorkspace.activeTextEditor;
    if (!irTextEditor) return;

    this.session.editor.setFocus(
      {
        clock: this.clock,
        uri: irTextEditor.document.uri,
        number: irTextEditor.currentLine,
        text: irTextEditor.currentLineText,
      },
      irTextEditor.document.isEmpty,
    );
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
    // See the top of the file for explanation.

    logRawEvent(`event: textChange ${vscTextDocument.uri} ${JSON.stringify(vscContentChanges)}`);
    if (!this.vscWorkspace.shouldRecordVscUri(vscTextDocument.uri)) return;

    const uri = this.vscWorkspace.uriFromVsc(vscTextDocument.uri);
    if (vscContentChanges.length === 0) {
      console.log(`textChange vscContentChanges for ${uri} is empty`);
      return;
    }

    logAcceptedEvent(`accepted textChange for ${uri}`);

    // Here, we assume that document must exist internally by the time we get a text change event.
    const irTextDocument = this.internalWorkspace.getTextDocumentByUri(uri);

    // // It will insert the latest text in 'openTextDocument' if necessary.
    // if (!irTextDocument) {
    //   await this.openTextDocumentByUri(vscTextDocument, uri);
    //   return;
    // }

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
        id: lib.nextId(),
        uri,
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
        id: lib.nextId(),
        uri,
        clock: this.clock,
        contentChanges: irContentChanges,
        revContentChanges: irRevContentChanges,
        updateSelection: false,
      };
    }

    this.insertEvent(irEvent, { coalescing });
    this.setFocus();

    // DEBUG
    if (config.debug) {
      assert(
        irTextDocument.getText() === vscTextDocument.getText(),
        "textChange: internal text doesn't match vscode text after applying changes",
      );

      const debugNextIrText = irTextDocument.getText();
      await this.internalWorkspace.stepper.applyEditorEvent(irEvent, t.Direction.Backwards);
      const debugReInitIrText = irTextDocument.getText();
      assert(
        debugInitIrText === debugReInitIrText,
        "textChange: text doesn't match what it was after applying changes in reverse",
      );

      await this.internalWorkspace.stepper.applyEditorEvent(irEvent, t.Direction.Forwards);
      assert(
        debugNextIrText === irTextDocument.getText(),
        "textChange: text doesn't match what it was after applying changes again",
      );
    }
  }

  private async changeTabs(tabChangeEvent: vscode.TabChangeEvent) {
    logRawEvent(`event: changeTabs`);
    // Collect the URIs that have been closed and no other instance of them
    // exist in the currently opened tabs.
    const existingUris = this.vscWorkspace.getRelevantTabVscUris();
    const closedUris: vscode.Uri[] = [];
    for (let tab of tabChangeEvent.closed) {
      if (tab.input instanceof vscode.TabInputText) {
        const uri = tab.input.uri;
        if (
          this.vscWorkspace.shouldRecordVscUri(uri) &&
          !existingUris.some(eUri => eUri.toString() === uri.toString())
        ) {
          closedUris.push(tab.input.uri);
        }
      }
    }

    if (closedUris.length === 0) return;

    const uris = closedUris.map(uri => this.vscWorkspace.uriFromVsc(uri));
    for (const uri of uris) {
      logAcceptedEvent(`accepted closeTextEditor for ${uri}`);
      const irTextEditor = this.internalWorkspace.findTextEditorByUri(uri);
      const revSelections = irTextEditor?.selections;
      const revVisibleRange = irTextEditor?.visibleRange;
      const active = Boolean(irTextEditor && this.internalWorkspace.activeTextEditor === irTextEditor);
      this.internalWorkspace.closeTextEditorByUri(uri);
      this.insertEvent(
        {
          type: 'closeTextEditor',
          id: lib.nextId(),
          uri,
          clock: this.clock,
          active,
          revSelections,
          revVisibleRange,
        },
        { coalescing: false },
      );
    }
  }

  private async openTextDocument(vscTextDocument: vscode.TextDocument) {
    // See the top of the file for explanation.

    logRawEvent(`event: openTextDocument ${vscTextDocument.uri}`);
    if (!this.vscWorkspace.shouldRecordVscUri(vscTextDocument.uri)) return;

    const uri = this.vscWorkspace.uriFromVsc(vscTextDocument.uri);
    let irItem = this.internalWorkspace.findWorktreeItemByUri(uri);

    if (!irItem) {
      // When saving untitled, vscode issues an openTextDocument before fsCreate.
      // So, here, we issue our own fsCreate and insert an empty file.
      this.insertEvent(
        {
          type: 'fsCreate',
          id: lib.nextId(),
          uri,
          clock: this.clock,
          file: { type: 'empty' },
        },
        { coalescing: false },
      );

      // Insert internal file.
      irItem = this.internalWorkspace.insertOrUpdateFile(uri, { type: 'empty' });
    }

    logAcceptedEvent(`accepted openTextDocument for ${uri}`);

    // Insert internal document.
    const irItemAlreadyHadDocument = Boolean(irItem.document);
    if (!irItemAlreadyHadDocument) {
      const irTextDocument = this.vscWorkspace.textDocumentFromVsc(vscTextDocument, uri);
      this.internalWorkspace.insertTextDocument(irTextDocument);
      this.insertEvent(
        {
          type: 'openTextDocument',
          id: lib.nextId(),
          uri,
          clock: this.clock,
          eol: irTextDocument.eol,
        },
        { coalescing: false },
      );
    }

    // irItem must have a document by now.
    assert(irItem.document);

    // If irText is not the same as vscText, insert textChange.
    // I don't really know when this is supposed to happen. So, for now, let's assert
    // it until we find a use case for it.
    const irText = new TextDecoder().decode(irItem.document.getContent());
    const vscText = vscTextDocument.getText();
    assert(
      irText === vscText,
      `openTextDocument ${uri} has different content.\nInternally:\n\n${irText}\n\nIn Vscode:\n\n${vscText}\n\n`,
    );
    // if (irText !== vscText) {
    //   const irRange = irTextDocument.getRange();
    //   const irContentChanges: ContentChange[] = [{ range: irRange, text: vscText }];
    //   const irRevContentChanges = irTextDocument.applyContentChanges(irContentChanges, true);
    //   this.insertEvent(
    //     {
    //       type: 'textChange',
    //       id: lib.nextId(),
    //       uri,
    //       clock: this.clock,
    //       contentChanges: irContentChanges,
    //       revContentChanges: irRevContentChanges,
    //       updateSelection: false,
    //     },
    //     { coalescing: !irItemAlreadyHadDocument },
    //   );
    // }
  }

  private async closeTextDocument(vscTextDocument: vscode.TextDocument) {
    // NOTE: We're using onDidChangeTabs to record closeTextEditor and not
    // recording closeTextDocument. Text documents only get closed if their
    // files get deleted. This is mostly because of how languageId change behaves.
    //
    // When user closes a tab without saving it, vscode issues a textChange event
    // to restore the original content before issuing a closeTextDocument
    // This also happens for untitled documents when closed without saving.
    //
    // When the languageId of a document changes (may happen automatically),
    // vscode will close the document and reopen it. If we actually close and
    // remove the document internally, we'd lose its unsaved content while vscode
    // retains the content.
    //
    // When user closes the document without saving, vscode
    // first issues a text change event to empty the content.
    //
    //
    //
    // logRawEvent(`event: closeTextDocument ${vscTextDocument.uri}`);
    // if (!this.vscWorkspace.shouldRecordVscUri(vscTextDocument.uri)) return;
    // const uri = this.vscWorkspace.uriFromVsc(vscTextDocument.uri);
    // let irTextDocument = this.internalWorkspace.findTextDocumentByUri(uri);
    // const irTextEditor = this.internalWorkspace.findTextEditorByUri(uri);
    // if (!irTextDocument) return;
    // logAcceptedEvent(`accepted closeTextDocument for ${uri}`);
    // const revSelections = irTextEditor?.selections;
    // const revVisibleRange = irTextEditor?.visibleRange;
    // this.internalWorkspace.closeTextEditorByUri(uri);
    // this.insertEvent(
    //   {
    //     type: 'closeTextEditor',
    //     clock: this.clock,
    //     revSelections,
    //     revVisibleRange,
    //   },
    //   uri,
    //   { coalescing: false },
    // );
    //
    //
    //
    //
    // if (vscTextDocument.uri.scheme === 'untitled') {
    //   const revText = irTextDocument.getText();
    //   this.internalWorkspace.closeAndRemoveTextDocumentByUri(uri);
    //   this.insertEvent(
    //     {
    //       type: 'closeTextDocument',
    //       clock: this.clock,
    //       revText,
    //       revEol: irTextDocument.eol,
    //     },
    //     uri,
    //     { coalescing: true },
    //   );
    // }
  }

  private async showTextEditor(vscTextEditor: vscode.TextEditor) {
    logRawEvent(`event: showTextEditor ${vscTextEditor.document.uri}`);
    if (!this.vscWorkspace.shouldRecordVscUri(vscTextEditor.document.uri)) return;

    const uri = this.vscWorkspace.uriFromVsc(vscTextEditor.document.uri);
    logAcceptedEvent(`accepted showTextEditor for ${uri}`);

    const revUri = this.internalWorkspace.activeTextEditor?.document.uri;

    // revSelections and revVisibleRange refer to the uri text editor, not revUri.
    const revTextEditor = this.internalWorkspace.findTextEditorByUri(uri);
    const revSelections = revTextEditor?.selections;
    const revVisibleRange = revTextEditor?.visibleRange;

    const selections = VscWorkspace.fromVscSelections(vscTextEditor.selections);
    const visibleRange = VscWorkspace.fromVscLineRange(vscTextEditor.visibleRanges[0]);
    const textEditor = await this.internalWorkspace.openTextEditorByUri(uri, selections, visibleRange);
    this.internalWorkspace.activeTextEditor = textEditor;

    this.insertEvent(
      {
        type: 'showTextEditor',
        id: lib.nextId(),
        uri,
        clock: this.clock,
        selections,
        visibleRange,
        revUri,
        revSelections,
        revVisibleRange,
      },
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
    const irTextEditor = this.internalWorkspace.getTextEditorByUri(uri);

    const lastEventIndex = this.session.body.editorEvents.length - 1;
    const lastEvent = this.session.body.editorEvents[lastEventIndex];
    const revSelections = irTextEditor.selections;
    irTextEditor.select(selections);

    // Avoid inserting unnecessary select event if the selections can be calculated
    // from the last textChange event.
    if (lastEvent?.uri === uri && lastEvent.type === 'textChange' && lastEvent.clock > this.clock - 1) {
      const calculatedSelections = lib.getSelectionsAfterTextChangeEvent(lastEvent);
      const calculatedRevSelections = lib.getSelectionsBeforeTextChangeEvent(lastEvent);
      if (
        Selection.areEqual(calculatedSelections, irTextEditor.selections) &&
        Selection.areEqual(calculatedRevSelections, revSelections)
      ) {
        this.session.editor.updateEventAt({ updateSelection: true }, lastEventIndex);
        this.setFocus();
        return;
      }
    }

    // Avoid inserting unnecessary select event if the selections can be calculated
    // from the last textInsert event.
    if (lastEvent?.uri === uri && lastEvent.type === 'textInsert' && lastEvent.clock > this.clock - 1) {
      const calculatedSelections = lib.getSelectionsAfterTextInsertEvent(lastEvent);
      const calculatedRevSelections = lib.getSelectionsBeforeTextInsertEvent(lastEvent);
      if (
        Selection.areEqual(calculatedSelections, irTextEditor.selections) &&
        Selection.areEqual(calculatedRevSelections, revSelections)
      ) {
        this.session.editor.updateEventAt({ updateSelection: true }, lastEventIndex);
        this.setFocus();
        return;
      }
    }

    // Merge successive select events.
    if (lastEvent?.uri === uri && lastEvent.type === 'select' && lastEvent.clock > this.clock - 0.5) {
      logAcceptedEvent(`accepted select for ${uri} (SHORTCUT)`);
      this.session.editor.updateEventAt({ selections }, lastEventIndex);
      this.setFocus();
      return;
    }

    logAcceptedEvent(`accepted select for ${uri}`);

    this.insertEvent(
      {
        type: 'select',
        id: lib.nextId(),
        uri,
        clock: this.clock,
        selections,
        revSelections,
      },
      { coalescing: false },
    );
    this.setFocus();
  }

  private scroll(vscTextEditor: vscode.TextEditor, vscVisibleRanges: readonly vscode.Range[]) {
    const visibleRanges = vscVisibleRanges.map(VscWorkspace.fromVscLineRange);
    logRawEvent(`event: scroll ${vscTextEditor.document.uri} ${JSON.stringify(visibleRanges)}`);
    if (!this.vscWorkspace.shouldRecordVscUri(vscTextEditor.document.uri)) return;

    const visibleRange = visibleRanges[0];
    const uri = this.vscWorkspace.uriFromVsc(vscTextEditor.document.uri);
    const irTextEditor = this.internalWorkspace.getTextEditorByUri(uri);

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
    const lastEventIndex = this.session.body.editorEvents.length - 1;
    const lastEvent = this.session.body.editorEvents[lastEventIndex];
    if (lastEvent?.uri === uri && lastEvent.type === 'scroll' && lastEvent.clock > this.clock - 0.5) {
      logAcceptedEvent(
        `accepted scroll for ${uri} visible range: ${visibleRange.start}:${visibleRange.end} (SHORTCUT)`,
      );
      this.session.editor.updateEventAt({ visibleRange }, lastEventIndex);
      return;
    }

    logAcceptedEvent(`accepted scroll for ${uri} visible range: ${visibleRange.start}:${visibleRange.end}`);

    this.insertEvent(
      {
        type: 'scroll',
        id: lib.nextId(),
        uri,
        clock: this.clock,
        visibleRange,
        revVisibleRange,
      },
      { coalescing: true },
    );
  }

  private async fsCreate(vscUri: vscode.Uri) {
    logRawEvent(`event: fsCreate ${vscUri}`);
    if (!this.vscWorkspace.shouldRecordVscUri(vscUri)) return;
    const uri = this.vscWorkspace.uriFromVsc(vscUri);

    // When saving an untitled document, fsCreate may come last.
    // By then, we've already issued an fsCreate ourselves.
    // So, let's change this to an fsChange.
    if (this.internalWorkspace.isUriInWorktree(uri)) {
      logRawEvent(`changing fsCreate to fsChange because item already existed internally ${vscUri}`);
      return this.fsChange(vscUri);
    }

    logAcceptedEvent(`accepted save for ${uri}`);

    const stat = await fs.promises.stat(vscUri.fsPath);
    assert(stat.isFile() || stat.isDirectory(), `Expected ${vscUri.fsPath} to be a regular file or directory.`);

    const data = await fs.promises.readFile(vscUri.fsPath);
    const sha1 = await misc.computeSHA1(data);
    const file: t.File = { type: 'blob', sha1 };
    await this.session.core.writeBlob(sha1, data);

    assert(!this.internalWorkspace.isUriInWorktree(uri));
    this.internalWorkspace.insertOrUpdateFile(uri, file);

    this.insertEvent(
      {
        type: 'fsCreate',
        id: lib.nextId(),
        uri,
        clock: this.clock,
        file,
      },
      { coalescing: false },
    );
  }

  private async fsChange(vscUri: vscode.Uri) {
    logRawEvent(`event: fsChange ${vscUri}`);
    if (!this.vscWorkspace.shouldRecordVscUri(vscUri)) return;

    const uri = this.vscWorkspace.uriFromVsc(vscUri);
    logAcceptedEvent(`accepted save for ${uri}`);

    const stat = await fs.promises.stat(vscUri.fsPath);
    assert(stat.isFile(), `Expected ${vscUri.fsPath} to be a regular file.`);

    const data = await fs.promises.readFile(vscUri.fsPath);
    const sha1 = await misc.computeSHA1(data);
    const file: t.File = { type: 'blob', sha1 };

    const internalWorktreeItem = this.internalWorkspace.findWorktreeItemByUri(uri);
    assert(internalWorktreeItem, `Received change event for ${vscUri.fsPath} but it's not in the internal worktree`);
    const revFile = internalWorktreeItem.file;

    if (_.isEqual(file, revFile)) {
      // Nothing has changed.
      debugger;
      return;
    }

    // Write new blob and commit file to internal work tree.
    await this.session.core.writeBlob(sha1, data);
    internalWorktreeItem.file = file;

    this.insertEvent(
      {
        type: 'fsChange',
        id: lib.nextId(),
        uri,
        clock: this.clock,
        file,
        revFile,
      },
      { coalescing: false },
    );
  }

  private async fsDelete(vscUri: vscode.Uri) {
    logRawEvent(`event: fsDelete ${vscUri}`);
    if (!this.vscWorkspace.shouldRecordVscUri(vscUri)) return;

    const uri = this.vscWorkspace.uriFromVsc(vscUri);
    logAcceptedEvent(`accepted delete for ${uri}`);

    // const stat = await fs.promises.stat(vscUri.fsPath);
    // assert(stat.isFile() || stat.isDirectory(), `Expected ${vscUri.fsPath} to be a regular file or directory.`);

    // const data = await fs.promises.readFile(vscUri.fsPath);
    // const sha1 = await misc.computeSHA1(data);
    // const file: t.File = { type: 'blob', sha1 };

    const internalWorktreeItem = this.internalWorkspace.findWorktreeItemByUri(uri);
    assert(internalWorktreeItem, `Received delete event for ${vscUri.fsPath} but it's not in the internal worktree`);
    const revFile = internalWorktreeItem.file;
    this.internalWorkspace.deleteFileByUri(uri);

    this.insertEvent(
      {
        type: 'fsDelete',
        id: lib.nextId(),
        uri,
        clock: this.clock,
        revFile,
      },
      { coalescing: false },
    );
  }

  private insertEvent(e: t.EditorEvent, opts: { coalescing: boolean }) {
    const i = this.session.editor.insertEvent(e, opts);
    this.internalWorkspace.eventIndex = i;
  }

  /**
   * Only untitled documents can be opened without an existing internal worktree item.
   *
   * Inserts an 'openTextDocument' event if:
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
  // private async openTextDocumentByUri(
  //   vscTextDocument: vscode.TextDocument,
  //   uri: string,
  // ): Promise<InternalTextDocument> {

  //   return irTextDocument;
  // }

  // /**
  //  * It does not push a showTextEditor event.
  //  * It will create or update the internal text editor.
  //  */
  // private async openTextEditorHelper(vscTextEditor: vscode.TextEditor, uri: string): Promise<InternalTextEditor> {
  //   return textEditor;
  // }

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
