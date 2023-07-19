import * as vscode from 'vscode';
import assert from 'assert';
import _ from 'lodash';
import { v4 as uuid } from 'uuid';
import * as ui from './lib/ui';
import Bus from './lib/bus';
import type { MessageHandler, PostParcel, Parcel, ParcelMsg } from './lib/bus';

class WebviewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'codecast-view';

  view?: vscode.WebviewView;
  bus?: Bus;

  constructor(public readonly extensionUri: vscode.Uri, public messageHandler: MessageHandler) {}

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ) {
    this.bus = new Bus(this.postParcel.bind(this), this.messageHandler);
    this.view = webviewView;

    webviewView.webview.options = {
      // Allow scripts in the webview
      enableScripts: true,

      localResourceRoots: [this.extensionUri],
    };

    webviewView.webview.html = this.getHtmlForWebview(webviewView.webview);
    webviewView.webview.onDidReceiveMessage(this.bus.handleParcel.bind(this.bus));
  }

  public show() {
    this.view?.show();
  }

  public async postMessage(e: ui.BackendEvent): Promise<ui.FrontendResponse> {
    assert(this.bus);
    return this.bus.post(e) as Promise<ui.FrontendResponse>;
  }

  private postParcel(parcel: Parcel): Promise<boolean> {
    assert(this.view);
    return this.view.webview.postMessage(parcel) as Promise<boolean>;
  }

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
