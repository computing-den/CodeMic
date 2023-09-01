import fs from 'fs';
import * as misc from './misc.js';
import Recorder from './recorder.js';
import Player from './player.js';
import Workspace from './workspace.js';
import WebviewProvider from './webview_provider.js';
import Db from './db.js';
import * as vscode from 'vscode';
import _ from 'lodash';
import assert from 'assert';
import { types as t, lib, path } from '@codecast/lib';
import nodePath from 'path';

type PlayerSetup = {
  sessionSummary: t.SessionSummary;
};

class Codecast {
  screen: t.Screen = t.Screen.Welcome;
  recorder?: Recorder;
  player?: Player;
  playerSetup?: PlayerSetup;
  webview: WebviewProvider;

  constructor(public context: vscode.ExtensionContext, public db: Db) {
    context.subscriptions.push(vscode.commands.registerCommand('codecast.openView', this.openView.bind(this)));

    this.webview = new WebviewProvider(context.extensionUri, this.messageHandler.bind(this));

    context.subscriptions.push(
      vscode.window.registerWebviewViewProvider(WebviewProvider.viewType, this.webview, {
        webviewOptions: { retainContextWhenHidden: true },
      }),
    );
  }

  static async fromContext(context: vscode.ExtensionContext): Promise<Codecast> {
    return new Codecast(context, await Db.init());
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
          const sessionSummary = this.db.sessionSummaries[req.sessionId];
          assert(sessionSummary);
          this.db.mergeSessionHistory({ id: sessionSummary.id, lastOpenedTimestamp: new Date().toISOString() });
          await this.db.write();
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
          assert(req.root);
          assert(this.playerSetup?.sessionSummary);
          try {
            await fs.promises.access(req.root);
          } catch (error: any) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
            const createPathTitle = 'Create path';
            const answer = await vscode.window.showWarningMessage(
              `${req.root} does not exist. Do you want to create it?`,
              { modal: true },
              { title: createPathTitle },
              { title: 'Cancel', isCloseAffordance: true },
            );
            if (answer?.title !== createPathTitle) throw new Error('Canceled');
            await fs.promises.mkdir(req.root, { recursive: true });
          }

          this.player = await Player.populate(
            this.context,
            this.db,
            this.playerSetup.sessionSummary,
            path.abs(nodePath.resolve(req.root)),
          );
        }
        await this.player.start();
        const session = this.player.workspace.session!;
        const timestamp = new Date().toISOString();
        this.db.mergeSessionHistory({
          id: session.summary.id,
          lastOpenedTimestamp: timestamp,
          lastWatchedTimestamp: timestamp,
          root: this.player.workspace.root,
        });
        await this.db.write();
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
          assert(req.sessionSummaryUIPart);
          this.recorder = await Recorder.fromDirAndVsc(
            this.context,
            this.db,
            path.abs(nodePath.resolve(req.root)),
            req.sessionSummaryUIPart,
          );
        }
        await this.recorder.start();
        return this.respondWithStore();
      }
      case 'seek': {
        assert(this.player);
        await this.player.update(req.clock);

        this.db.mergeSessionHistory({
          id: this.player.workspace.session!.summary.id,
          lastWatchedClock: this.player.getClock(),
        });
        await this.db.writeDelayed();

        return this.respondWithStore();
      }
      case 'pausePlayer': {
        assert(this.player);
        this.player.pause();
        this.db.mergeSessionHistory({
          id: this.player.workspace.session!.summary.id,
          lastWatchedClock: this.player.getClock(),
        });
        await this.db.writeDelayed();
        return this.respondWithStore();
      }
      case 'pauseRecorder': {
        assert(this.recorder);
        this.recorder.pause();
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
        assert(this.player);
        this.player.update(req.clock);
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
      case 'updateRecorderSessionSummaryUIPart': {
        // if there's no recorder, just ignore it, we'll receive sessionSummaryUIPart when recording starts
        if (this.recorder) {
          Object.assign(this.recorder.workspace.session!, req.sessionSummaryUIPart);
        }
        return { type: 'ok' };
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
    if (this.recorder) {
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
      if (this.recorder.canSave()) {
        const session = this.recorder.workspace.session!;
        await this.db.writeSession(session.toJSON(), session.summary);
        this.db.mergeSessionHistory({
          id: session.summary.id,
          lastOpenedTimestamp: new Date().toISOString(),
          recordedTimestamp: new Date().toISOString(),
          root: session.root,
        });
        await this.db.write();
      }
      this.recorder = undefined;
    }

    this.screen = t.Screen.Welcome;
    return true;
  }

  async closePlayer(): Promise<boolean> {
    if (this.player) {
      await this.player.stop();
      this.player = undefined;
    }

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

  async deactivate() {
    await this.db.write();
  }

  respondWithStore(): t.BackendResponse {
    return { type: 'getStore', store: this.getStore() };
  }

  getStore(): t.Store {
    let recorder: t.RecorderState | undefined;
    if (this.screen === t.Screen.Recorder && this.recorder) {
      recorder = {
        status: this.recorder.status,
        sessionSummaryUIPart: this.recorder.workspace.session!.summary,
        root: this.recorder.getRoot(),
        defaultRoot: Workspace.getDefaultRoot(),
      };
    } else if (this.screen === t.Screen.Recorder && !this.recorder) {
      recorder = {
        status: t.RecorderStatus.Uninitialized,
        sessionSummaryUIPart: Recorder.makeSessionSummaryUIPart(),
        defaultRoot: Workspace.getDefaultRoot(),
      };
    }

    let player: t.PlayerState | undefined;
    if (this.screen === t.Screen.Player && this.player) {
      player = {
        sessionSummary: this.player.workspace.session!.summary,
        history: this.db.settings.history[this.player.workspace.session!.summary.id],
        status: this.player.status,
        clock: this.player.getClock(),
      };
    } else if (this.screen === t.Screen.Player && !this.player && this.playerSetup) {
      player = {
        sessionSummary: this.playerSetup.sessionSummary,
        history: this.db.settings.history[this.playerSetup.sessionSummary.id],
        status: t.PlayerStatus.Uninitialized,
        clock: 0,
      };
    }

    return {
      screen: this.screen,
      welcome: {
        workspace: this.db.sessionSummaries,
        featured: FEATURED_SESSIONS,
        history: this.db.settings.history,
      },
      recorder,
      player,
    };
  }
}

// TODO delete this and fetch from internet
const FEATURED_SESSIONS: t.SessionSummaryMap = _.keyBy(
  [
    {
      id: 'fd4659dd-150a-408b-aac3-1bc815a83be9',
      title: 'DumDB part 2',
      description: 'A small DB easy to use',
      author: {
        name: 'sean_shir',
        avatar: 'avatar1.png',
      },
      published: false,
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
      defaultRoot: '/home/sean/workspace/dumdb' as t.AbsPath,
      duration: 4023,
      views: 0,
      likes: 0,
      timestamp: '2023-08-08T14:22:35.344Z',
      toc: [],
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
      defaultRoot: '/home/sean/workspace/dumdb' as t.AbsPath,
      duration: 62,
      views: 123,
      likes: 11,
      timestamp: '2023-06-06T14:22:35.344Z',
      toc: [],
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
      defaultRoot: '/home/sean/workspace/dumdb' as t.AbsPath,
      duration: 662,
      views: 100,
      likes: 45,
      timestamp: '2023-08-06T10:22:35.344Z',
      toc: [],
    },
  ],
  'id',
);

export default Codecast;
