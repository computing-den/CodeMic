import Codecast from './codecast.js';
import _ from 'lodash';
import * as vscode from 'vscode';

let codecast: Codecast;

export async function activate(context: vscode.ExtensionContext) {
  try {
    codecast = await Codecast.fromContext(context);

    // debug
    //@ts-ignore
    globalThis.context = context;
    //@ts-ignore
    globalThis.vscode = vscode;
    //@ts-ignore
    globalThis._ = _;
  } catch (error: any) {
    vscode.window.showErrorMessage(error.message);
  }
}

export function deactivate() {
  codecast?.deactivate();
}
