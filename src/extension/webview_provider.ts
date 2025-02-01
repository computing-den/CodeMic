import config from './config.js';
import * as vscode from 'vscode';
import assert from 'assert';
import _ from 'lodash';
import * as t from '../lib/types.js';
import * as b from '../lib/bus.js';
import osPaths from './os_paths.js';

class WebviewProvider implements vscode.WebviewViewProvider {
  static readonly viewType = 'codemic-view';

  onMessage?: b.MessageHandler;
  onViewOpen?: () => void;

  private view?: vscode.WebviewView;
  private bus?: b.Bus;

  constructor(public extension: vscode.ExtensionContext) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _webviewContext: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ) {
    this.bus = new b.Bus(this.postParcel.bind(this), this.handleMessage.bind(this));
    this.view = webviewView;

    console.log('resolveWebviewView localResourceRoots', this.extension.extensionUri);

    // NOTE: Reassigning webview options causes the webview page to refresh!
    // Also, cannot mutate localResourceRoots directly. Must reassign options.
    // See https://github.com/microsoft/vscode-discussions/discussions/639
    webviewView.webview.options = {
      // Allow scripts in the webview
      enableScripts: true,

      // Allow access to files from these directories
      localResourceRoots: [
        this.extension.extensionUri,
        vscode.Uri.file(osPaths.data),
        vscode.Uri.file(osPaths.cache),
        ...(vscode.workspace.workspaceFolders ?? []).map(f => f.uri),
      ],
    };

    console.log('resolveWebviewView options: ', webviewView.webview.options);

    webviewView.webview.html = this.getHtmlForWebview();
    webviewView.webview.onDidReceiveMessage(this.bus.handleParcel.bind(this.bus));
    this.onViewOpen?.();
  }

  async handleMessage(msg: any): Promise<any> {
    return await this.onMessage?.(msg);
  }

  get isReady(): boolean {
    return Boolean(this.bus && this.view);
  }

  setTitle(title: string) {
    if (this.view) this.view.title = title;
  }

  show() {
    this.view?.show();
  }

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
      webview.asWebviewUri(vscode.Uri.joinPath(this.extension.extensionUri, ...args));

    const resourcesUri = getPath('resources');
    const webviewJs = getPath('dist', 'webview.js');
    const webviewCss = getPath('dist', 'webview.css');
    // const codiconCss = getPath('..', '..', 'node_modules', '@vscode', 'codicons', 'dist', 'codicon.css');
    // const font = getPath('webview', 'node_modules', '@vscode', 'codicons', 'dist', 'codicon.ttf');

    const webviewConfig: t.WebviewConfig = {
      debug: config.debug,
      webviewUriBase: webview.asWebviewUri(vscode.Uri.file('/')).toString(),
      extensionWebviewUri: webview.asWebviewUri(this.extension.extensionUri).toString(),
      server: config.server,
    };

    const sanitizedWebviewConfig = _.escape(JSON.stringify(webviewConfig));

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
        <div id="popovers"></div>
        <script type="application/json" id="config">
        ${sanitizedWebviewConfig}
        </script>
        <script src="${webviewJs}" type="module"></script>
			</body>
			</html>`;
  }
}

export default WebviewProvider;
