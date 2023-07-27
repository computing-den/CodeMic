import * as misc from './misc';
import * as ir from './internal_representation';
import * as vscode from 'vscode';
import _ from 'lodash';
import path from 'path';
import moment from 'moment';
import assert from 'assert';

const SCROLL_LINES_TRIGGER = 2;

export default class Recorder {
  context: vscode.ExtensionContext;
  disposables: vscode.Disposable[] = [];
  // hash: string = '';
  // git: GitAPI;
  // repo?: Repository;
  scrolling: boolean = false;
  scrollStartRange?: vscode.Range;
  // workdir: string = '';
  isRecording: boolean = false;
  session: ir.Session = new ir.Session([]);
  startTimeMs: number = Date.now();
  isStopped: boolean = false;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;

    // TODO store workspace folders, check git repository etc.
  }

  start() {
    assert(!this.isStopped && !this.isRecording);

    this.isRecording = true;

    // listen for open document events
    {
      const disposable = vscode.workspace.onDidOpenTextDocument(vscTextDocument => {
        if (this.shouldRecordDocument(vscTextDocument)) {
          this.openDocument(vscTextDocument);
        }
      });
      this.disposables.push(disposable);
    }

    // listen for show document events
    {
      const disposable = vscode.window.onDidChangeActiveTextEditor(vscTextEditor => {
        if (vscTextEditor && this.shouldRecordDocument(vscTextEditor.document)) {
          this.showTextEditor(vscTextEditor);
        }
      });
      this.disposables.push(disposable);
    }

    // listen for text change events
    {
      const disposable = vscode.workspace.onDidChangeTextDocument(e => {
        if (this.shouldRecordDocument(e.document)) {
          this.textChange(e.document, e.contentChanges);
        }
      });
      this.disposables.push(disposable);
    }

    // listen for selection change events
    {
      const disposable = vscode.window.onDidChangeTextEditorSelection(e => {
        if (this.shouldRecordDocument(e.textEditor.document)) {
          // checking for e.kind !== TextEditorSelectionChangeKind.Keyboard isn'ir helpful
          // because shift+arrow keys would trigger this event kind
          this.select(e.textEditor, e.selections);
        }
      });
      this.disposables.push(disposable);
    }

    // listen for save events
    {
      const disposable = vscode.workspace.onDidSaveTextDocument(vscTextDocument => {
        if (this.shouldRecordDocument(vscTextDocument)) {
          this.saveTextDocument(vscTextDocument);
        }
      });
      this.disposables.push(disposable);
    }

    // listen for scroll events
    {
      const disposable = vscode.window.onDidChangeTextEditorVisibleRanges(e => {
        if (this.shouldRecordDocument(e.textEditor.document)) {
          const vr = e.visibleRanges[0];
          console.log(`visible range: ${vr.start.line}:${vr.end.line}`);

          if (!this.scrolling) {
            this.scrollStartRange ??= vr;
            const delta = Math.abs(vr.start.line - this.scrollStartRange.start.line);
            if (delta > SCROLL_LINES_TRIGGER) {
              this.scrolling = true;
            }
          }

          if (this.scrolling) {
            this.scroll(e.textEditor, vr);
          }
        }
      });
      this.disposables.push(disposable);
    }

    // register disposables
    this.context.subscriptions.push(...this.disposables);

    // open all the documents currently open in the workspace
    {
      for (const vscTextDocument of vscode.workspace.textDocuments) {
        if (this.shouldRecordDocument(vscTextDocument)) {
          this.openDocument(vscTextDocument);
        }
      }
    }

    // show the currectly active text editor
    {
      const vscTextEditor = vscode.window.activeTextEditor;
      if (vscTextEditor && this.shouldRecordDocument(vscTextEditor.document)) {
        this.showTextEditor(vscTextEditor);
      }
    }
  }

  pause() {
    this.isRecording = false;
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
  }

  stop() {
    this.isStopped = true;
    this.pushEvent({
      type: 'stop',
      clock: this.getClock(),
    });
    this.pause();
    this.save();
  }

  save() {
    if (this.session.events.length === 0) {
      vscode.window.showInformationMessage('Nothing to save.');
      return;
    }

    // const p = path.join(misc.getRecordingsPath(), moment().format('YYYY-MM-DD-HH:mm:ss'));
    const p = misc.getDefaultRecordingPath();
    this.session.writeToFile(p);
    // vscode.window.showInformationMessage(`Saved to ${p}`);
  }

  shouldRecordDocument(vscTextDocument: vscode.TextDocument): boolean {
    // TODO check working directory as well
    return misc.SUPPORTED_URI_SCHEMES.some(x => x === vscTextDocument.uri.scheme);
    // return misc.isUriPartOfRecording(vscTextDocument.uri, this.workdir);
  }

  textChange(
    vscTextDocument: vscode.TextDocument,
    vscContentChanges: readonly vscode.TextDocumentContentChangeEvent[],
  ) {
    console.log(`adding textChange for ${vscTextDocument.uri}`);

    // Here, we assume that it is possible to get a textChange without a text editor
    // because vscode's event itself does not provide a text editor.

    const irTextDocument = this.session.openTextDocument(vscTextDocument);
    const irContentChanges = vscContentChanges.map(({ range, text }) => {
      const [revRange, revText] = irTextDocument.applyContentChange(range, text, true)!;
      return { range, text, revRange, revText };
    });
    irTextDocument.isDirty = true;

    this.pushEvent({
      type: 'textChange',
      clock: this.getClock(),
      uri: irTextDocument.uri,
      contentChanges: irContentChanges,
    });
  }

  openDocument(vscTextDocument: vscode.TextDocument) {
    console.log(`adding openDocument for ${vscTextDocument.uri}`);

    const irTextDocument = this.session.openTextDocument(vscTextDocument);

    this.pushEvent({
      type: 'openDocument',
      clock: this.getClock(),
      uri: irTextDocument.uri,
      text: irTextDocument.getText(),
      eol: irTextDocument.eol,
    });
  }

  showTextEditor(vscTextEditor: vscode.TextEditor) {
    console.log(`adding showTextEditor for ${vscTextEditor.document.uri}`);

    const revUri = this.session.activeTextEditor?.document.uri;
    const revSelections = this.session.activeTextEditor?.selections;
    const revVisibleRange = this.session.activeTextEditor?.visibleRange;

    const selections = misc.duplicateSelections(vscTextEditor.selections);
    const visibleRange = vscTextEditor.visibleRanges[0];
    const irTextEditor = this.session.openTextEditor(vscTextEditor.document, selections, visibleRange);
    this.session.activeTextEditor = irTextEditor;

    this.pushEvent({
      type: 'showTextEditor',
      clock: this.getClock(),
      uri: irTextEditor.document.uri,
      selections,
      visibleRange,
      revUri,
      revSelections,
      revVisibleRange,
    });
  }

  select(vscTextEditor: vscode.TextEditor, selections: readonly vscode.Selection[]) {
    console.log(`adding select for ${vscTextEditor.document.uri}`);
    console.log(
      `visibleRange: ${vscTextEditor.visibleRanges[0].start.line}:${vscTextEditor.visibleRanges[0].end.line}`,
    );

    const irTextEditor = this.session.getTextEditorByUri(vscTextEditor.document.uri);
    const revSelections = irTextEditor.selections;
    const revVisibleRanges = irTextEditor.visibleRange;
    irTextEditor.select(misc.duplicateSelections(selections), vscTextEditor.visibleRanges[0]);

    this.pushEvent({
      type: 'select',
      clock: this.getClock(),
      uri: irTextEditor.document.uri,
      selections: irTextEditor.selections,
      visibleRange: irTextEditor.visibleRange,
      revSelections,
      revVisibleRange: revVisibleRanges,
    });
  }

  saveTextDocument(vscTextDocument: vscode.TextDocument) {
    console.log(`adding save for ${vscTextDocument.uri}`);

    const irTextDocument = this.session.getTextDocumentByUri(vscTextDocument.uri);
    irTextDocument.isDirty = false;
    this.pushEvent({
      type: 'save',
      clock: this.getClock(),
      uri: irTextDocument.uri,
    });
  }

  scroll(vscTextEditor: vscode.TextEditor, visibleRange: vscode.Range) {
    console.log(`adding scroll for ${vscTextEditor.document.uri}`);

    const irTextEditor = this.session.getTextEditorByUri(vscTextEditor.document.uri);
    const revVisibleRange = irTextEditor.visibleRange;
    irTextEditor.scroll(visibleRange);

    this.pushEvent({
      type: 'scroll',
      clock: this.getClock(),
      uri: irTextEditor.document.uri,
      visibleRange,
      revVisibleRange,
    });
  }

  getClock(): number {
    if (this.isRecording) {
      return (Date.now() - this.startTimeMs) / 1000;
    } else {
      return _.last(this.session.events)?.clock ?? 0;
    }
  }

  pushEvent(e: ir.PlaybackEvent) {
    if (e.type !== 'scroll') {
      this.scrolling = false;
      this.scrollStartRange = undefined;
    }
    this.session.events.push(e);
  }
}
