// import * as misc from './misc';
// import Recorder from './recorder';
// import Replay from './replay';
// import InputProcessor from './input_processor';
// import assert from 'node:assert/strict';
// import * as util from 'node:util';
// import * as vscode from 'vscode';
// import _ from 'lodash';
// import * as CP from 'node:child_process';

// import type { CcEvent } from './types';
// import type { ExtensionContext } from 'vscode';

// let context: ExtensionContext | undefined;
// let recorder: Recorder | undefined;
// let replay: Replay | undefined;
// let playerProc: CP.ChildProcessWithoutNullStreams | undefined;
// let playerProcCtrl: AbortController | undefined;
// let playerStdoutCh: vscode.OutputChannel | undefined;
// let playerStderrCh: vscode.OutputChannel | undefined;

// export function activate(context_: ExtensionContext) {
//   context = context_;

//   // debug
//   //@ts-ignore
//   globalThis.context = context;
//   //@ts-ignore
//   globalThis.vscode = vscode;
//   //@ts-ignore
//   globalThis._ = _;

//   recorder = new Recorder(context, emitEvent);
//   replay = new Replay(context, emitEvent);

//   // const rootPath = (vscode.workspace.workspaceFolders && (vscode.workspace.workspaceFolders.length > 0))
//   // 	? vscode.workspace.workspaceFolders[0].uri.fsPath : undefined;

//   const disposables = [
//     vscode.commands.registerCommand('codecast', openCodecast),
//     // vscode.commands.registerCommand('codecast.record', record),
//     // vscode.commands.registerCommand('codecast.play', play),
//     // vscode.commands.registerCommand('codecast.stop', stop),
//     // vscode.commands.registerCommand('codecast.test', test),
//   ];

//   context.subscriptions.push(...disposables);

//   const provider = new CodecastViewProvider(context.extensionUri);

//   context.subscriptions.push(
//     vscode.window.registerWebviewViewProvider(CodecastViewProvider.viewType, provider),
//   );
// }

// export function deactivate() {
//   playerProcCtrl?.abort();
// }

// function openCodecast() {
//   assert(context);
//   if (playerProc) {
//     vscode.window.showInformationMessage('Codecast is already open.');
//     return;
//   }

//   playerProcCtrl = new AbortController();
//   let playerStdoutBuf = '';

//   playerProc = CP.spawn(
//     vscode.Uri.joinPath(context.extensionUri, 'player', 'codecast').path,
//     [],
//     {
//       cwd: vscode.Uri.joinPath(context.extensionUri, 'player').path,
//       signal: playerProcCtrl.signal,
//     },
//   );

//   // Create output channels for player
//   playerStdoutCh = vscode.window.createOutputChannel('Player stdout');
//   playerStderrCh = vscode.window.createOutputChannel('Player stderr');
//   playerStderrCh.show();

//   playerProc.on('error', error => {
//     console.error(error);
//     vscode.window.showErrorMessage(`Failed to open Codecast: ${error.message}`);
//   });

//   // create input processor and fill it up
//   const inputProcessor = new InputProcessor(receivedFromPlayer);
//   playerProc.stdout.on('data', data => inputProcessor.push(data));

//   playerProc.stderr.on('data', data => {
//     playerStderrCh?.append(data.toString());
//   });

//   playerProc.on('close', async code => {
//     try {
//       await inputProcessor.close();
//       if (code === 0) {
//         console.log(`player exited`);
//       } else {
//         console.error(`player exited with code ${code}`);
//       }
//       playerProc = undefined;
//       playerProcCtrl = undefined;
//       stop();
//     } catch (error) {
//       console.error(error);
//     }
//   });
// }

// async function receivedFromPlayer(error: Error | undefined, line: string) {
//   try {
//     if (error) {
//       console.error(error);
//       return;
//     }

//     assert(context);
//     playerStdoutCh?.appendLine(line);
//     if (!line.length) return;

//     const event = JSON.parse(line) as CcEvent;
//     let handled =
//       (await recorder?.handleEvent(event)) || (await replay?.handleEvent(event));
//     if (!handled) {
//       throw new Error(`receivedFromPlayer: cannot handle event: ${line}`);
//     }
//   } catch (error) {
//     console.error(`receivedFromPlayer: error while processing line: ${line}`);
//     console.error(error);
//   }
// }

// function stop() {
//   recorder?.stop();
//   replay?.stop();
// }

// function emitEvent(event: CcEvent): Promise<void> {
//   return new Promise((resolve, reject) => {
//     if (!playerProc) {
//       // vscode.window.showErrorMessage(`Codecast window is not open`);
//       reject(new Error('Codecast player is closed'));
//       return;
//     }

//     playerProc?.stdin.write(JSON.stringify(event) + '\n', error => {
//       if (error) {
//         // vscode.window.showErrorMessage(`Failed to communicate with the Codecast player`);
//         console.error('Error while writing to Player: ', error);
//         reject(error);
//       } else {
//         resolve();
//       }
//     });
//   });
// }

// //==================================================
// // View Provider
// //==================================================

// class CodecastViewProvider implements vscode.WebviewViewProvider {
//   public static readonly viewType = 'codecast-view';

//   private _view?: vscode.WebviewView;

//   constructor(private readonly _extensionUri: vscode.Uri) {}

//   public resolveWebviewView(
//     webviewView: vscode.WebviewView,
//     context: vscode.WebviewViewResolveContext,
//     _token: vscode.CancellationToken,
//   ) {
//     this._view = webviewView;

//     webviewView.webview.options = {
//       // Allow scripts in the webview
//       enableScripts: true,

//       localResourceRoots: [this._extensionUri],
//     };

//     webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

//     webviewView.webview.onDidReceiveMessage(data => {
//       switch (data.type) {
//         case 'colorSelected': {
//           vscode.window.activeTextEditor?.insertSnippet(
//             new vscode.SnippetString(`#${data.value}`),
//           );
//           break;
//         }
//       }
//     });
//   }

//   public addColor() {
//     if (this._view) {
//       this._view.show?.(true); // `show` is not implemented in 1.49 but is for 1.50 insiders
//       this._view.webview.postMessage({ type: 'addColor' });
//     }
//   }

//   public clearColors() {
//     if (this._view) {
//       this._view.webview.postMessage({ type: 'clearColors' });
//     }
//   }

//   private _getHtmlForWebview(webview: vscode.Webview) {
//     // Get the local path to main script run in the webview, then convert it to a uri we can use in the webview.
//     const scriptUri = webview.asWebviewUri(
//       vscode.Uri.joinPath(this._extensionUri, 'resources', 'main.js'),
//     );

//     // Do the same for the stylesheet.
//     const styleResetUri = webview.asWebviewUri(
//       vscode.Uri.joinPath(this._extensionUri, 'resources', 'reset.css'),
//     );
//     const styleVSCodeUri = webview.asWebviewUri(
//       vscode.Uri.joinPath(this._extensionUri, 'resources', 'vscode.css'),
//     );
//     const styleMainUri = webview.asWebviewUri(
//       vscode.Uri.joinPath(this._extensionUri, 'resources', 'main.css'),
//     );

//     // Use a nonce to only allow a specific script to be run.
//     const nonce = getNonce();

//     return `<!DOCTYPE html>
// 			<html lang="en">
// 			<head>
// 				<meta charset="UTF-8">
// 				<!--
// 					Use a content security policy to only allow loading styles from our extension directory,
// 					and only allow scripts that have a specific nonce.
// 					(See the 'webview-sample' extension sample for img-src content security policy examples)
// 				-->
// 				<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
// 				<meta name="viewport" content="width=device-width, initial-scale=1.0">
// 				<link href="${styleResetUri}" rel="stylesheet">
// 				<link href="${styleVSCodeUri}" rel="stylesheet">
// 				<link href="${styleMainUri}" rel="stylesheet">
// 				<title>Cat Colors</title>
// 			</head>
// 			<body>
//         TODO
//         <script nonce="${nonce}" src="${scriptUri}"></script>
// 			</body>
// 			</html>`;
//   }
// }

// function getNonce() {
//   let text = '';
//   const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
//   for (let i = 0; i < 32; i++) {
//     text += possible.charAt(Math.floor(Math.random() * possible.length));
//   }
//   return text;
// }

// // async function test() {
// //   try {
// //     // see https://github.com/gitkraken/vscode-gitlens/blob/957e76df2d3ef62df8eb253e8d6494218a108558/src/%40types/vscode.git.d.ts
// //     // see https://github.com/microsoft/vscode/blob/main/extensions/git/src/api/git.d.ts
// //     // const head = '85a158d';
// //     const head_ = '5d1024c';
// //     const extension = vscode.extensions.getExtension(
// //       'vscode.git',
// //     ) as Extension<GitExtension>;
// //     if (extension !== undefined) {
// //       const gitExtension = extension.isActive
// //         ? extension.exports
// //         : await extension.activate();
// //       const api = gitExtension.getAPI(1);
// //       const rep = api.repositories[0];
// //       const logs = await rep.log();
// //       const refs = await rep.getRefs({ contains: head_ });
// //       console.log(refs);
// //       // [{name: 'master', commit: '85a158d50123fb4f4654c34f0cb046f1e7b05835', type: 0}]
// //       // const state = rep.state;
// //       // debugger;
// //       // const refs = await rep.getRefs()
// //       // const logsStrs = _.map(
// //       //   logs,
// //       //   l => `${l.hash}: ${l.commitDate || '<>'} ${l.message}`,
// //       // );
// //       // const currentHead = rep.state.HEAD?.commit;
// //       const items = _.map(logs, l => ({
// //         hash: l.hash,
// //         label: (l.hash || '').substring(0, 7),
// //         description: moment(l.commitDate).format('DD-MM-YYYY') || '',
// //         detail: l.message || '',
// //       }));
// //       const commit = await vscode.window.showQuickPick(items, {
// //         title: 'Pick commit',
// //       });
// //       if (commit) {
// //         await rep.checkout(commit.hash);
// //       }
// //       // const state = rep.state;
// //       // const head = state.HEAD;
// //       // if (head) {
// //       //   console.log(head.commit);
// //       // }
// //     }
// //   } catch (error) {
// //     console.error(error);
// //   }
// // }

// // async function test() {
// //   assert(context);

// //   const panel = vscode.window.createWebviewPanel(
// //     'catCoding', // Identifies the type of the webview. Used internally
// //     'Cat Coding', // Title of the panel displayed to the user
// //     vscode.ViewColumn.One, // Editor column to show the new webview panel in.
// //     {}, // Webview options. More on these later.
// //   );

// //   // And set its HTML content
// //   panel.webview.html = getWebviewContent();

// //   panel.onDidDispose(
// //     () => {
// //       // ...
// //     },
// //     null,
// //     context.subscriptions,
// //   );

// //   // ---------
// //   // local URI
// //   // ---------
// //   // // Get path to resource on disk
// //   // const onDiskPath = vscode.Uri.joinPath(context.extensionUri, 'media', 'cat.gif');

// //   // // And get the special URI to use with the webview
// //   // const catGifSrc = panel.webview.asWebviewUri(onDiskPath);

// //   // panel.webview.html = getWebviewContent(catGifSrc);
// // }

// // function getWebviewContent() {
// //   return `<!DOCTYPE html>
// // <html lang="en">
// // <head>
// //     <meta charset="UTF-8">
// //     <meta name="viewport" content="width=device-width, initial-scale=1.0">
// //     <title>Cat Coding</title>
// // </head>
// // <body>
// //     <img src="https://media.giphy.com/media/JIX9t2j0ZTN9S/giphy.gif" width="300" />
// // </body>
// // </html>`;
// // }
