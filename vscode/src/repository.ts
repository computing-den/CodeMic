// async function test() {
//   try {
//     // see https://github.com/gitkraken/vscode-gitlens/blob/957e76df2d3ef62df8eb253e8d6494218a108558/src/%40types/vscode.git.d.ts
//     // see https://github.com/microsoft/vscode/blob/main/extensions/git/src/api/git.d.ts
//     // const head = '85a158d';
//     const head_ = '5d1024c';
//     const extension = vscode.extensions.getExtension(
//       'vscode.git',
//     ) as Extension<GitExtension>;
//     if (extension !== undefined) {
//       const gitExtension = extension.isActive
//         ? extension.exports
//         : await extension.activate();
//       const api = gitExtension.getAPI(1);
//       const rep = api.repositories[0];
//       const logs = await rep.log();
//       const refs = await rep.getRefs({ contains: head_ });
//       console.log(refs);
//       // [{name: 'master', commit: '85a158d50123fb4f4654c34f0cb046f1e7b05835', type: 0}]
//       // const state = rep.state;
//       // debugger;
//       // const refs = await rep.getRefs()
//       // const logsStrs = _.map(
//       //   logs,
//       //   l => `${l.hash}: ${l.commitDate || '<>'} ${l.message}`,
//       // );
//       // const currentHead = rep.state.HEAD?.commit;
//       const items = _.map(logs, l => ({
//         hash: l.hash,
//         label: (l.hash || '').substring(0, 7),
//         description: moment(l.commitDate).format('DD-MM-YYYY') || '',
//         detail: l.message || '',
//       }));
//       const commit = await vscode.window.showQuickPick(items, {
//         title: 'Pick commit',
//       });
//       if (commit) {
//         await rep.checkout(commit.hash);
//       }
//       // const state = rep.state;
//       // const head = state.HEAD;
//       // if (head) {
//       //   console.log(head.commit);
//       // }
//     }
//   } catch (error) {
//     console.error(error);
//   }
// }

// async function test() {
//   assert(context);

//   const panel = vscode.window.createWebviewPanel(
//     'catCoding', // Identifies the type of the webview. Used internally
//     'Cat Coding', // Title of the panel displayed to the user
//     vscode.ViewColumn.One, // Editor column to show the new webview panel in.
//     {}, // Webview options. More on these later.
//   );

//   // And set its HTML content
//   panel.webview.html = getWebviewContent();

//   panel.onDidDispose(
//     () => {
//       // ...
//     },
//     null,
//     context.subscriptions,
//   );

//   // ---------
//   // local URI
//   // ---------
//   // // Get path to resource on disk
//   // const onDiskPath = vscode.Uri.joinPath(context.extensionUri, 'media', 'cat.gif');

//   // // And get the special URI to use with the webview
//   // const catGifSrc = panel.webview.asWebviewUri(onDiskPath);

//   // panel.webview.html = getWebviewContent(catGifSrc);
// }

// function getWebviewContent() {
//   return `<!DOCTYPE html>
// <html lang="en">
// <head>
//     <meta charset="UTF-8">
//     <meta name="viewport" content="width=device-width, initial-scale=1.0">
//     <title>Cat Coding</title>
// </head>
// <body>
//     <img src="https://media.giphy.com/media/JIX9t2j0ZTN9S/giphy.gif" width="300" />
// </body>
// </html>`;
// }
