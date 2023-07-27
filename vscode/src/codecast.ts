import * as misc from './misc';
import Recorder from './recorder';
import Player from './player';
import WebviewProvider from './webview_provider';
import * as vscode from 'vscode';
import _ from 'lodash';
import * as ui from './lib/ui';

class Codecast {
  context: vscode.ExtensionContext;
  screen: ui.Screen = ui.Screen.Welcome;
  recorder?: Recorder;
  player?: Player;
  webview: WebviewProvider;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;

    context.subscriptions.push(vscode.commands.registerCommand('codecast.openView', this.openView.bind(this)));

    this.webview = new WebviewProvider(context.extensionUri, this.messageHandler.bind(this));

    context.subscriptions.push(
      vscode.window.registerWebviewViewProvider(WebviewProvider.viewType, this.webview, {
        webviewOptions: { retainContextWhenHidden: true },
      }),
    );
  }

  async messageHandler(req: ui.FrontendRequest): Promise<ui.BackendResponse> {
    console.log('extension received: ', req);

    switch (req.type) {
      case 'openWelcome': {
        await this.closeCurrentScreen();
        return this.respondWithStore();
      }
      case 'openPlayer': {
        if (await this.closeCurrentScreen()) {
          this.screen = ui.Screen.Player;
          this.player ??= Player.fromFile(this.context, misc.getDefaultRecordingPath());
        }
        return this.respondWithStore();
      }
      case 'openRecorder': {
        if (await this.closeCurrentScreen()) {
          this.screen = ui.Screen.Recorder;
          this.recorder ??= new Recorder(this.context);
        }
        return this.respondWithStore();
      }
      // case 'closePlayer': {
      //   if (this.player) {
      //     // nothing to do
      //   }
      //   return this.respondWithStore();
      // }
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
        if (this.recorder) {
          this.recorder.start();
          return this.respondWithStore();
        } else {
          vscode.window.showInformationMessage('Codecast recorder is not open.');
          return { type: 'error' };
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
      case 'pausePlayer': {
        this.player?.pause();
        return this.respondWithStore();
      }
      case 'pauseRecorder': {
        this.recorder?.pause();
        return this.respondWithStore();
      }
      // case 'save': {
      //   if (this.recorder) {
      //     this.recorder.save();
      //     return this.respondWithStore();
      //   } else {
      //     vscode.window.showInformationMessage('Codecast is not recording.');
      //     return { type: 'error' };
      //   }
      // }
      // case 'discard': {
      //   if (this.recorder) {
      //     this.recorder.stop();
      //     this.recorder = undefined;
      //     return this.respondWithStore();
      //   } else {
      //     vscode.window.showInformationMessage('Codecast is not recording.');
      //     return { type: 'error' };
      //   }
      // }
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
  }

  async closeCurrentScreen(): Promise<boolean> {
    if (this.screen === ui.Screen.Recorder) {
      return await this.closeRecorder();
    } else if (this.screen === ui.Screen.Player) {
      return await this.closePlayer();
    }
    return true;
  }

  async closeRecorder(): Promise<boolean> {
    if (this.recorder!.isRecording) {
      const saveTitle = 'Save and exit';
      const answer = await vscode.window.showWarningMessage(
        'Recording is in progress. Do you wish to stop the session?',
        { modal: true, detail: 'The session will be saved if you stop recording.' },
        { title: saveTitle },
        { title: 'Cancel', isCloseAffordance: true },
      );
      if (answer?.title !== saveTitle) return false;
    }
    this.recorder!.stop();
    this.recorder = undefined;
    this.screen = ui.Screen.Welcome;
    return true;
  }

  async closePlayer(): Promise<boolean> {
    this.player!.stop();
    this.player = undefined;
    this.screen = ui.Screen.Welcome;
    return true;
  }

  openView() {
    this.webview.show();
  }

  deactivate() {
    // TODO
  }

  respondWithStore(): ui.BackendResponse {
    return { type: 'getStore', store: this.getStore() };
  }

  getStore(): ui.Store {
    return {
      screen: this.screen,
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
  }
}

export default Codecast;
