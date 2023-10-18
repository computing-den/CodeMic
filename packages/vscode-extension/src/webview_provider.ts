import * as vscode from 'vscode';
import assert from 'assert';
import _ from 'lodash';
import { v4 as uuid } from 'uuid';
import { types as t, bus as b } from '@codecast/lib';
import userPaths from './user_paths.js';

class WebviewProvider implements vscode.WebviewViewProvider {
  static readonly viewType = 'codecast-view';

  view?: vscode.WebviewView;
  bus?: b.Bus;

  constructor(
    public context: vscode.ExtensionContext,
    public messageHandler: b.MessageHandler,
    public onViewOpen: () => void,
  ) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ) {
    this.bus = new b.Bus(this.postParcel.bind(this), this.messageHandler);
    this.view = webviewView;

    console.log('resolveWebviewView localResourceRoots', vscode.Uri.joinPath(this.context.extensionUri, '..', '..'));

    webviewView.webview.options = {
      // Allow scripts in the webview
      enableScripts: true,

      // Allow access to files from these directories
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, '..', '..'), vscode.Uri.file(userPaths.data)],
    };

    webviewView.webview.html = this.getHtmlForWebview();
    webviewView.webview.onDidReceiveMessage(this.bus.handleParcel.bind(this.bus));
    this.onViewOpen();
  }

  show() {
    this.view?.show();
  }

  async postMessage<Req extends t.BackendRequest>(req: Req): Promise<t.FrontendResponseFor<Req>> {
    assert(this.bus);
    const res = (await this.bus.post(req)) as t.FrontendResponseFor<Req> | t.ErrorResponse;

    if (res.type === 'error') {
      throw new Error(`Got error for request ${JSON.stringify(req)}`);
    }
    return res;
  }

  asWebviewUri(uri: vscode.Uri): vscode.Uri | undefined {
    return this.view?.webview.asWebviewUri(uri);
  }

  private postParcel(parcel: b.Parcel): Promise<boolean> {
    assert(this.view);
    return this.view.webview.postMessage(parcel) as Promise<boolean>;
  }

  private getHtmlForWebview() {
    const getPath = (...args: string[]) => this.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, ...args))!;

    const resourcesUri = getPath('..', 'vscode-webview', 'resources');
    const webviewJs = getPath('..', 'vscode-webview', 'out', 'webview.js');
    const webviewCss = getPath('..', 'vscode-webview', 'out', 'webview.css');
    const codiconCss = getPath('..', '..', 'node_modules', '@vscode', 'codicons', 'dist', 'codicon.css');
    // const font = getPath('webview', 'node_modules', '@vscode', 'codicons', 'dist', 'codicon.ttf');

    return `<!DOCTYPE html>
			<html lang="en">
			<head>
				<meta charset="UTF-8">
				<meta name="viewport" content="width=device-width, initial-scale=1.0">
        <base href="${resourcesUri}/">
        <link href="${webviewCss}" rel="stylesheet">
        <link href="${codiconCss}" rel="stylesheet">
				<title>Codecast</title>
			</head>
			<body>
        <div id="app"></div>
        <script src="${webviewJs}" type="module"></script>
			</body>
			</html>`;
  }
}

export default WebviewProvider;
