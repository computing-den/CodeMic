import * as vscode from 'vscode';
import _ from 'lodash';
import { v4 as uuid } from 'uuid';
import * as ui from './lib/ui';

class WebviewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'codecast-view';

  view?: vscode.WebviewView;

  constructor(public readonly extensionUri: vscode.Uri, public onDidReceiveMessage: (e: ui.Event) => void) {}

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ) {
    this.view = webviewView;

    webviewView.webview.options = {
      // Allow scripts in the webview
      enableScripts: true,

      localResourceRoots: [this.extensionUri],
    };

    webviewView.webview.html = this.getHtmlForWebview(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(this.onDidReceiveMessage);
  }

  public show() {
    this.view?.show();
  }

  // public addColor() {
  //   if (this.view) {
  //     this.view.show?.(true); // `show` is not implemented in 1.49 but is for 1.50 insiders
  //     this.view.webview.postMessage({ type: 'addColor' });
  //   }
  // }

  // public clearColors() {
  //   if (this.view) {
  //     this.view.webview.postMessage({ type: 'clearColors' });
  //   }
  // }

  private getHtmlForWebview(webview: vscode.Webview) {
    const getPath = (...args: string[]) => webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, ...args));

    const scripts = [getPath('webview', 'out', 'webview.js')];

    const styles = [
      getPath('webview', 'resources', 'normalize-8.0.1.css'),
      getPath('webview', 'resources', 'vscode.css'),
      getPath('webview', 'out', 'webview.css'),
      getPath('webview', 'node_modules', '@vscode', 'codicons', 'dist', 'codicon.css'),
    ];

    // const font = getPath('webview', 'node_modules', '@vscode', 'codicons', 'dist', 'codicon.ttf');

    return `<!DOCTYPE html>
			<html lang="en">
			<head>
				<meta charset="UTF-8">
				<meta name="viewport" content="width=device-width, initial-scale=1.0">
        ${styles.map(uri => `<link href="${uri}" rel="stylesheet">`).join('\n')}
				<title>Codecast</title>
			</head>
			<body>
        <div id="app"></div>
        ${scripts.map(uri => `<script src="${uri}" type="module"></script>`)}
			</body>
			</html>`;
  }
}

export default WebviewProvider;
