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
      getPath('resources', 'normalize-8.0.1.css'),
      getPath('resources', 'vscode.css'),
      getPath('webview', 'out', 'webview.css'),
    ];

    // Using a content security policy to only allow loading styles from our extension directory,
    // and only allow scripts that have a specific nonce.
    // (See the 'webview-sample' extension sample for img-src content security policy examples)
    const nonce = uuid();
    return `<!DOCTYPE html>
			<html lang="en">
			<head>
				<meta charset="UTF-8">
				<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${
          webview.cspSource
        }; script-src 'nonce-${nonce}';">
				<meta name="viewport" content="width=device-width, initial-scale=1.0">
        ${styles.map(uri => `<link href="${uri}" rel="stylesheet">`).join('\n')}
				<title>Codecast</title>
			</head>
			<body>
        <div id="app"></div>
        ${scripts.map(uri => `<script nonce="${nonce}" src="${uri}" type="module"></script>`)}
			</body>
			</html>`;
  }
}

export default WebviewProvider;
