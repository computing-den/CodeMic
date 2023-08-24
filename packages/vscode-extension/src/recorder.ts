import * as misc from './misc.js';
import { types as t } from '@codecast/lib';
import * as ir from './internal_representation.js';
import * as vscode from 'vscode';
import _ from 'lodash';
import assert from 'assert';

const SCROLL_LINES_TRIGGER = 2;

export interface RecorderI {
  status: t.RecorderStatus;
  start(): Promise<void>;
  pause(): void;
  stop(): Promise<void>;
  getClock(): number;
  getWorkspacePath(): string | undefined;
  getDefaultWorkspacePath(): string | undefined;
}

export class UninitializedRecorder implements RecorderI {
  status = t.RecorderStatus.Uninitialized;
  async start() {}
  pause() {}
  async stop() {}
  getClock() {
    return 0;
  }
  getWorkspacePath() {
    return undefined;
  }
  getDefaultWorkspacePath() {
    return getDefaultWorkspacePath();
  }
}

export class Recorder implements RecorderI {
  status: t.RecorderStatus = t.RecorderStatus.Ready;

  private disposables: vscode.Disposable[] = [];
  private scrolling: boolean = false;
  private scrollStartRange?: vscode.Range;
  private startTimeMs: number = Date.now();

  constructor(public context: vscode.ExtensionContext, public session: ir.Session) {}

  /**
   * workspacePath must be already resolved.
   */
  static async fromWorkspace(context: vscode.ExtensionContext, workspacePath: string): Promise<Recorder> {
    const session = await ir.Session.fromWorkspace(workspacePath);
    return new Recorder(context, session);
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
    if (this.session.events.length > 0) {
      this.pushEvent({
        type: 'stop',
        clock: this.getClock(),
      });
      this.status = t.RecorderStatus.Stopped;
      await this.save();
    }
    this.dispose();
  }

  async save() {
    // there must be more than a stop event
    assert(this.session.events.length > 1);

    // const p = path.join(misc.getRecordingsPath(), moment().format('YYYY-MM-DD-HH:mm:ss'));
    const p = misc.getDefaultRecordingPath();
    await this.session.writeToFile(p);
    // vscode.window.showInformationMessage(`Saved to ${p}`);
  }

  // shouldRecordDocument(vscTextDocument: vscode.TextDocument): boolean {
  //   return Boolean(this.session.getPartialUri(vscTextDocument.uri));
  // }

  textChange(
    vscTextDocument: vscode.TextDocument,
    vscContentChanges: readonly vscode.TextDocumentContentChangeEvent[],
  ) {
    const uri = this.session.getPartialUri(vscTextDocument.uri);
    if (!uri) return;

    console.log(`adding textChange for ${uri}`);

    // Here, we assume that it is possible to get a textChange without a text editor
    // because vscode's event itself does not provide a text editor.

    const irTextDocument = this.session.openTextDocument(vscTextDocument);
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
    const uri = this.session.getPartialUri(vscTextDocument.uri);
    if (!uri) return;

    console.log(`adding openDocument for ${uri}`);

    const irTextDocument = this.session.openTextDocument(vscTextDocument);
    this.pushEvent({
      type: 'openDocument',
      clock: this.getClock(),
      uri,
      eol: irTextDocument.eol,
    });
  }

  showTextEditor(vscTextEditor: vscode.TextEditor) {
    const uri = this.session.getPartialUri(vscTextEditor.document.uri);
    if (!uri) return;

    console.log(`adding showTextEditor for ${uri}`);

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
      uri,
      selections,
      visibleRange,
      revUri,
      revSelections,
      revVisibleRange,
    });
  }

  select(vscTextEditor: vscode.TextEditor, selections: readonly vscode.Selection[]) {
    const uri = this.session.getPartialUri(vscTextEditor.document.uri);
    if (!uri) return;

    console.log(`adding select for ${uri}`);
    console.log(
      `visibleRange: ${vscTextEditor.visibleRanges[0].start.line}:${vscTextEditor.visibleRanges[0].end.line}`,
    );

    const irTextEditor = this.session.getTextEditorByUri(uri);
    const revSelections = irTextEditor.selections;
    const revVisibleRanges = irTextEditor.visibleRange;
    irTextEditor.select(misc.duplicateSelections(selections), vscTextEditor.visibleRanges[0]);

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
    const uri = this.session.getPartialUri(vscTextDocument.uri);
    if (!uri) return;

    console.log(`adding save for ${uri}`);

    this.pushEvent({
      type: 'save',
      clock: this.getClock(),
      uri,
    });
  }

  scroll(vscTextEditor: vscode.TextEditor, visibleRanges: readonly vscode.Range[]) {
    const uri = this.session.getPartialUri(vscTextEditor.document.uri);
    if (!uri) return;

    const visibleRange = misc.duplicateRange(visibleRanges[0]);
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

  getWorkspacePath(): string | undefined {
    return this.session?.workspacePath;
  }

  getDefaultWorkspacePath() {
    return getDefaultWorkspacePath();
  }

  getClock(): number {
    if (this.status === t.RecorderStatus.Recording) {
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

function getDefaultWorkspacePath(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0].uri.path;
}
