import config from './config.js';
import * as vscode from 'vscode';
import assert from 'assert';
import _ from 'lodash';
import { v4 as uuid } from 'uuid';
import * as t from '../lib/types.js';
import * as b from '../lib/bus.js';
import { basePaths } from './paths.js';

class WebviewProvider implements vscode.WebviewViewProvider {
  static readonly viewType = 'codemic-view';

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

    console.log('resolveWebviewView localResourceRoots', vscode.Uri.joinPath(this.context.extensionUri));

    webviewView.webview.options = {
      // Allow scripts in the webview
      enableScripts: true,

      // Allow access to files from these directories
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri), vscode.Uri.file(basePaths.data)],
    };

    webviewView.webview.html = this.getHtmlForWebview();
    webviewView.webview.onDidReceiveMessage(this.bus.handleParcel.bind(this.bus));
    this.onViewOpen();
  }

  // hasView(): boolean {
  //   return Boolean(this.view);
  // }

  // show() {
  //   this.view?.show();
  // }

  async postMessage(req: t.BackendRequest): Promise<t.FrontendResponse> {
    assert(this.bus);
    const res = (await this.bus.post(req)) as t.FrontendResponse;

    if (res.type === 'error') {
      throw new Error(`Got error for request ${JSON.stringify(req)}`);
    }
    return res;
  }

  // asWebviewUri(uri: vscode.Uri): vscode.Uri | undefined {
  //   return this.view?.webview.asWebviewUri(uri);
  // }

  private postParcel(parcel: b.Parcel): Promise<boolean> {
    assert(this.view);
    return this.view.webview.postMessage(parcel) as Promise<boolean>;
  }

  private getHtmlForWebview() {
    const webview = this.view!.webview;
    const getPath = (...args: string[]) =>
      webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, ...args));

    const resourcesUri = getPath('resources');
    const webviewJs = getPath('dist', 'webview.js');
    const webviewCss = getPath('dist', 'webview.css');
    // const codiconCss = getPath('..', '..', 'node_modules', '@vscode', 'codicons', 'dist', 'codicon.css');
    // const font = getPath('webview', 'node_modules', '@vscode', 'codicons', 'dist', 'codicon.ttf');

    return `<!DOCTYPE html>
			<html lang="en">
			<head>
				<meta charset="UTF-8">
				<meta name="viewport" content="width=device-width, initial-scale=1.0">
        <base href="${resourcesUri}/">
        <link href="${webviewCss}" rel="stylesheet">
				<!--
					Use a content security policy to only allow loading specific resources in the webview
				-->
				<meta http-equiv="Content-Security-Policy" content="default-src ${webview.cspSource}; style-src 'unsafe-inline' ${webview.cspSource}; img-src ${webview.cspSource} ${config.server}">
				<title>CodeMic</title>
			</head>
			<body>
        <div id="app"></div>
        <script src="${webviewJs}" type="module"></script>
			</body>
			</html>`;
  }
}

export default WebviewProvider;
