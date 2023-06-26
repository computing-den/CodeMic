import Recorder from './recorder';
// import Replay from './replay';
import ViewProvider from './view_provider';
import assert from 'node:assert/strict';
import * as util from 'node:util';
import * as vscode from 'vscode';
import _ from 'lodash';

class Codecast {
  context: vscode.ExtensionContext;
  recorder: Recorder | undefined;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;

    context.subscriptions.push(
      vscode.commands.registerCommand('codecast.record', this.record.bind(this)),
      vscode.commands.registerCommand(
        'codecast.stop_recording',
        this.stopRecording.bind(this),
      ),
      vscode.commands.registerCommand(
        'codecast.save_recording',
        this.saveRecording.bind(this),
      ),
    );

    const provider = new ViewProvider(context.extensionUri);

    context.subscriptions.push(
      vscode.window.registerWebviewViewProvider(ViewProvider.viewType, provider),
    );
  }

  record() {
    if (this.recorder?.isRecording) {
      vscode.window.showInformationMessage('Codecast is already open.');
      return;
    }
    this.recorder = new Recorder(this.context);
  }

  stopRecording() {
    this.recorder?.stop();
  }

  saveRecording() {
    this.recorder?.save();
  }

  deactivate = () => {
    // TODO
  };
}

export default Codecast;
