import * as misc from './misc';
import Recorder from './recorder';
import Player from './player';
import WebviewProvider from './webview_provider';
import * as vscode from 'vscode';
import _ from 'lodash';
import * as ui from './lib/ui';

class Codecast {
  context: vscode.ExtensionContext;
  recorder?: Recorder;
  player?: Player;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;

    context.subscriptions.push(
      vscode.commands.registerCommand('codecast.record', this.record.bind(this)),
      vscode.commands.registerCommand('codecast.stop_recording', this.stopRecording.bind(this)),
      vscode.commands.registerCommand('codecast.save_recording', this.saveRecording.bind(this)),
    );

    const webview = new WebviewProvider(context.extensionUri, this.receivedMessage);

    context.subscriptions.push(vscode.window.registerWebviewViewProvider(WebviewProvider.viewType, webview));
  }

  receivedMessage = (e: ui.Event) => {
    console.log('extension received: ', e);

    switch (e.type) {
      case 'play': {
        this.player ??= Player.fromFile(this.context, misc.getDefaultRecordingPath());
        break;
      }
      case 'playbackUpdate': {
        if (!this.player?.isPlaying) {
          console.error('got playbackUpdate but player is not playing');
          return;
        }
        this.player.update(e.time);
        break;
      }
    }
  };

  record = () => {
    if (this.recorder?.isRecording) {
      vscode.window.showInformationMessage('Codecast is already open.');
      return;
    }
    this.recorder = new Recorder(this.context);
  };

  stopRecording = () => {
    this.recorder?.stop();
  };

  saveRecording = () => {
    this.recorder?.save();
  };

  deactivate = () => {
    // TODO
  };
}

export default Codecast;
