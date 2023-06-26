import * as misc from './misc';
import * as T from './types';
import * as vscode from 'vscode';
import _ from 'lodash';
import * as fs from 'fs';
import path from 'path';
import moment from 'moment';

const SCROLL_LINES_TRIGGER = 5;

export default class Recorder {
  context: vscode.ExtensionContext;
  disposables: vscode.Disposable[] = [];
  // hash: string = '';
  // git: GitAPI;
  // repo?: Repository;
  scrolling: boolean = false;
  scrollStartRange: vscode.Range | undefined;
  // workdir: string = '';
  events: T.Event[] = [];
  isRecording: boolean = false;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
    this.isRecording = true;

    // listen for open document events
    {
      const disposable = vscode.workspace.onDidOpenTextDocument(document => {
        if (this.shouldRecordDocument(document)) {
          this.pushEvent(this.makeOpenDocumentEvent(document));
        }
      });

      this.disposables.push(disposable);
    }

    // listen for show document events
    {
      const disposable = vscode.window.onDidChangeActiveTextEditor(textEditor => {
        if (textEditor && this.shouldRecordDocument(textEditor.document)) {
          this.pushEvent(this.makeShowDocumentEvent(textEditor));
        }
      });

      this.disposables.push(disposable);
    }

    // listen for text change events
    {
      const disposable = vscode.workspace.onDidChangeTextDocument(e => {
        if (!this.shouldRecordDocument(e.document)) return;
        for (const change of e.contentChanges) {
          this.pushEvent(this.makeTextChangeEvent(e.document, change));
        }
      });
      this.disposables.push(disposable);
    }

    // listen for selection change events
    {
      const disposable = vscode.window.onDidChangeTextEditorSelection(e => {
        // console.log('XXX', e.selections);
        if (!this.shouldRecordDocument(e.textEditor.document)) return;

        // checking for e.kind !== TextEditorSelectionChangeKind.Keyboard isn't helpful
        // because shift+arrow keys would trigger this event kind
        this.pushEvent(this.makeSelectionEvent(e.textEditor, e.selections));
      });
      this.disposables.push(disposable);
    }

    // listen for save events
    {
      const disposable = vscode.workspace.onDidSaveTextDocument(document => {
        if (!this.shouldRecordDocument(document)) return;
        this.pushEvent(this.makeSaveEvent(document));
      });
      this.disposables.push(disposable);
    }

    // listen for scroll events
    {
      const disposable = vscode.window.onDidChangeTextEditorVisibleRanges(e => {
        if (!this.shouldRecordDocument(e.textEditor.document)) return;

        const vr = e.visibleRanges[0];

        if (!this.scrolling) {
          this.scrollStartRange ??= vr;
          const delta = Math.abs(vr.start.line - this.scrollStartRange.start.line);
          if (delta > SCROLL_LINES_TRIGGER) {
            this.scrolling = true;
          }
        }

        if (this.scrolling) {
          this.pushEvent(this.makeScrollEvent(e.textEditor, vr));
        }
      });
      this.disposables.push(disposable);
    }

    // register disposables and start recording
    this.context.subscriptions.push(...this.disposables);

    // insert events to open all the documents currently open in the workspace
    {
      for (const document of vscode.workspace.textDocuments) {
        if (this.shouldRecordDocument(document)) {
          this.pushEvent(this.makeOpenDocumentEvent(document));
        }
      }
    }

    // insert event to show the currectly active document
    {
      const textEditor = vscode.window.activeTextEditor;
      if (textEditor && this.shouldRecordDocument(textEditor.document)) {
        this.pushEvent(this.makeShowDocumentEvent(textEditor));
      }
    }
  }

  stop() {
    console.log('events: ', this.events);
    this.isRecording = false;
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
  }

  save() {
    if (this.events.length === 0) {
      vscode.window.showInformationMessage('Nothing to save.');
      return;
    }

    const p = path.join(misc.getRecordingsPath(), moment().format('YYYY-MM-DD-HH:mm:ss'));
    fs.writeFileSync(p, JSON.stringify(this.events), 'utf8');
    vscode.window.showInformationMessage(`Saved to ${p}`);
  }

  shouldRecordDocument(document: vscode.TextDocument): boolean {
    // TODO
    return true;
    // return misc.isUriPartOfRecording(document.uri, this.workdir);
  }

  makeTextChangeEvent(
    document: vscode.TextDocument,
    contentChange: vscode.TextDocumentContentChangeEvent,
  ): T.TextChangeEvent {
    // assert(this.repo);
    console.log(`adding textChange for ${document.uri}: ${contentChange.text}`);
    return {
      type: 'textChange',
      clock: Date.now(),
      uri: document.uri,
      text: contentChange.text,
      range: contentChange.range,
      selections: [], // TODO
      revRange: contentChange.range, // TODO
      revText: '', // TODO
      revSelections: [], // TODO
    };
  }

  makeOpenDocumentEvent(document: vscode.TextDocument): T.OpenDocumentEvent {
    console.log(`adding openDocument for ${document.uri}`);

    return {
      type: 'openDocument',
      clock: Date.now(),
      uri: document.uri,
      text: document.getText(),
      eol: document.eol,
    };
  }

  makeShowDocumentEvent(textEditor: vscode.TextEditor): T.ShowDocumentEvent {
    console.log(`adding showDocument for ${textEditor.document.uri}`);

    return {
      type: 'showDocument',
      clock: Date.now(),
      uri: textEditor.document.uri,
      selections: misc.duplicateSelections(textEditor.selections),
      revUri: textEditor.document.uri, // TODO
      revSelections: misc.duplicateSelections(textEditor.selections), // TODO
    };
  }

  makeSelectionEvent(
    textEditor: vscode.TextEditor,
    selections: readonly vscode.Selection[],
  ): T.SelectEvent {
    const { document, visibleRanges } = textEditor;
    console.log(`adding select for ${document.uri}`);

    return {
      type: 'select',
      clock: Date.now(),
      uri: document.uri,
      selections: misc.duplicateSelections(selections),
      visibleRange: visibleRanges[0],
      revSelections: misc.duplicateSelections(selections), // TODO
      revVisibleRange: visibleRanges[0], // TODO
    };
  }

  makeSaveEvent(document: vscode.TextDocument): T.SaveEvent {
    console.log(`adding save for ${document.uri}`);

    return {
      type: 'save',
      clock: Date.now(),
      uri: document.uri,
    };
  }

  makeScrollEvent(
    textEditor: vscode.TextEditor,
    visibleRange: vscode.Range,
  ): T.ScrollEvent {
    console.log(`adding scroll for ${textEditor.document.uri}`);

    return {
      type: 'scroll',
      clock: Date.now(),
      uri: textEditor.document.uri,
      visibleRange,
      revVisibleRange: visibleRange, // TODO
    };
  }

  pushEvent(e: T.Event) {
    if (e.type !== 'scroll') {
      this.scrolling = false;
      this.scrollStartRange = undefined;
    }
    this.events.push(e);
  }
}
