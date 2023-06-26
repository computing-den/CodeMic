// import * as misc from './misc';
// import * as vscode from 'vscode';
// import _ from 'lodash';
// import path from 'path';
// import { Disposable, TextEditor, ExtensionContext, Uri, Range } from 'vscode';
// import { CcEvent, CcEventReplay } from './types';

// export default class Replay {
//   isPlaying: boolean = false;
//   context: ExtensionContext;
//   disposables: Disposable[] = [];
//   emitEventCb: (event: CcEvent) => Promise<void>;
//   workdir: string = '';

//   constructor(context: ExtensionContext, emitEventCb: (event: CcEvent) => Promise<void>) {
//     this.context = context;
//     this.emitEventCb = emitEventCb;
//   }

//   start(workdir: string) {
//     // Must be at the beginning so that disposables will be disposed of, even if this
//     // function fails halfway through
//     this.isPlaying = true;
//     this.workdir = workdir;

//     // ignore user input
//     {
//       const disposable = vscode.commands.registerCommand(
//         'type',
//         (e: { text: string }) => {
//           const uri = vscode.window.activeTextEditor?.document.uri;
//           if (!uri || !misc.isUriPartOfRecording(uri, this.workdir)) {
//             // approve the default type command:
//             vscode.commands.executeCommand('default:type', e);
//           }
//         },
//       );
//       this.disposables.push(disposable);
//     }

//     this.context.subscriptions.push(...this.disposables);
//   }

//   stop() {
//     for (const d of this.disposables) d.dispose();
//     this.disposables = [];
//     this.isPlaying = false;
//   }

//   async handleEvent(e: CcEvent, reverse: boolean = false): Promise<boolean> {
//     if (e.type === 'replay') {
//       if (this.isPlaying) this.stop();
//       this.start(e.workdir);
//       return true;
//     }

//     if (!this.isPlaying) return false;

//     switch (e.type) {
//       case 'textChange': {
//         const uri = misc.makeUri(e.uri, this.workdir);
//         const textEditor = await this.showDocument(uri);
//         if (reverse) {
//           await textEditor.edit(editBuilder => {
//             editBuilder.replace(misc.makeRange(e.revRange), e.revText);
//           });
//           textEditor.selections = _.map(e.selections, misc.makeSelection);
//         } else {
//           await textEditor.edit(editBuilder => {
//             editBuilder.replace(misc.makeRange(e.range), e.text);
//           });
//           textEditor.selections = _.map(e.revSelections, misc.makeSelection);
//         }
//         return true;
//       }

//       case 'openDocument': {
//         const uri = misc.makeUri(e.uri, this.workdir);
//         const document = await vscode.workspace.openTextDocument(uri);
//         const textEditor = await vscode.window.showTextDocument(document, {
//           preserveFocus: true,
//         });
//         textEditor.edit(editBuilder => {
//           // to get the whole range, get the range one line past the last line, then validate it
//           const range = document.validateRange(new Range(0, 0, document.lineCount, 0));
//           editBuilder.replace(range, e.text);
//         });
//         return true;
//       }

//       case 'showDocument': {
//         if (reverse) {
//           if (e.revUri) {
//             const uri = misc.makeUri(e.revUri, this.workdir);
//             const textEditor = await this.showDocument(uri);
//             textEditor.selections = _.map(e.revSelections, misc.makeSelection);
//           }
//         } else {
//           const uri = misc.makeUri(e.uri, this.workdir);
//           const textEditor = await this.showDocument(uri);
//           textEditor.selections = _.map(e.selections, misc.makeSelection);
//         }
//         return true;
//       }

//       case 'select': {
//         const uri = misc.makeUri(e.uri, this.workdir);
//         const textEditor = await this.showDocument(uri);
//         if (reverse) {
//           textEditor.selections = _.map(e.revSelections, misc.makeSelection);
//           await vscode.commands.executeCommand('revealLine', {
//             lineNumber: e.revVisible.start,
//             at: 'top',
//           });
//         } else {
//           textEditor.selections = _.map(e.selections, misc.makeSelection);
//           await vscode.commands.executeCommand('revealLine', {
//             lineNumber: e.visible.start,
//             at: 'top',
//           });
//         }
//         return true;
//       }

//       case 'scroll': {
//         const uri = misc.makeUri(e.uri, this.workdir);
//         await this.showDocument(uri);
//         if (reverse) {
//           await vscode.commands.executeCommand('revealLine', {
//             lineNumber: e.revVisible.start,
//             at: 'top',
//           });
//         } else {
//           await vscode.commands.executeCommand('revealLine', {
//             lineNumber: e.visible.start,
//             at: 'top',
//           });
//         }
//         return true;
//       }

//       case 'save': {
//         const uri = misc.makeUri(e.uri, this.workdir);
//         const textEditor = await this.showDocument(uri);
//         if (!(await textEditor.document.save())) {
//           throw new Error(`Could not save ${textEditor.document.uri}`);
//         }
//         return true;
//       }

//       case 'stop': {
//         this.stop();
//         return true;
//       }

//       case 'reverse': {
//         await this.handleEvent(e.event, true);
//         return true;
//       }

//       default:
//         return false;
//     }
//   }

//   async showDocument(uri: Uri): Promise<TextEditor> {
//     // uri = this.getAbsUri(uri);
//     let textEditor = vscode.window.activeTextEditor;
//     let curUri = textEditor?.document.uri;
//     if (!textEditor || curUri?.scheme !== uri.scheme || curUri?.path !== uri.path) {
//       const document = await vscode.workspace.openTextDocument(uri);
//       textEditor = await vscode.window.showTextDocument(document);
//     }
//     return textEditor;
//   }

//   // getAbsUri(uri: Uri): Uri {
//   //   if (uri.scheme === 'file') {
//   //     return uri.with({ path: path.join(this.workdir, uri.path) });
//   //   }
//   //   return uri;
//   // }
// }
