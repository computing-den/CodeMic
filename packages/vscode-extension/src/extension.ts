import Codecast from './codecast.js';
import _ from 'lodash';
import * as vscode from 'vscode';

let codecast: Codecast;

export function activate(context: vscode.ExtensionContext) {
  codecast = new Codecast(context);

  // debug
  //@ts-ignore
  globalThis.context = context;
  //@ts-ignore
  globalThis.vscode = vscode;
  //@ts-ignore
  globalThis._ = _;
}

export function deactivate() {
  codecast?.deactivate();
}
