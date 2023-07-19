import * as misc from './misc';
import Recorder from './recorder';
import Player from './player';
import WebviewProvider from './webview_provider';
import * as vscode from 'vscode';
import _ from 'lodash';
import * as ui from './lib/ui';
import Bus from './lib/bus';
import type { Message } from './lib/bus';

class Codecast {
  context: vscode.ExtensionContext;
  recorder?: Recorder;
  player?: Player;
  webview: WebviewProvider;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;

    context.subscriptions.push(
      vscode.commands.registerCommand('codecast.openView', this.openView.bind(this)),
      // vscode.commands.registerCommand('codecast.stop_recording', this.stopRecording.bind(this)),
      // vscode.commands.registerCommand('codecast.save_recording', this.saveRecording.bind(this)),
    );

    this.webview = new WebviewProvider(context.extensionUri, this.messageHandler);

    context.subscriptions.push(
      vscode.window.registerWebviewViewProvider(WebviewProvider.viewType, this.webview, {
        webviewOptions: { retainContextWhenHidden: true },
      }),
    );
  }

  messageHandler = async (msg: Message): Promise<ui.BackendResponse | undefined> => {
    const e = msg as ui.FrontendEvent;
    console.log('extension received: ', e);

    switch (e.type) {
      case 'play': {
        if (this.player) {
          vscode.window.showInformationMessage('Codecast is already playing.');
          return { type: 'no' };
        } else {
          this.player = Player.fromFile(this.context, misc.getDefaultRecordingPath());
          return { type: 'yes' };
        }
      }
      case 'record': {
        if (this.recorder?.isRecording) {
          vscode.window.showInformationMessage('Codecast is already recording.');
          return { type: 'no' };
        } else {
          this.recorder = new Recorder(this.context);
          return { type: 'yes' };
        }
      }
      case 'seek': {
        return { type: 'no' };
      }
      case 'stop': {
        if (this.recorder) {
          this.recorder.stop();
          return { type: 'yes' };
        } else {
          vscode.window.showInformationMessage('Codecast is not playing or recording.');
          return { type: 'no' };
        }
      }
      case 'playbackUpdate': {
        if (!this.player?.isPlaying) {
          console.error('got playbackUpdate but player is not playing');
          return { type: 'no' };
        }
        this.player.update(e.time);
        return { type: 'yes' };
      }
      default: {
        misc.unreachable(e);
      }
    }
  };

  openView = () => {
    this.webview.show();
  };

  saveRecording = () => {
    this.recorder?.save();
  };

  deactivate = () => {
    // TODO
  };
}

export default Codecast;
