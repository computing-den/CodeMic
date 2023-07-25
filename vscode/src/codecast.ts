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
  webview: WebviewProvider;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;

    context.subscriptions.push(vscode.commands.registerCommand('codecast.openView', this.openView.bind(this)));

    this.webview = new WebviewProvider(context.extensionUri, this.messageHandler);

    context.subscriptions.push(
      vscode.window.registerWebviewViewProvider(WebviewProvider.viewType, this.webview, {
        webviewOptions: { retainContextWhenHidden: true },
      }),
    );
  }

  messageHandler = async (req: ui.FrontendRequest): Promise<ui.BackendResponse> => {
    console.log('extension received: ', req);

    switch (req.type) {
      case 'openPlayer': {
        if (this.player) {
          vscode.window.showInformationMessage('Codecast is already playing.');
          return { type: 'error' };
        } else {
          this.player = Player.fromFile(this.context, misc.getDefaultRecordingPath());
          return this.respondWithStore();
        }
      }
      case 'play': {
        if (this.player) {
          this.player.start();
          return this.respondWithStore();
        } else {
          vscode.window.showInformationMessage('Codecast player is not open.');
          return { type: 'error' };
        }
      }
      case 'record': {
        if (this.recorder?.isRecording) {
          vscode.window.showInformationMessage('Codecast is already recording.');
          return { type: 'error' };
        } else {
          this.recorder = new Recorder(this.context);
          return this.respondWithStore();
        }
      }
      case 'seek': {
        if (this.player) {
          await this.player.update(req.clock);
          return this.respondWithStore();
        } else {
          vscode.window.showInformationMessage('Codecast is not playing.');
          return { type: 'error' };
        }
      }
      case 'stop': {
        if (this.recorder) {
          this.recorder.stop();
          return this.respondWithStore();
        } else if (this.player) {
          this.player.stop();
          return this.respondWithStore();
        } else {
          vscode.window.showInformationMessage('Codecast is not playing or recording.');
          return { type: 'error' };
        }
      }
      case 'save': {
        if (this.recorder) {
          this.recorder.save();
          return this.respondWithStore();
        } else {
          vscode.window.showInformationMessage('Codecast is not recording.');
          return { type: 'error' };
        }
      }
      case 'discard': {
        if (this.recorder) {
          this.recorder.stop();
          this.recorder = undefined;
          return this.respondWithStore();
        } else {
          vscode.window.showInformationMessage('Codecast is not recording.');
          return { type: 'error' };
        }
      }
      case 'playbackUpdate': {
        if (!this.player?.isPlaying) {
          console.error('got playbackUpdate but player is not playing');
          return { type: 'error' };
        }
        this.player.update(req.clock);
        return this.respondWithStore();
      }
      case 'getStore': {
        return this.respondWithStore();
      }
      default: {
        misc.unreachable(req);
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

  respondWithStore = (): ui.BackendResponse => {
    return { type: 'getStore', store: this.getStore() };
  };

  getStore = (): ui.Store => {
    return {
      recorder: {
        workspaceFolders: vscode.workspace.workspaceFolders?.map(x => x.uri.path) || [],
        session: this.recorder && {
          isRecording: this.recorder.isRecording,
          duration: this.recorder.getClock(),
          name: 'Name (TODO)',
          path: 'Path/TODO',
        },
      },
      player: this.player && {
        isPlaying: this.player.isPlaying,
        duration: this.player.getDuration(),
        clock: this.player.getClock(),
        name: 'Name (TODO)',
        path: 'Path/TODO',
      },
    };
  };
}

export default Codecast;
