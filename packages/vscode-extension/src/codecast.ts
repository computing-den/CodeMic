import Recorder from './recorder.js';
import Player from './player.js';
import Workspace from './workspace.js';
import WebviewProvider from './webview_provider.js';
import Db from './db.js';
import * as vscode from 'vscode';
import _ from 'lodash';
import assert from 'assert';
import { types as t, lib, path } from '@codecast/lib';

class Codecast {
  screen: t.Screen = t.Screen.Welcome;
  recorder?: Recorder;
  recorderSetup?: t.RecorderSetup;
  player?: Player;
  playerSetup?: t.PlayerSetup;
  webview: WebviewProvider;
  test: any = 0;

  constructor(public context: vscode.ExtensionContext, public db: Db) {
    context.subscriptions.push(vscode.commands.registerCommand('codecast.openView', this.openView.bind(this)));
    context.subscriptions.push(vscode.commands.registerCommand('codecast.home', this.goHomeCommand.bind(this)));

    this.webview = new WebviewProvider(context, this.messageHandler.bind(this), this.viewOpened.bind(this));

    context.subscriptions.push(
      vscode.window.registerWebviewViewProvider(WebviewProvider.viewType, this.webview, {
        webviewOptions: { retainContextWhenHidden: true },
      }),
    );

    // DEV
    this.messageHandler({ type: 'openRecorder', sessionId: 'ecc7e7e8-1f38-4a3a-91b1-774f1c91ba21' })
      .then(() => {
        this.webview.postMessage({ type: 'updateStore', store: this.getStore() });
      })
      .catch(console.error);
  }

  static async fromContext(context: vscode.ExtensionContext): Promise<Codecast> {
    return new Codecast(context, await Db.init());
  }

  viewOpened() {
    this.updateViewTitle();
  }

  async messageHandler(req: t.FrontendRequest): Promise<t.BackendResponse> {
    // console.log('extension received: ', req);

    switch (req.type) {
      case 'openWelcome': {
        this.goHome();
        return this.respondWithStore();
      }
      case 'openPlayer': {
        if (await this.closeCurrentScreen()) {
          const sessionSummary = this.db.sessionSummaries[req.sessionId];
          assert(sessionSummary);
          this.playerSetup = {
            sessionSummary,
            root: this.db.settings.history[sessionSummary.id]?.root,
            // set history in getStore() so that it's always up-to-date
          };
          this.screen = t.Screen.Player;
          this.updateViewTitle();
          vscode.commands.executeCommand('setContext', 'codecast.canGoHome', true);
        }
        return this.respondWithStore();
      }
      case 'openRecorder': {
        if (await this.closeCurrentScreen()) {
          const baseSessionSummary = req.sessionId ? this.db.sessionSummaries[req.sessionId] : undefined;
          const sessionSummary = Recorder.makeSessionSummary(baseSessionSummary, req.fork, req.forkClock);
          const history = this.getFirstHistoryItemById(sessionSummary.id, baseSessionSummary?.id);
          this.recorderSetup = {
            sessionSummary,
            baseSessionSummary,
            fork: req.fork,
            forkClock: req.forkClock,
            root: history?.root || Workspace.getDefaultRoot(),
            // set history in getStore() so that it's always up-to-date
          };
          this.screen = t.Screen.Recorder;
          this.updateViewTitle();
          vscode.commands.executeCommand('setContext', 'codecast.canGoHome', true);
        }

        return this.respondWithStore();
      }
      case 'play': {
        if (!this.player) {
          assert(this.playerSetup);

          // May return undefined if user decides not to overwrite root
          this.player = await Player.populate(
            this.context,
            this.db,
            this.playerSetup,
            this.webview.postMessage.bind(this.webview),
            this.webview.asWebviewUri(vscode.Uri.file('/home/sean/.local/share/codecast/sample.mp3'))?.toString()!,
          );
        }

        if (this.player) {
          await this.player.start();
        }
        return this.respondWithStore();
      }
      case 'record': {
        if (!this.recorder) {
          for (const vscTextDocument of vscode.workspace.textDocuments) {
            if (vscTextDocument.isDirty) {
              vscode.window.showErrorMessage(
                'There are unsaved files in the current workspace. Please save them first and then try again.',
              );
              return { type: 'error' };
            }
          }
          assert(this.recorderSetup);
          if (this.recorderSetup.baseSessionSummary) {
            this.recorder = await Recorder.populateSession(this.context, this.db, this.recorderSetup);
          } else {
            this.recorder = await Recorder.fromDirAndVsc(this.context, this.db, this.recorderSetup);
          }
        }

        if (this.recorder) {
          await this.recorder.start();
        }
        return this.respondWithStore();
      }
      case 'pausePlayer': {
        assert(this.player);
        await this.player.pause();
        return this.respondWithStore();
      }
      case 'pauseRecorder': {
        assert(this.recorder);
        await this.recorder.pause();
        return this.respondWithStore();
      }
      case 'seekPlayer': {
        assert(this.player);
        await this.player.seek(req.clock);
        return this.respondWithStore();
      }
      case 'saveRecorder': {
        if (this.recorder?.isDirty()) {
          await this.recorder.save();
          vscode.window.showInformationMessage('Saved session.');
        } else {
          vscode.window.showInformationMessage('Nothing to save.');
        }

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
      case 'updateRecorder': {
        if (this.recorder) {
          this.recorder.updateState(req.changes);
        } else {
          if (req.changes.title !== undefined) this.recorderSetup!.sessionSummary.title = req.changes.title;
          if (req.changes.description !== undefined)
            this.recorderSetup!.sessionSummary.description = req.changes.description;
          if (req.changes.root !== undefined) this.recorderSetup!.root = req.changes.root;
        }
        return this.respondWithStore();
      }
      case 'updatePlayer': {
        if (this.player) {
          await this.player.updateState(req.changes);
        } else {
          if (req.changes.root !== undefined) this.playerSetup!.root = req.changes.root;
          // if (req.changes.clock !== undefined) throw new Error('TODO seek before player instantiation');
        }
        return this.respondWithStore();
      }
      case 'confirmForkFromPlayer': {
        const status = this.player?.status;
        if (status !== t.PlayerStatus.Playing) return { type: 'boolean', value: true };
        await this.player!.pause();

        const confirmTitle = 'Fork';
        const answer = await vscode.window.showWarningMessage(
          `Do you want to stop playing and fork the current session at ${lib.formatTimeSeconds(req.clock)}?`,
          { modal: true },
          { title: 'Cancel', isCloseAffordance: true },
          { title: confirmTitle },
        );
        if (answer?.title != confirmTitle && status === t.PlayerStatus.Playing) {
          await this.player!.start();
        }
        return { type: 'boolean', value: answer?.title === confirmTitle };
      }
      case 'confirmEditFromPlayer': {
        const status = this.player?.status;
        if (status !== t.PlayerStatus.Playing) return { type: 'boolean', value: true };
        await this.player!.pause();

        const confirmTitle = 'Edit';
        const answer = await vscode.window.showWarningMessage(
          `Do you want to stop playing and edit the current session?`,
          { modal: true },
          { title: 'Cancel', isCloseAffordance: true },
          { title: confirmTitle },
        );
        if (answer?.title != confirmTitle && status === t.PlayerStatus.Playing) {
          await this.player!.start();
        }
        return { type: 'boolean', value: answer?.title === confirmTitle };
      }
      case 'deleteSession': {
        const sessionSummary = this.db.sessionSummaries[req.sessionId];
        const confirmTitle = 'Delete';
        const answer = await vscode.window.showWarningMessage(
          `Do you want to delete session "${sessionSummary?.title || 'Untitled'}"?`,
          { modal: true },
          { title: 'Cancel', isCloseAffordance: true },
          { title: confirmTitle },
        );
        if (answer?.title === confirmTitle) {
          await this.db.deleteSession(req.sessionId);
        }
        return this.respondWithStore();
      }
      case 'frontendMediaEvent': {
        assert(this.player);

        await this.player.handleFrontendMediaEvent(req.event);
        return this.respondWithStore();
      }
      case 'test': {
        this.test = req.value;
        return this.respondWithStore();
      }
      default: {
        lib.unreachable(req);
      }
    }
  }

  updateViewTitle() {
    console.log('updateViewTitle: webview.view ' + (this.webview.view ? 'is set' : 'is NOT set'));
    if (this.webview.view) {
      const title = ' sean_shir / ' + SCREEN_TITLES[this.screen]; // TODO get the logged-in username
      this.webview.view.title = title;
    }
  }

  async goHome() {
    await this.closeCurrentScreen();
    this.updateViewTitle();
    vscode.commands.executeCommand('setContext', 'codecast.canGoHome', false);
  }

  async goHomeCommand() {
    await this.goHome();
    await this.webview.postMessage({ type: 'updateStore', store: this.getStore() });
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
    let shouldExit = true;

    if (this.recorder) {
      const wasRecording = this.recorder.status === t.RecorderStatus.Recording;

      // Pause the frontend while we figure out if we should save the session.
      if (wasRecording) {
        await this.recorder.pause();
        await this.webview.postMessage({ type: 'updateStore', store: this.getStore() });
      }

      let shouldSave = this.recorder.isDirty();
      if (shouldSave) {
        // Ask to save the session.
        const saveTitle = 'Save';
        const dontSaveTitle = "Don't Save";
        const cancelTitle = 'Cancel';
        const answer = await vscode.window.showWarningMessage(
          'Do you want to save this session?',
          { modal: true, detail: "Your changes will be lost if you don't save them." },
          { title: saveTitle },
          { title: cancelTitle, isCloseAffordance: true },
          { title: dontSaveTitle },
        );
        shouldExit = answer?.title !== cancelTitle;
        shouldSave = answer?.title === saveTitle;
      }

      // If we want to exit recorder, stop recording and intercepting editor events.
      // Otherwise, resume recording if we were initially recording.
      if (shouldExit) {
        await this.recorder.stop();
      } else if (wasRecording) {
        this.recorder.start();
        await this.webview.postMessage({ type: 'updateStore', store: this.getStore() });
      }

      // Save
      if (shouldSave) {
        await this.recorder.save();
        vscode.window.showInformationMessage('Saved session.');
      }
    }

    if (shouldExit) {
      this.recorder = undefined;
      this.recorderSetup = undefined;
      this.screen = t.Screen.Welcome;
      return true;
    }

    return false;
  }

  async closePlayer(): Promise<boolean> {
    if (this.player) {
      await this.player.stop();
    }

    this.playerSetup = undefined;
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

  async deactivate() {
    await this.db.write();
  }

  respondWithStore(): t.BackendResponse {
    return { type: 'store', store: this.getStore() };
  }

  getFirstHistoryItemById(...ids: (string | undefined)[]): t.SessionHistoryItem | undefined {
    return _.compact(ids)
      .map(id => this.db.settings.history[id])
      .find(Boolean);
  }

  getStore(): t.Store {
    let recorder: t.RecorderState | undefined;
    if (this.screen === t.Screen.Recorder) {
      if (this.recorder) {
        recorder = {
          status: this.recorder.status,
          sessionSummary: this.recorder.workspace.session!.summary,
          clock: this.recorder.getClock(),
          root: this.recorder.getRoot(),
          history: this.db.settings.history[this.recorder.workspace.session!.summary.id],
        };
      } else if (this.recorderSetup) {
        recorder = {
          status: t.RecorderStatus.Uninitialized,
          sessionSummary: this.recorderSetup.sessionSummary,
          clock: this.recorderSetup.forkClock ?? this.recorderSetup.baseSessionSummary?.duration ?? 0,
          root: this.recorderSetup.root,
          fork: this.recorderSetup.fork,
          forkClock: this.recorderSetup.forkClock,
          history: this.getFirstHistoryItemById(
            this.recorderSetup.sessionSummary.id,
            this.recorderSetup.baseSessionSummary?.id,
          ),
        };
      }
    }

    let player: t.PlayerState | undefined;
    if (this.screen === t.Screen.Player) {
      if (this.player) {
        player = {
          status: this.player.status,
          sessionSummary: this.player.workspace.session!.summary,
          clock: this.player.getClock(),
          root: this.player.workspace.root,
          history: this.db.settings.history[this.player.workspace.session!.summary.id],
        };
      } else if (this.playerSetup) {
        player = {
          status: t.PlayerStatus.Uninitialized,
          sessionSummary: this.playerSetup.sessionSummary,
          clock: 0,
          root: this.playerSetup.root,
          history: this.db.settings.history[this.playerSetup.sessionSummary.id],
        };
      }
    }

    let welcome: t.WelcomeState | undefined;
    if (this.screen === t.Screen.Welcome) {
      welcome = {
        workspace: this.db.sessionSummaries,
        featured: FEATURED_SESSIONS,
        history: this.db.settings.history,
      };
    }

    return {
      screen: this.screen,
      welcome,
      recorder,
      player,
      test: this.test,
    };
  }
}

const SCREEN_TITLES = {
  [t.Screen.Welcome]: 'projects',
  [t.Screen.Player]: 'player',
  [t.Screen.Recorder]: 'studio',
};

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
