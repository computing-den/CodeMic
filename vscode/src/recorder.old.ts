// import assert from 'node:assert/strict';
// import * as misc from './misc';
// import * as vscode from 'vscode';
// import * as fs from 'fs/promises';
// import _ from 'lodash';
// import path from 'path';
// import moment from 'moment';
// import {
//   Disposable,
//   TextDocument,
//   TextEditor,
//   TextDocumentContentChangeEvent,
//   TextEditorSelectionChangeEvent,
//   TextEditorVisibleRangesChangeEvent,
//   ExtensionContext,
//   Selection,
// } from 'vscode';
// import {
//   CcEvent,
//   CcEventTextChange,
//   CcEventOpenDocument,
//   CcEventShowDocument,
//   CcEventSelect,
//   CcEventSave,
//   CcEventStop,
//   CcEventScroll,
//   CcEventRecord,
//   CcLineRange,
//   CcPos,
// } from './types';

// const SCROLL_LINES_TRIGGER = 5;

// export default class Recorder {
//   isRecording: boolean = false;
//   context: ExtensionContext;
//   disposables: Disposable[] = [];
//   // hash: string = '';
//   // git: GitAPI;
//   // repo?: Repository;
//   scrolling: boolean = false;
//   scrollStartLineRange: CcLineRange | undefined;
//   emitEventCb: (event: CcEvent) => Promise<void>;
//   workdir: string = '';

//   constructor(context: ExtensionContext, emitEventCb: (event: CcEvent) => Promise<void>) {
//     this.context = context;
//     this.emitEventCb = emitEventCb;
//   }

//   start(workdir: string) {
//     // Must be at the beginning so that disposables will be disposed of, even if this
//     // function fails halfway through
//     this.isRecording = true;
//     this.workdir = workdir;

//     // listen for open document events
//     {
//       const disposable = vscode.workspace.onDidOpenTextDocument(document => {
//         if (this.shouldRecordDocument(document)) {
//           this.emitEvent(this.makeOpenDocumentEvent(document));
//         }
//       });

//       this.disposables.push(disposable);
//     }

//     // listen for show document events
//     {
//       const disposable = vscode.window.onDidChangeActiveTextEditor(textEditor => {
//         if (textEditor && this.shouldRecordDocument(textEditor.document)) {
//           this.emitEvent(this.makeShowDocumentEvent(textEditor));
//         }
//       });

//       this.disposables.push(disposable);
//     }

//     // listen for text change events
//     {
//       const disposable = vscode.workspace.onDidChangeTextDocument(e => {
//         if (!this.shouldRecordDocument(e.document)) return;
//         for (const change of e.contentChanges) {
//           this.emitEvent(this.makeTextChangeEvent(e.document, change));
//         }
//       });
//       this.disposables.push(disposable);
//     }

//     // listen for selection change events
//     {
//       const disposable = vscode.window.onDidChangeTextEditorSelection(
//         (e: TextEditorSelectionChangeEvent) => {
//           // console.log('XXX', e.selections);
//           if (!this.shouldRecordDocument(e.textEditor.document)) return;

//           // checking for e.kind !== TextEditorSelectionChangeKind.Keyboard isn't helpful
//           // because shift+arrow keys would trigger this event kind
//           this.emitEvent(this.makeSelectionEvent(e.textEditor, e.selections));
//         },
//       );
//       this.disposables.push(disposable);
//     }

//     // listen for save events
//     {
//       const disposable = vscode.workspace.onDidSaveTextDocument(
//         (document: TextDocument) => {
//           if (!this.shouldRecordDocument(document)) return;
//           this.emitEvent(this.makeSaveEvent(document));
//         },
//       );
//       this.disposables.push(disposable);
//     }

//     // listen for scroll events
//     {
//       const disposable = vscode.window.onDidChangeTextEditorVisibleRanges(
//         (e: TextEditorVisibleRangesChangeEvent) => {
//           if (!this.shouldRecordDocument(e.textEditor.document)) return;

//           // const rangesStr = _.map(
//           //   e.visibleRanges,
//           //   r =>
//           //     `${r.start.line}:${r.start.character}  <->  ${r.end.line}:${r.end.character}`,
//           // );
//           // console.log('XXX', rangesStr.join('   |   '));

//           const r = e.visibleRanges[0];
//           const visible: CcLineRange = { start: r.start.line, end: r.end.line };

//           if (!this.scrolling) {
//             this.scrollStartLineRange ??= visible;
//             const delta = Math.abs(visible.start - this.scrollStartLineRange.start);
//             if (delta > SCROLL_LINES_TRIGGER) {
//               this.scrolling = true;
//             }
//           }

//           if (this.scrolling) {
//             this.emitEvent(this.makeScrollEvent(e.textEditor, visible));
//           }
//         },
//       );
//       this.disposables.push(disposable);
//     }

//     // register disposables and start recording
//     this.context.subscriptions.push(...this.disposables);

//     // insert events to open all the documents currently open in the workspace
//     {
//       for (const document of vscode.workspace.textDocuments) {
//         if (this.shouldRecordDocument(document)) {
//           this.emitEvent(this.makeOpenDocumentEvent(document));
//         }
//       }
//     }

//     // insert event to show the currectly active document
//     {
//       const textEditor = vscode.window.activeTextEditor;
//       if (textEditor && this.shouldRecordDocument(textEditor.document)) {
//         this.emitEvent(this.makeShowDocumentEvent(textEditor));
//       }
//     }
//   }

//   stop() {
//     for (const d of this.disposables) d.dispose();
//     this.disposables = [];
//     this.isRecording = false;
//   }

//   async handleEvent(e: CcEvent): Promise<boolean> {
//     if (e.type === 'record') {
//       if (this.isRecording) this.stop();
//       this.start(e.workdir);
//       return true;
//     }

//     if (!this.isRecording) return false;

//     switch (e.type) {
//       case 'stop': {
//         if (!this.isRecording) return false;
//         this.stop();
//         return true;
//       }
//       default:
//         return false;
//     }
//   }

//   shouldRecordDocument(document: TextDocument): boolean {
//     return misc.isUriPartOfRecording(document.uri, this.workdir);
//   }

//   makeTextChangeEvent(
//     document: TextDocument,
//     contentChange: TextDocumentContentChangeEvent,
//   ): CcEventTextChange {
//     // assert(this.repo);
//     console.log(`adding textChange for ${document.uri}: ${contentChange.text}`);

//     const uri = misc.makeCcUri(document.uri, this.workdir);
//     const range = misc.makeCcRange(contentChange.range);
//     return {
//       type: 'textChange',
//       clock: 0,
//       uri,
//       text: contentChange.text,
//       range,
//       selections: [], // will be set by player
//       revRange: range,
//       revText: '',
//       revSelections: [],
//     };
//   }

//   makeOpenDocumentEvent(document: TextDocument): CcEventOpenDocument {
//     console.log(`adding openDocument for ${document.uri}`);

//     return {
//       type: 'openDocument',
//       clock: 0,
//       uri: misc.makeCcUri(document.uri, this.workdir),
//       text: document.getText(),
//       eol: document.eol,
//     };
//   }

//   makeShowDocumentEvent(textEditor: TextEditor): CcEventShowDocument {
//     console.log(`adding showDocument for ${textEditor.document.uri}`);

//     const uri = misc.makeCcUri(textEditor.document.uri, this.workdir);
//     const selections = _.map(textEditor.selections, misc.makeCcSelection);
//     return {
//       type: 'showDocument',
//       clock: 0,
//       uri,
//       selections,
//       revUri: uri,
//       revSelections: selections,
//     };
//   }

//   makeSelectionEvent(
//     textEditor: TextEditor,
//     selections: readonly Selection[],
//   ): CcEventSelect {
//     const { document, visibleRanges } = textEditor;
//     console.log(`adding select for ${document.uri}`);
//     const r = visibleRanges[0];
//     const visible: CcLineRange = { start: r.start.line, end: r.end.line };

//     return {
//       type: 'select',
//       clock: 0,
//       uri: misc.makeCcUri(document.uri, this.workdir),
//       selections: _.map(selections, misc.makeCcSelection),
//       visible,
//       revSelections: [],
//       revVisible: visible,
//     };
//   }

//   makeSaveEvent(document: TextDocument): CcEventSave {
//     console.log(`adding save for ${document.uri}`);

//     return {
//       type: 'save',
//       clock: 0,
//       uri: misc.makeCcUri(document.uri, this.workdir),
//     };
//   }

//   makeScrollEvent(textEditor: TextEditor, visible: CcLineRange): CcEventScroll {
//     console.log(`adding scroll for ${textEditor.document.uri}`);
//     console.log(visible);

//     return {
//       type: 'scroll',
//       clock: 0,
//       uri: misc.makeCcUri(textEditor.document.uri, this.workdir),
//       visible,
//       revVisible: visible,
//     };
//   }

//   async emitEvent(event: CcEvent) {
//     try {
//       if (event.type !== 'scroll') {
//         this.scrolling = false;
//         this.scrollStartLineRange = undefined;
//       }
//       await this.emitEventCb(event);
//     } catch (error) {
//       console.error(error);
//     }
//   }
// }
