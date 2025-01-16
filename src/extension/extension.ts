import CodeMic from './codemic.js';
import _ from 'lodash';
import * as vscode from 'vscode';

let codemic: CodeMic;

export async function activate(extensionContext: vscode.ExtensionContext) {
  try {
    codemic = await CodeMic.fromExtensionContext(extensionContext);
    await codemic.start();

    // debug
    //@ts-ignore
    globalThis.extensionContext = extensionContext;
    //@ts-ignore
    globalThis.codemic = codemic;
    //@ts-ignore
    globalThis.vscode = vscode;
    //@ts-ignore
    globalThis._ = _;
  } catch (error: any) {
    console.error(error);
    vscode.window.showErrorMessage(error.message);
  }
}

export async function deactivate() {
  try {
    await codemic?.deactivate();
  } catch (error: any) {
    console.error(error);
    vscode.window.showErrorMessage(error.message);
  }
}
