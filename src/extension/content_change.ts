import type * as t from '../lib/types.js';
import vscode from 'vscode';

export default class ContentChange implements t.ContentChange {
  constructor(public text: string, public range: vscode.Range) {}
}
