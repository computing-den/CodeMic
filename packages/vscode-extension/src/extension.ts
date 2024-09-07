import CodeCast from './codecast.js';
import _ from 'lodash';
import * as vscode from 'vscode';

let codecast: CodeCast;

export async function activate(extensionContext: vscode.ExtensionContext) {
  try {
    codecast = await CodeCast.fromExtensionContext(extensionContext);
    // await codecast.restoreStateAfterRestart();

    // debug
    //@ts-ignore
    globalThis.extensionContext = extensionContext;
    //@ts-ignore
    globalThis.codecast = codecast;
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
    await codecast?.deactivate();
  } catch (error: any) {
    console.error(error);
    vscode.window.showErrorMessage(error.message);
  }
}
