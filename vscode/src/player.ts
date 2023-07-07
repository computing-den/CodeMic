import * as misc from './misc';
import * as ir from './internal_representation';
import * as vscode from 'vscode';
import _ from 'lodash';
import * as fs from 'fs';
import path from 'path';
import moment from 'moment';

export default class Player {
  context: vscode.ExtensionContext;
  disposables: vscode.Disposable[] = [];
  // hash: string = '';
  // git: GitAPI;
  // repo?: Repository;
  // workdir: string = '';
  isPlaying: boolean = false;
  session: ir.Session;

  static fromFile(context: vscode.ExtensionContext, filename: string): Player {
    return new Player(context, ir.Session.fromFile(filename));
  }

  constructor(context: vscode.ExtensionContext, session: ir.Session) {
    console.log('Player: start');
    this.context = context;
    this.session = session;
    this.isPlaying = true;

    // ignore user input
    {
      const disposable = vscode.commands.registerCommand('type', (e: { text: string }) => {
        const uri = vscode.window.activeTextEditor?.document.uri;
        if (!uri || !misc.isUriPartOfRecording(uri)) {
          // approve the default type command
          vscode.commands.executeCommand('default:type', e);
        }
      });
      this.disposables.push(disposable);
    }

    // register disposables
    this.context.subscriptions.push(...this.disposables);
  }

  update(time: number) {
    console.log('Player: update ', time);
  }

  stop() {
    this.isPlaying = false;
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
  }
}
