import * as misc from './misc.js';
import Recorder from './recorder.js';
import Player from './player.js';
import Workspace from './workspace.js';
import WebviewProvider from './webview_provider.js';
import * as vscode from 'vscode';
import _ from 'lodash';
import assert from 'assert';
import { types as t, lib, path } from '@codecast/lib';
import nodePath from 'path';

const SESSIONS: t.SessionSummary[] = [
  {
    id: 'fd4659dd-150a-408b-aac3-1bc815a83be9',
    title: 'DumDB part 2',
    description: 'A small DB easy to use',
    author: {
      name: 'sean_shir',
      avatar: 'avatar1.png',
    },
    published: false,
    uri: 'file:///home/sean/codecast/recordings/session.codecast' as t.Uri,
    defaultRoot: '/home/sean/workspace/dumdb' as t.AbsPath,
    duration: 78,
    views: 0,
    likes: 0,
    timestamp: '2023-07-08T14:22:35.344Z',
    toc: [
      { title: 'Intro', clock: 0 },
      { title: 'Setting things up', clock: 3 },
      { title: 'First function', clock: 8 },
      { title: 'Second function', clock: 16 },
      { title: 'Another thing here', clock: 100 },
      { title: 'More stuff', clock: 200 },
      { title: "Here's another topic", clock: 300 },
      { title: 'And here is a very long topic that might not fit into a single line', clock: 4000 },
      { title: 'Conclusion', clock: 8000 },
    ],
  },
  {
    id: '8cd503ae-108a-49e0-b33f-af1320f66a68',
    title: 'cThruLisp',
    description: 'An interesting take on lisp',
    author: {
      name: 'sean_shir',
      avatar: 'avatar2.png',
    },
    published: false,
    uri: 'file:///home/sean/codecast/recordings/session.codecast' as t.Uri,
    defaultRoot: '/home/sean/workspace/dumdb' as t.AbsPath,
    duration: 4023,
    views: 0,
    likes: 0,
    timestamp: '2023-08-08T14:22:35.344Z',
  },
  {
    id: '4167cb21-e47d-478c-a741-0e3f6c69079e',
    title: 'DumDB part 1',
    description: 'A small DB easy to use',
    author: {
      name: 'sean_shir',
      avatar: 'https://cdn-icons-png.flaticon.com/512/924/924915.png',
    },
    published: true,
    uri: 'file:///home/sean/codecast/recordings/session.codecast' as t.Uri,
    defaultRoot: '/home/sean/workspace/dumdb' as t.AbsPath,
    duration: 62,
    views: 123,
    likes: 11,
    timestamp: '2023-06-06T14:22:35.344Z',
  },
  {
    id: 'fa97abc4-d71d-4ff3-aebf-e5aadf77b3f7',
    title: 'Some other project',
    description:
      'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.',
    author: {
      name: 'jane',
      avatar: 'avatar2.png',
    },
    published: true,
    uri: 'file:///home/sean/codecast/recordings/session.codecast' as t.Uri,
    defaultRoot: '/home/sean/workspace/dumdb' as t.AbsPath,
    duration: 662,
    views: 100,
    likes: 45,
    timestamp: '2023-08-06T10:22:35.344Z',
  },
];

type PlayerSetup = {
  sessionSummary: t.SessionSummary;
};

class Codecast {
  screen: t.Screen = t.Screen.Welcome;
  recorder?: Recorder;
  player?: Player;
  playerSetup?: PlayerSetup;
  webview: WebviewProvider;
  sessionSummaries = {
    recent: [SESSIONS[0], SESSIONS[1], SESSIONS[2]],
    workspace: [SESSIONS[0], SESSIONS[1]],
    featured: [SESSIONS[2], SESSIONS[3]],
  };

  constructor(public context: vscode.ExtensionContext) {
    context.subscriptions.push(vscode.commands.registerCommand('codecast.openView', this.openView.bind(this)));

    this.webview = new WebviewProvider(context.extensionUri, this.messageHandler.bind(this));

    context.subscriptions.push(
      vscode.window.registerWebviewViewProvider(WebviewProvider.viewType, this.webview, {
        webviewOptions: { retainContextWhenHidden: true },
      }),
    );
  }

  async messageHandler(req: t.FrontendRequest): Promise<t.BackendResponse> {
    console.log('extension received: ', req);

    switch (req.type) {
      case 'openWelcome': {
        await this.closeCurrentScreen();
        return this.respondWithStore();
      }
      case 'openPlayer': {
        if (await this.closeCurrentScreen()) {
          const sessionSummary =
            _.find(this.sessionSummaries.recent, ['id', req.sessionId]) ||
            _.find(this.sessionSummaries.workspace, ['id', req.sessionId]) ||
            _.find(this.sessionSummaries.featured, ['id', req.sessionId]);
          assert(sessionSummary);

          this.playerSetup = { sessionSummary };
          this.screen = t.Screen.Player;
        }
        return this.respondWithStore();
      }
      case 'openRecorder': {
        if (await this.closeCurrentScreen()) {
          this.screen = t.Screen.Recorder;
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
        if (!this.player) {
          assert(this.playerSetup?.sessionSummary);
          assert(req.root);
          this.player = await Player.populate(
            this.context,
            this.playerSetup.sessionSummary,
            path.abs(nodePath.resolve(req.root)),
          );
        }
        await this.player.start();
        return this.respondWithStore();
      }
      case 'record': {
        if (!this.recorder) {
          for (const vscTextDocument of vscode.workspace.textDocuments) {
            if (vscTextDocument.isDirty) {
              vscode.window.showInformationMessage(
                'There are unsaved files in the current workspace. Please save them first and then try again.',
              );
              return { type: 'error' };
            }
          }
          assert(req.root);
          this.recorder = await Recorder.fromDirAndVsc(this.context, path.abs(nodePath.resolve(req.root)));
        }
        await this.recorder.start();
        return this.respondWithStore();
      }
      case 'seek': {
        await this.player?.update(req.clock);
        return this.respondWithStore();
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
        // if (this.player?.status !== t.PlayerStatus.Playing) {
        //   console.error('got playbackUpdate but player is not playing');
        //   return { type: 'error' };
        // }
        this.player?.update(req.clock);
        return this.respondWithStore();
      }
      case 'getStore': {
        return this.respondWithStore();
      }
      case 'showOpenDialog': {
        const options = {
          canSelectFiles: req.options.canSelectFiles,
          canSelectFolders: req.options.canSelectFolders,
          canSelectMany: req.options.canSelectMany,
          defaultUri: req.options.defaultUri ? vscode.Uri.parse(req.options.defaultUri) : undefined,
          filters: req.options.filters,
          title: req.options.title,
        };
        const uris = await vscode.window.showOpenDialog(options);
        return { type: 'uris', uris: uris?.map(x => x.toString()) };
      }
      default: {
        lib.unreachable(req);
      }
    }
  }

  async closeCurrentScreen(): Promise<boolean> {
    if (this.screen === t.Screen.Recorder) {
      return await this.closeRecorder();
    } else if (this.screen === t.Screen.Player) {
      return await this.closePlayer();
    }
    return true;
  }

  async closeRecorder(): Promise<boolean> {
    if (!this.recorder) return true;
    if (this.recorder.status === t.RecorderStatus.Recording) {
      const saveTitle = 'Save and exit';
      const answer = await vscode.window.showWarningMessage(
        'Recording is in progress. Do you wish to stop the session?',
        { modal: true, detail: 'The session will be saved if you stop recording.' },
        { title: saveTitle },
        { title: 'Cancel', isCloseAffordance: true },
      );
      if (answer?.title !== saveTitle) return false;
    }
    await this.recorder.stop();
    this.recorder = undefined;
    this.screen = t.Screen.Welcome;
    return true;
  }

  async closePlayer(): Promise<boolean> {
    if (!this.player) return true;
    await this.player.stop();
    this.player = undefined;
    this.screen = t.Screen.Welcome;
    return true;
  }

  // async showOpenSessionDialog(): Promise<t.Uri | undefined> {
  //   const uris = await vscode.window.showOpenDialog({
  //     canSelectFiles: true,
  //     canSelectMany: false,
  //     filters: { CodeCast: ['codecast'] },
  //   });
  //   return uris?.[0] && misc.uriFromVsc(uris?.[0]);
  // }

  openView() {
    this.webview.show();
  }

  deactivate() {
    // TODO
  }

  respondWithStore(): t.BackendResponse {
    return { type: 'getStore', store: this.getStore() };
  }

  getStore(): t.Store {
    let recorder: t.Recorder | undefined;
    if (this.screen === t.Screen.Recorder && this.recorder) {
      recorder = {
        status: this.recorder.status,
        duration: this.recorder.getClock(),
        name: 'Name (TODO)',
        root: this.recorder.getRoot(),
        defaultRoot: Workspace.getDefaultRoot(),
      };
    } else if (this.screen === t.Screen.Recorder && !this.recorder) {
      recorder = {
        status: t.RecorderStatus.Uninitialized,
        duration: 0,
        name: 'Name (TODO)',
        defaultRoot: Workspace.getDefaultRoot(),
      };
    }

    let player: t.Player | undefined;
    if (this.screen === t.Screen.Player && this.player) {
      player = {
        sessionSummary: this.player.workspace.session!.summary,
        status: this.player.status,
        clock: this.player.getClock(),
      };
    } else if (this.screen === t.Screen.Player && !this.player && this.playerSetup) {
      player = {
        sessionSummary: this.playerSetup.sessionSummary,
        status: t.PlayerStatus.Uninitialized,
        clock: 0,
      };
    }

    return {
      screen: this.screen,
      welcome: {
        ...this.sessionSummaries,
      },
      recorder,
      player,
    };
  }
}

export default Codecast;
