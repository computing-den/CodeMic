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
import * as lib from '../../lib/lib.js';
import InternalWorkspace, { LiveWorktree } from './internal_workspace.js';
import assert from '../../lib/assert.js';
import config from '../config.js';
import vscode from 'vscode';
import _ from 'lodash';
import { LoadedSession } from './session.js';
import VscWorkspace from './vsc_workspace.js';
import * as misc from '../misc.js';
import * as fs from 'fs';
import QueueRunner from '../../lib/queue_runner.js';

// const SCROLL_LINES_TRIGGER = 2;

class WorkspaceRecorder {
  recording = false;

  private session: LoadedSession;

  private internalWorkspace: InternalWorkspace;
  private vscWorkspace: VscWorkspace;

  private disposables: vscode.Disposable[] = [];
  private queue = new QueueRunner();
  // private scrolling: boolean = false;
  // private scrollStartRange?: Range;
  // private lastUri?: t.Uri;
  // private lastPosition?: Position;
  // private lastLine: number | undefined;

  // private textDocumentsUrisBeingCreated = new Set<string>();

  private get clock(): number {
    return this.session.rr.clock;
  }

  private get worktree(): LiveWorktree {
    return this.internalWorkspace.worktree;
  }

  constructor(session: LoadedSession, internalWorkspace: InternalWorkspace, vscWorkspace: VscWorkspace) {
    this.session = session;
    this.internalWorkspace = internalWorkspace;
    this.vscWorkspace = vscWorkspace;
  }

  async record() {
    if (this.recording) return;

    this.recording = true;

    await this.waitForStableFs();

    // Listen to tabs opening/closing/changing.
    {
      const disposable = vscode.window.tabGroups.onDidChangeTabs(async tabChangeEvent => {
        await this.queue.enqueue(this.changeTabs.bind(this), tabChangeEvent);
      });
      this.disposables.push(disposable);
    }

    // listen for open document events
    {
      const disposable = vscode.workspace.onDidOpenTextDocument(async vscTextDocument => {
        await this.queue.enqueue(this.openTextDocument.bind(this), vscTextDocument);
      });
      this.disposables.push(disposable);
    }
    // listen for close document events
    {
      const disposable = vscode.workspace.onDidCloseTextDocument(async vscTextDocument => {
        await this.queue.enqueue(this.closeTextDocument.bind(this), vscTextDocument);
      });
      this.disposables.push(disposable);
    }

    // listen for show text editor events
    {
      const disposable = vscode.window.onDidChangeActiveTextEditor(async vscTextEditor => {
        if (vscTextEditor) await this.queue.enqueue(this.showTextEditor.bind(this), vscTextEditor);
      });
      this.disposables.push(disposable);
    }

    // listen for text change events
    {
      const disposable = vscode.workspace.onDidChangeTextDocument(async e => {
        await this.queue.enqueue(this.textChange.bind(this), e.document, e.contentChanges);
      });
      this.disposables.push(disposable);
    }

    // listen for selection change events
    {
      const disposable = vscode.window.onDidChangeTextEditorSelection(async e => {
        // checking for e.kind !== TextEditorSelectionChangeKind.Keyboard isn't helpful
        // because shift+arrow keys would trigger this event kind
        await this.queue.enqueue(this.select.bind(this), e.textEditor, e.selections);
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
      const disposable = vscode.window.onDidChangeTextEditorVisibleRanges(async e => {
        await this.queue.enqueue(this.scroll.bind(this), e.textEditor, e.visibleRanges);
      });
      this.disposables.push(disposable);
    }

    // listen for filesystem events
    {
      const watcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(this.session.workspace, '**/*'),
      );
      watcher.onDidCreate(uri => this.queue.enqueue(this.fsCreate.bind(this), uri));
      watcher.onDidChange(uri => this.queue.enqueue(this.fsChange.bind(this), uri));
      watcher.onDidDelete(uri => this.queue.enqueue(this.fsDelete.bind(this), uri));
      this.disposables.push(watcher);
    }

    // register disposables
    this.session.context.extension.subscriptions.push(...this.disposables);

    // update or create focus
    await this.queue.enqueue(this.setFocus.bind(this));
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

  private waitForStableFs(): Promise<void> {
    return new Promise((resolve, reject) => {
      const done = () => {
        watcher.dispose();

        const waitedForMs = Date.now() - startTimestamp;
        if (waitedForMs < maxWait - stableFsDur / 2) {
          if (config.debug) {
            console.log(`waitForStableFs fs is stable after ${waitedForMs / 1000}s`);
          }
          resolve();
        } else {
          reject(new Error(`Waited for ${maxWait / 1000} seconds but the file system kept changing.`));
        }
      };

      const fsChanged = (uri: vscode.Uri) => {
        if (this.vscWorkspace.shouldRecordVscUri(uri)) {
          if (config.debug) {
            console.log('waitForStableFs got change: ', this.vscWorkspace.uriFromVsc(uri));
          }
          doneDebounced();
        }
      };

      const stableFsDur = 600;
      const maxWait = 3000;
      const startTimestamp = Date.now();
      const doneDebounced = _.debounce(done, stableFsDur, { maxWait });

      const watcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(this.session.workspace, '**/*'),
      );
      watcher.onDidCreate(fsChanged);
      watcher.onDidChange(fsChanged);
      watcher.onDidDelete(fsChanged);

      doneDebounced();
    });
  }

  private setFocus() {
    if (!this.worktree.activeTextEditorUri) return;
    const item = this.worktree.get(this.worktree.activeTextEditorUri);
    assert(item.textEditor);

    this.session.editor.setFocus(
      {
        clock: this.clock,
        uri: item.textEditor.uri,
        number: item.textEditor.currentLine,
        text: item.textEditor.currentLineText,
      },
      item.textDocument?.isEmpty ?? true,
    );
  }

  private async textChange(
    vscTextDocument: vscode.TextDocument,
    vscContentChanges: readonly vscode.TextDocumentContentChangeEvent[],
  ) {
    // See the top of the file for explanation.

    logRawEvent(`event: textChange ${vscTextDocument.uri} ${JSON.stringify(vscContentChanges)}`);
    if (!this.vscWorkspace.shouldRecordVscUri(vscTextDocument.uri)) return;

    const uri = this.vscWorkspace.uriFromVsc(vscTextDocument.uri);
    if (vscContentChanges.length === 0) {
      if (config.debug) {
        console.log(`textChange vscContentChanges for ${uri} is empty`);
      }
      return;
    }

    logAcceptedEvent(`accepted textChange for ${uri}`);

    // Here, we assume that document must exist internally by the time we get a text change event.
    const irTextDocument = this.worktree.get(uri).textDocument;
    assert(irTextDocument);

    let debugInitIrText: string | undefined;
    if (config.debug) {
      debugInitIrText = irTextDocument.getText();
    }

    // Read https://github.com/microsoft/vscode/issues/11487 about contentChanges array.
    const irContentChanges = vscContentChanges
      .map(c => ({ text: c.text, range: VscWorkspace.fromVscRange(c.range) }))
      .sort((a, b) => lib.posCompare(a.range.start, b.range.start));

    // Validate ranges and make sure there are no overlaps.
    for (const [i, cc] of irContentChanges.entries()) {
      assert(irTextDocument.isRangeValid(cc.range), 'textChange: invalid range');
      if (i > 0) {
        assert(
          lib.posIsAfterOrEqual(cc.range.start, irContentChanges[i - 1].range.end),
          // ih.isRangeNonOverlapping(irContentChanges[i - 1].range, cc.range),
          'textChange: got content changes with overlapping ranges',
        );
      }
    }

    // Apply content changes and get the reverse.
    const irRevContentChanges = irTextDocument.applyContentChanges(irContentChanges, true);

    let coalescing = false;

    // Try to simplify it to textInsert event when:
    // - There is only one cursor: only one content change.
    // - No text is replaced: the range's start and end are the same.
    let irEvent: t.EditorEvent;
    if (
      irContentChanges.length === 1 &&
      lib.posIsEqual(irContentChanges[0].range.start, irContentChanges[0].range.end)
    ) {
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

    // // Collect the URIs that have been opened and no other instance of them
    // // exist internally.
    // const openedUris: vscode.Uri[] = [];
    // for (let tab of tabChangeEvent.opened) {
    //   if (tab.input instanceof vscode.TabInputText) {
    //     const uri = tab.input.uri;
    //     if (
    //       this.vscWorkspace.shouldRecordVscUri(uri) &&
    //         !this.worktree.getOpt( this.vscWorkspace.uriFromVsc(uri)
    //     ) {
    //       closedUris.push(tab.input.uri);
    //     }
    //   }
    // }

    if (closedUris.length === 0) return;

    const uris = closedUris.map(uri => this.vscWorkspace.uriFromVsc(uri));
    for (const uri of uris) {
      logAcceptedEvent(`accepted closeTextEditor for ${uri}`);
      const item = this.worktree.get(uri);
      const irTextEditor = item.textEditor;
      const revSelections = irTextEditor?.selections;
      const revVisibleRange = irTextEditor?.visibleRange;
      const active = this.worktree.activeTextEditorUri === uri;
      item.closeTextEditor();
      if (active) this.worktree.activeTextEditorUri = undefined;
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

    const irItem = this.worktree.getOpt(uri) ?? this.worktree.add(uri);

    // In VSCode, changing language is modeled as a close followed by an open text document.
    // So, if the document was just closed, update the close event to a language change.
    const lastEventIndex = this.session.body.editorEvents.length - 1;
    const lastEvent = this.session.body.editorEvents.at(lastEventIndex);
    if (lastEvent?.uri === uri && lastEvent.type === 'closeTextDocument') {
      if (irItem.closedDirtyTextDocument) {
        irItem.restoreClosedDirtyDocument();
      } else {
        const eol = VscWorkspace.eolFromVsc(vscTextDocument.eol);
        await irItem.openTextDocument({ eol, languageId: vscTextDocument.languageId });
      }
      assert(irItem.textDocument);
      irItem.textDocument.languageId = vscTextDocument.languageId;
      const e: t.UpdateTextDocumentEvent = {
        type: 'updateTextDocument',
        id: lastEvent.id,
        uri: lastEvent.uri,
        clock: lastEvent.clock,
        languageId: vscTextDocument.languageId,
        revLanguageId: lastEvent.revLanguageId,
      };
      this.session.editor.setEventAt(e, lastEventIndex);
    }

    // Insert internal document if there's none.
    const irItemAlreadyHadDocument = irItem.textDocument;
    if (!irItemAlreadyHadDocument) {
      logAcceptedEvent(`accepted openTextDocument for ${uri}`);
      const eol = VscWorkspace.eolFromVsc(vscTextDocument.eol);
      await irItem.openTextDocument({ eol, languageId: vscTextDocument.languageId });

      this.insertEvent(
        {
          type: 'openTextDocument',
          id: lib.nextId(),
          uri,
          clock: this.clock,
          eol,
          languageId: vscTextDocument.languageId,
        },
        { coalescing: false },
      );
    }

    // irItem must have a document by now.
    assert(irItem.textDocument);

    // If irText is not the same as vscText, insert textChange.
    // This may happen after renaming a file from a -> b:
    // + a's document is closed
    // + its editor is closed
    // + b's document is opened (with a's content)
    // + its editor is shown
    // + b's file is created
    // + a's file is deleted
    const irText = irItem.textDocument.getText();
    const vscText = vscTextDocument.getText();
    if (irText !== vscText) {
      const irRange = irItem.textDocument.getRange();
      const irContentChanges: t.ContentChange[] = [{ range: irRange, text: vscText }];
      const irRevContentChanges = irItem.textDocument.applyContentChanges(irContentChanges, true);
      this.insertEvent(
        {
          type: 'textChange',
          id: lib.nextId(),
          uri,
          clock: this.clock,
          contentChanges: irContentChanges,
          revContentChanges: irRevContentChanges,
          updateSelection: false,
        },
        { coalescing: !irItemAlreadyHadDocument },
      );
    }
  }

  private async closeTextDocument(vscTextDocument: vscode.TextDocument) {
    logRawEvent(`event: closeTextDocument ${vscTextDocument.uri}`);
    if (!this.vscWorkspace.shouldRecordVscUri(vscTextDocument.uri)) return;

    const uri = this.vscWorkspace.uriFromVsc(vscTextDocument.uri);
    logAcceptedEvent(`accepted closeTextDocument for ${uri}`);

    const revEol = VscWorkspace.eolFromVsc(vscTextDocument.eol);
    await this.worktree.get(uri).closeTextDocument();

    let revText: string | undefined;
    const item = this.worktree.get(uri);
    if (await item.isDirty()) {
      revText = await item.getContentText();
    }

    this.insertEvent(
      {
        type: 'closeTextDocument',
        id: lib.nextId(),
        uri,
        clock: this.clock,
        revText,
        revEol,
        revLanguageId: vscTextDocument.languageId,
      },
      { coalescing: false },
    );

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
  }

  private async showTextEditor(vscTextEditor: vscode.TextEditor) {
    logRawEvent(`event: showTextEditor ${vscTextEditor.document.uri}`);
    if (!this.vscWorkspace.shouldRecordVscUri(vscTextEditor.document.uri)) return;

    const uri = this.vscWorkspace.uriFromVsc(vscTextEditor.document.uri);
    logAcceptedEvent(`accepted showTextEditor for ${uri}`);

    // We assume uri exists.
    const item = this.worktree.get(uri);
    // revUri is the editor currently open.
    const revUri = this.worktree.activeTextEditorUri;

    // revSelections and revVisibleRange refer to the uri text editor, not revUri.
    const revTextEditor = item.textEditor;
    const revSelections = revTextEditor?.selections;
    const revVisibleRange = revTextEditor?.visibleRange;

    const selections = VscWorkspace.fromVscSelections(vscTextEditor.selections);
    const visibleRange = VscWorkspace.fromVscLineRange(vscTextEditor.visibleRanges[0]);
    // const eol = VscWorkspace.eolFromVsc(vscTextEditor.document.eol);
    const justOpened = !item.textEditor;

    // If text document has not been opened, open it first and insert 'openTextDocument' event.
    // This can happen when a document was opened by user while not recorder was on pause and then
    // resumed.
    if (!item.textDocument) {
      await this.openTextDocument(vscTextEditor.document);
    }

    // Now, open text editor and insert 'showTextEditor' event.
    await item.openTextEditor({ selections, visibleRange });
    this.worktree.activeTextEditorUri = uri;
    this.insertEvent(
      {
        type: 'showTextEditor',
        id: lib.nextId(),
        uri,
        clock: this.clock,
        selections,
        visibleRange,
        justOpened,
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
    const irTextEditor = this.worktree.get(uri).textEditor;
    assert(irTextEditor);

    const lastEventIndex = this.session.body.editorEvents.length - 1;
    const lastEvent = this.session.body.editorEvents.at(lastEventIndex);
    const revSelections = irTextEditor.selections;
    irTextEditor.select(selections);

    // Avoid inserting unnecessary select event if the selections can be calculated
    // from the last textChange event.
    if (lastEvent?.uri === uri && lastEvent.type === 'textChange' && lastEvent.clock > this.clock - 1) {
      const calculatedSelections = lib.getSelectionsAfterTextChangeEvent(lastEvent);
      const calculatedRevSelections = lib.getSelectionsBeforeTextChangeEvent(lastEvent);
      if (
        lib.selAreEqual(calculatedSelections, irTextEditor.selections) &&
        lib.selAreEqual(calculatedRevSelections, revSelections)
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
        lib.selAreEqual(calculatedSelections, irTextEditor.selections) &&
        lib.selAreEqual(calculatedRevSelections, revSelections)
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
    const irTextEditor = this.worktree.get(uri).textEditor;
    assert(irTextEditor);

    // Avoid redundant scrolls.
    if (lib.lineRangeIsEqual(irTextEditor.visibleRange, visibleRange)) return;

    const revVisibleRange = irTextEditor.visibleRange;
    irTextEditor.scroll(visibleRange);

    // Merge successive scrolls.
    const lastEventIndex = this.session.body.editorEvents.length - 1;
    const lastEvent = this.session.body.editorEvents.at(lastEventIndex);
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
    const stat = await fs.promises.stat(vscUri.fsPath);

    let file: t.File;
    if (stat.isFile()) {
      const data = await fs.promises.readFile(vscUri.fsPath);
      const sha1 = await misc.computeSHA1(data);
      file = { type: 'blob', sha1 };
      await this.session.core.writeBlob(sha1, data);
    } else if (stat.isDirectory()) {
      file = { type: 'dir' };
    } else {
      // No need to record anything other than files and directories.
      return;
    }

    logAcceptedEvent(`accepted fsCreate for ${uri}`);
    this.worktree.addOrUpdateFile(uri, file);

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

    const stat = await fs.promises.stat(vscUri.fsPath);
    const uri = this.vscWorkspace.uriFromVsc(vscUri);

    // No need to record changes to directories when their content change.
    if (!stat.isFile()) return;

    logAcceptedEvent(`accepted fsChange for ${uri}`);

    const data = await fs.promises.readFile(vscUri.fsPath);
    const sha1 = await misc.computeSHA1(data);
    const file: t.File = { type: 'blob', sha1 };

    const item = this.worktree.getOpt(uri);
    assert(item, `Received file change event for ${vscUri.fsPath} but it's not in the internal worktree`);
    assert(item.file, `Received file change event for ${vscUri.fsPath} but internal worktree item does not have file`);
    const revFile = item.file;

    if (_.isEqual(file, revFile)) return;

    // Write new blob and commit file to internal work tree.
    await this.session.core.writeBlob(sha1, data);
    item.setFile(file);

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

    // const stat = await fs.promises.stat(vscUri.fsPath);
    const uri = this.vscWorkspace.uriFromVsc(vscUri);

    // // No need to record anything other than files and directories.
    // if (!stat.isFile() && !stat.isDirectory()) return;

    logAcceptedEvent(`accepted delete for ${uri}`);

    // We can't check if the deleted file was a file, directory, or something else that
    // we didn't even decide to record in fsCreate. So, don't throw error if not
    // in worktree.
    const item = this.worktree.getOpt(uri);
    if (!item) return;

    assert(item.file, `Received file delete event for ${vscUri.fsPath} but internal worktree item does not have file`);
    const revFile = item.file;
    item.closeFile();

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
