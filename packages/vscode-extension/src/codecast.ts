import Recorder from './recorder.js';
import Player from './player.js';
import WebviewProvider from './webview_provider.js';
import Session from './session/session.js';
import * as storage from './storage.js';
import * as serverApi from './server_api.js';
import type { Context, WorkspaceChangeGlobalState } from './types.js';
import * as paths from './paths.js';
import * as vscode from 'vscode';
import _ from 'lodash';
import assert from 'assert';
import { types as t, lib } from '@codecast/lib';
import { SessionSummary } from '@codecast/lib/src/types.js';

class Codecast {
  screen: t.Screen = t.Screen.Welcome;
  account?: t.AccountState;
  recorder?: Recorder;
  player?: Player;

  session?: Session;
  featured?: SessionSummary[];
  webviewProvider: WebviewProvider;
  test: any = 0;

  constructor(public context: Context) {
    context.extension.subscriptions.push(
      vscode.commands.registerCommand('codecast.openView', this.openView.bind(this)),
    );
    context.extension.subscriptions.push(
      vscode.commands.registerCommand('codecast.openWelcome', this.openWelcomeCommand.bind(this)),
    );
    context.extension.subscriptions.push(
      vscode.commands.registerCommand('codecast.account', this.openAccountCommand.bind(this)),
    );

    this.webviewProvider = new WebviewProvider(
      context.extension,
      this.messageHandler.bind(this),
      this.viewOpened.bind(this),
    );

    context.extension.subscriptions.push(
      vscode.window.registerWebviewViewProvider(WebviewProvider.viewType, this.webviewProvider, {
        webviewOptions: { retainContextWhenHidden: true },
      }),
    );

    this.restoreStateAfterRestart().catch(console.error);

    // DEV
    // if (this.webviewProvider.bus) {
    //   this.messageHandler({ type: 'recorder/open', sessionId: 'ecc7e7e8-1f38-4a3a-91b1-774f1c91ba21' })
    //     .then(this.updateFrontend)
    //     .catch(console.error);
    // }
  }

  static async fromExtensionContext(extension: vscode.ExtensionContext): Promise<Codecast> {
    const user = extension.globalState.get<t.User>('user');
    const dataPaths = paths.dataPaths(user?.username);
    const settings = await storage.readJSON<t.Settings>(dataPaths.settings, Codecast.makeDefaultSettings);
    const { defaultWorkspacePaths } = paths;
    const context: Context = { extension, user, dataPaths, defaultWorkspacePaths, settings };
    return new Codecast(context);
  }

  static makeDefaultSettings(): t.Settings {
    return { history: {} };
  }

  static setWorkspaceChangeGlobalState(context: vscode.ExtensionContext, state?: WorkspaceChangeGlobalState) {
    context.globalState.update('workspaceChange', state);
  }
  static getWorkspaceChangeGlobalState(context: vscode.ExtensionContext): WorkspaceChangeGlobalState | undefined {
    return context.globalState.get<WorkspaceChangeGlobalState>('workspaceChange');
  }

  async restoreStateAfterRestart() {
    throw new Error('TODO');
    // const workspaceChange = Codecast.getWorkspaceChangeGlobalState(this.context.extension);
    // Codecast.setWorkspaceChangeGlobalState(this.context.extension, undefined);

    // console.log('restoreStateAfterRestart(): ', workspaceChange?.setup);
    // if (workspaceChange) {
    //   const { screen, featured } = workspaceChange;
    //   assert(screen === t.Screen.Player || screen === t.Screen.Recorder);

    //   this.featured = featured;
    //   if (screen === t.Screen.Player) {
    //     this.player = await this.loadPlayer({ afterRestart: true });
    //   } else {
    //     this.recorder = await this.scanOrLoadRecorder({ afterRestart: true });
    //   }
    //   this.setScreen(screen);
    // } else {
    //   await this.fetchFeatured();
    // }

    // if (this.context.view) {
    //   await this.updateFrontend();
    // }
  }

  async viewOpened() {
    try {
      this.context.view = this.webviewProvider.view;
      this.context.postAudioMessage = this.postAudioMessage.bind(this);
      this.context.updateFrontend = this.updateFrontend.bind(this);
      this.updateViewTitle();
    } catch (error) {
      console.error(error);
    }
  }

  async messageHandler(req: t.FrontendRequest): Promise<t.BackendResponse> {
    // console.log('extension received: ', req);

    switch (req.type) {
      case 'account/open': {
        await this.openAccount(req);
        return this.respondWithStore();
      }
      case 'account/update': {
        assert(this.account);
        this.account = { ...this.account, ...req.changes };
        return this.respondWithStore();
      }
      case 'account/join': {
        assert(this.account);

        try {
          const res = await serverApi.send({ type: 'account/join', credentials: this.account.credentials });
          await this.userChanged(res.user);
          this.account.error = undefined;
          await this.openWelcome();
        } catch (error) {
          console.error(error);
          this.account.error = (error as Error).message;
        }

        return this.respondWithStore();
      }
      case 'account/login': {
        assert(this.account);
        this.account.join = false;

        try {
          const res = await serverApi.send({ type: 'account/login', credentials: this.account.credentials });
          await this.userChanged(res.user);
          this.account.error = undefined;
          await this.openWelcome();
        } catch (error) {
          console.error(error);
          this.account.error = (error as Error).message;
        }

        return this.respondWithStore();
      }
      case 'account/logout': {
        await this.userChanged();
        await this.openWelcome();
        return this.respondWithStore();
      }
      case 'welcome/open': {
        await this.openWelcome();
        return this.respondWithStore();
      }
      case 'player/open': {
        if (await this.closeCurrentScreen()) {
          this.session = await Session.fromExisting(this.context, req.sessionId);
          this.player = new Player(this.session);
          this.setScreen(t.Screen.Player);
        }
        return this.respondWithStore();
      }
      case 'player/load': {
        assert(this.player);
        await this.loadPlayer();
        return this.respondWithStore();
      }
      case 'player/play': {
        assert(this.player);
        this.player.play();
        return this.respondWithStore();
      }
      case 'player/pause': {
        assert(this.player);
        this.player.pause();
        return this.respondWithStore();
      }
      case 'player/seek': {
        assert(this.player);
        this.player.seek(req.clock);
        return this.respondWithStore();
      }
      // case 'player/update': {
      //   throw new Error('DELETE THIS');
      //   // assert(this.player);
      //   // this.player.updateState(req.changes);
      //   // return this.respondWithStore();
      // }
      case 'recorder/open': {
        let session: Session;

        const user = this.context.user && lib.userToUserSummary(this.context.user);

        if (req.sessionId) {
          if (req.fork) {
            // Fork existing session.
            throw new Error('TODO');
            // use Session.makeForkSummary()
            //
            // let clock = setup.sessionSummary.duration;
            // if (setup.fork) {
            //   clock = setup.fork.clock;
            //   assert(setup.baseSessionSummary);
            //   await db.copySessionDir(setup.baseSessionSummary, setup.sessionSummary);
            // }
          } else {
            // Edit existing session.
            throw new Error('TODO');
            // use Session.makeEditSummary()
          }
        } else {
          // Create new session.
          const summary = Session.makeNewSummary(user);
          session = await Session.fromNew(this.context, summary);
        }

        if (await this.closeCurrentScreen()) {
          this.session = session;
          this.recorder = new Recorder(session);
          this.setScreen(t.Screen.Recorder);
        }

        return this.respondWithStore();
      }
      case 'recorder/load': {
        assert(this.recorder);
        // for (const vscTextDocument of vscode.workspace.textDocuments) {
        //   if (vscTextDocument.dirty) {
        //     vscode.window.showErrorMessage(
        //       'There are unsaved files in the current workspace. Please save them first and then try again.',
        //     );
        //     return { type: 'error' };
        //   }
        // }
        await this.scanOrLoadRecorder();
        return this.respondWithStore();
      }
      case 'recorder/record': {
        assert(this.recorder);
        this.recorder.record();
        return this.respondWithStore();
      }
      case 'recorder/play': {
        assert(this.recorder);
        this.recorder.play();
        return this.respondWithStore();
      }
      case 'recorder/pause': {
        assert(this.recorder);
        this.recorder.pause();
        return this.respondWithStore();
      }
      case 'recorder/seek': {
        assert(this.recorder);
        this.recorder.seek(req.clock);
        return this.respondWithStore();
      }
      case 'recorder/save': {
        await this.saveRecorder({ forExit: false, ask: false, verbose: true });
        return this.respondWithStore();
      }
      case 'recorder/publish': {
        try {
          assert(this.session);
          // let sessionSummary: t.SessionSummary;
          if (await this.saveRecorder({ forExit: false, ask: true, verbose: false })) {
            await this.session.publish();
            vscode.window.showInformationMessage('Published session.');
          }
        } catch (error) {
          vscode.window.showErrorMessage((error as Error).message);
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
      case 'recorder/update': {
        assert(this.recorder);
        this.recorder.updateState(req.changes);
        return this.respondWithStore();
      }
      case 'recorder/insertAudio': {
        assert(this.recorder);
        await this.recorder.insertAudio(req.uri, req.clock);
        return this.respondWithStore();
      }
      case 'recorder/deleteAudio': {
        assert(this.recorder);
        await this.recorder.deleteAudio(req.id);
        return this.respondWithStore();
      }
      case 'confirmForkFromPlayer': {
        const wasRunning = this.session?.playing;
        if (!wasRunning) return { type: 'boolean', value: true };
        this.player!.pause();

        const confirmTitle = 'Fork';
        const answer = await vscode.window.showWarningMessage(
          `Do you want to stop playing and fork the current session at ${lib.formatTimeSeconds(req.clock)}?`,
          { modal: true },
          { title: 'Cancel', isCloseAffordance: true },
          { title: confirmTitle },
        );
        if (answer?.title != confirmTitle && wasRunning) {
          this.player!.play();
        }
        return { type: 'boolean', value: answer?.title === confirmTitle };
      }
      case 'confirmEditFromPlayer': {
        const wasRunning = this.session?.playing;
        if (!wasRunning) return { type: 'boolean', value: true };
        this.player!.pause();

        const confirmTitle = 'Edit';
        const answer = await vscode.window.showWarningMessage(
          `Do you want to stop playing and edit the current session at ${lib.formatTimeSeconds(req.clock)}?`,
          { modal: true },
          { title: 'Cancel', isCloseAffordance: true },
          { title: confirmTitle },
        );
        if (answer?.title != confirmTitle && wasRunning) {
          this.player!.play();
        }
        return { type: 'boolean', value: answer?.title === confirmTitle };
      }
      case 'deleteSession': {
        const session = await Session.fromExisting(this.context, req.sessionId);
        const confirmTitle = 'Delete';
        const answer = await vscode.window.showWarningMessage(
          `Do you want to delete session "${session.summary?.title || 'Untitled'}"?`,
          { modal: true },
          { title: 'Cancel', isCloseAffordance: true },
          { title: confirmTitle },
        );
        if (answer?.title === confirmTitle) {
          await session.delete();
        }
        return this.respondWithStore();
      }
      case 'audio': {
        assert(this.session?.ctrls);
        this.session.ctrls.sessionTracksCtrl.handleFrontendAudioEvent(req.event);
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
    // console.log('updateViewTitle: webviewProvider.view ' + (this.webviewProvider.view ? 'is set' : 'is NOT set'));
    if (this.context.view) {
      const username = this.context.user?.username;
      const title = username
        ? ` ${username} / ` + SCREEN_TITLES[this.screen]
        : SCREEN_TITLES[this.screen] + ` (not logged in) `;
      this.webviewProvider.view!.title = title;
    }
  }

  setScreen(screen: t.Screen) {
    this.screen = screen;
    this.updateViewTitle();
    vscode.commands.executeCommand('setContext', 'codecast.canOpenWelcome', screen !== t.Screen.Welcome);
  }

  async openWelcome() {
    if (this.screen !== t.Screen.Welcome) {
      await this.closeCurrentScreen();
    }
  }

  async openWelcomeCommand() {
    await this.openWelcome();
    await this.updateFrontend();
  }

  async openAccount(options?: { join?: boolean }) {
    if (await this.closeCurrentScreen()) {
      this.account = {
        credentials: {
          email: '',
          username: '',
          password: '',
        },
        join: options?.join ?? false,
      };
      this.setScreen(t.Screen.Account);
    }
  }

  async openAccountCommand() {
    await this.openAccount();
    await this.updateFrontend();
  }

  async scanOrLoadRecorder(options?: { afterRestart: boolean }) {
    assert(this.session);
    assert(this.recorder);
    // TODO set up vscode workspace
    // const state = this.createWorkspaceChangeGlobalState();
    // if (!(await Session.setUpWorkspace(this.context, state, options))) return;

    if (this.session.onDisk) {
      await this.recorder.load();
    } else {
      await this.recorder.scan();
    }
  }

  async loadPlayer(options?: { afterRestart: boolean }) {
    assert(this.player);

    // TODO possibly change vscode workspace
    await this.player.load();

    // const state = this.createWorkspaceChangeGlobalState();
    // if (!(await Session.setUpWorkspace(this.context, state, options))) return;

    // return Player.loadSession(
    //   this.context,
    //   this.setup,
    //   this.postAudioMessage.bind(this),
    //   this.playerChanged.bind(this),
    // );
  }

  async closeCurrentScreen(): Promise<boolean> {
    let canClose = true;
    if (this.screen === t.Screen.Account) {
      canClose = await this.accountWillClose();
    } else if (this.screen === t.Screen.Recorder) {
      canClose = await this.recorderWillClose();
    } else if (this.screen === t.Screen.Player) {
      canClose = await this.playerWillClose();
    }

    if (canClose) {
      this.setScreen(t.Screen.Welcome);
    }
    return canClose;
  }

  async accountWillClose(): Promise<boolean> {
    this.account = undefined;
    return true;
  }

  async recorderWillClose(): Promise<boolean> {
    if (await this.saveRecorder({ forExit: true, ask: true, verbose: false })) {
      this.recorder = undefined;
      return true;
    }

    return false;
  }

  /**
   * Returns true if successfull and false if cancelled.
   * In verbose mode, it'll show a message even when there are no changes to save.
   */
  async saveRecorder(options: { forExit: boolean; ask: boolean; verbose: boolean }): Promise<boolean> {
    assert(this.recorder);

    // TODO user confirmation
    await this.recorder.save();
    return true;

    // let cancelled = false;
    // let shouldSave = false;
    // let dirty: boolean;
    // assert(this.recorder);
    // const wasPlaying = this.recorder.playing;
    // const wasRecording = this.recorder.recording;
    // // Pause the frontend while we figure out if we should save the session.
    // if (wasPlaying || wasRecording) {
    //   this.recorder.pause();
    //   this.updateFrontend();
    // }
    // dirty = this.recorder.dirty;
    // if (dirty) {
    //   if (options.ask) {
    //     [shouldSave, cancelled] = await this.askToSaveSession(options);
    //   } else {
    //     shouldSave = true;
    //   }
    // }
    // // If we want to exit recorder, stop recording and intercepting editor events.
    // // Otherwise, resume recording if we were initially recording.
    // if (!cancelled) {
    //   this.recorder.pause();
    // } else if (wasRecording) {
    //   this.recorder.record();
    //   await this.updateFrontend();
    // } else if (wasPlaying) {
    //   this.recorder.play();
    //   await this.updateFrontend();
    // }
    // // Save
    // if (shouldSave) {
    //   await this.recorder.save();
    // }
    // // assert(this.setup);
    // // dirty = Boolean(this.setup.dirty);
    // // if (dirty) {
    // //   if (options.ask) {
    // //     [shouldSave, cancelled] = await this.askToSaveSession(options);
    // //   } else {
    // //     shouldSave = true;
    // //   }
    // // }
    // // if (shouldSave) {
    // //   // const sessionStorage = this.context.storage.createSessionStorage(this.setup.sessionSummary.id);
    // //   await this.session.write();
    // //   // await sessionStorage.writeSessionSummary(this.setup.sessionSummary);
    // //   this.setup.dirty = false;
    // // }
    // if (!dirty && options.verbose) {
    //   vscode.window.showInformationMessage('Nothing to save.');
    // } else if (shouldSave) {
    //   vscode.window.showInformationMessage('Saved session.');
    // }
    // return !cancelled;
  }

  /**
   * Returns [shouldSave, cancelled] booleans.
   */
  async askToSaveSession(options: { forExit: boolean }): Promise<[boolean, boolean]> {
    const saveTitle = 'Save';
    const dontSaveTitle = "Don't Save";
    const cancelTitle = 'Cancel';
    let answer: vscode.MessageItem | undefined;
    if (options.forExit) {
      answer = await vscode.window.showWarningMessage(
        'Do you want to save this session?',
        { modal: true, detail: "Your changes will be lost if you don't save them." },
        { title: saveTitle },
        { title: cancelTitle, isCloseAffordance: true },
        { title: dontSaveTitle },
      );
    } else {
      answer = await vscode.window.showWarningMessage(
        'Do you want to save this session?',
        { modal: true },
        { title: saveTitle },
        { title: cancelTitle, isCloseAffordance: true },
      );
    }
    const shouldSave = answer?.title === saveTitle;
    const cancelled = answer?.title === cancelTitle;
    return [shouldSave, cancelled];
  }

  async playerWillClose(): Promise<boolean> {
    if (this.player) {
      this.player.pause();
    }

    this.player = undefined;
    return true;
  }

  async fetchFeatured() {
    const res = await serverApi.send({ type: 'featured/get' }, this.context.user?.token);
    this.featured = res.sessionSummaries;
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
    this.context.view?.show();
  }

  async deactivate() {
    // await this.db.write();
  }

  async userChanged(user?: t.User) {
    assert(!this.session, 'TODO change of user while session is open');
    this.context.user = user;
    this.context.dataPaths = paths.dataPaths(user?.username);
    this.context.settings = await storage.readJSON<t.Settings>(
      this.context.dataPaths.settings,
      Codecast.makeDefaultSettings,
    );
    this.context.extension.globalState.update('user', user);
  }

  async respondWithStore(): Promise<t.BackendResponse> {
    return { type: 'store', store: await this.getStore() };
  }

  async updateFrontend() {
    await this.webviewProvider.postMessage({ type: 'updateStore', store: await this.getStore() });
  }

  getFirstSessionHistoryById(...ids: (string | undefined)[]): t.SessionHistory | undefined {
    return _.compact(ids)
      .map(id => this.context.settings.history[id])
      .find(Boolean);
  }

  async postAudioMessage(req: t.BackendAudioRequest): Promise<t.FrontendAudioResponse> {
    return this.webviewProvider.postMessage(req);
  }

  createWorkspaceChangeGlobalState(): WorkspaceChangeGlobalState {
    return {
      screen: this.screen,
      featured: this.featured,
    };
  }

  async getStore(): Promise<t.Store> {
    let recorder: t.RecorderState | undefined;
    if (this.screen === t.Screen.Recorder) {
      assert(this.recorder);
      assert(this.session);
      recorder = {
        onDisk: this.session.onDisk,
        loaded: this.session.loaded,
        recording: this.session.recording,
        playing: this.session.playing,
        sessionSummary: this.session.summary,
        clock: this.session.clock ?? 0,
        workspace: this.session.workspace,
        history: this.context.settings.history[this.session.summary.id],
        audioTracks: this.session.body?.audioTracks,
        webviewUris: this.session.getWebviewUris(),
      };
    }

    let player: t.PlayerState | undefined;
    if (this.screen === t.Screen.Player) {
      assert(this.player);
      assert(this.session);
      player = {
        loaded: this.session.loaded,
        playing: this.session.playing,
        sessionSummary: this.session.summary,
        clock: this.session.clock ?? 0,
        workspace: this.session.workspace,
        history: this.context.settings.history[this.session.summary.id],
        audioTracks: this.session.body?.audioTracks,
        webviewUris: this.session.getWebviewUris(),
      };
    }

    let welcome: t.WelcomeState | undefined;
    if (this.screen === t.Screen.Welcome) {
      const ids = Object.keys(this.context.settings.history);
      welcome = {
        workspace: await Promise.all(
          // TODO fix this weird thing. Read session summary directly.
          ids.map(id => Session.fromExisting(this.context, id).then(session => session.summary)),
        ),
        featured: this.featured || [],
        history: this.context.settings.history,
      };
    }

    return {
      screen: this.screen,
      user: this.context.user,
      account: this.account,
      welcome,
      recorder,
      player,
      test: this.test,
    };
  }
}

const SCREEN_TITLES = {
  [t.Screen.Account]: 'account',
  [t.Screen.Welcome]: 'projects',
  [t.Screen.Player]: 'player',
  [t.Screen.Recorder]: 'studio',
};

// // TODO delete this and fetch from internet
// const FEATURED_SESSIONS: t.SessionSummaryMap = _.keyBy(
//   [
//     {
//       id: 'fd4659dd-150a-408b-aac3-1bc815a83be9',
//       title: 'DumDB part 2',
//       description: 'A small DB easy to use',
//       author: {
//         username: 'sean_shirazi',
//         avatar: 'avatar1.png',
//         email: 'example@site.com',
//         joinTimestamp: '2020-01-01T14:22:35.344Z',
//       },
//       published: false,
//       defaultRoot: '/home/sean/workspace/dumdb' as t.AbsPath,
//       duration: 78,
//       views: 0,
//       likes: 0,
//       modificationTimestamp: '2023-07-08T14:22:35.344Z',
//       toc: [
//         { title: 'Intro', clock: 0 },
//         { title: 'Setting things up', clock: 3 },
//         { title: 'First function', clock: 8 },
//         { title: 'Second function', clock: 16 },
//         { title: 'Another thing here', clock: 100 },
//         { title: 'More stuff', clock: 200 },
//         { title: "Here's another topic", clock: 300 },
//         { title: 'And here is a very long topic that might not fit into a single line', clock: 4000 },
//         { title: 'Conclusion', clock: 8000 },
//       ],
//     },
//     {
//       id: '8cd503ae-108a-49e0-b33f-af1320f66a68',
//       title: 'cThruLisp',
//       description: 'An interesting take on lisp',
//       author: {
//         username: 'sean_shirazi',
//         avatar: 'avatar2.png',
//         email: 'example@site.com',
//         joinTimestamp: '2020-01-01T14:22:35.344Z',
//       },
//       published: false,
//       defaultRoot: '/home/sean/workspace/dumdb' as t.AbsPath,
//       duration: 4023,
//       views: 0,
//       likes: 0,
//       modificationTimestamp: '2023-08-08T14:22:35.344Z',
//       toc: [],
//     },
//     {
//       id: '4167cb21-e47d-478c-a741-0e3f6c69079e',
//       title: 'DumDB part 1',
//       description: 'A small DB easy to use',
//       author: {
//         username: 'sean_shirazi',
//         avatar: 'https://cdn-icons-png.flaticon.com/512/924/924915.png',
//         email: 'example@site.com',
//         joinTimestamp: '2020-01-01T14:22:35.344Z',
//       },
//       published: true,
//       defaultRoot: '/home/sean/workspace/dumdb' as t.AbsPath,
//       duration: 62,
//       views: 123,
//       likes: 11,
//       publishTimestamp: '2023-02-06T14:22:35.344Z',
//       modificationTimestamp: '2023-06-06T14:22:35.344Z',
//       toc: [],
//     },
//     {
//       id: 'fa97abc4-d71d-4ff3-aebf-e5aadf77b3f7',
//       title: 'Some other project',
//       description:
//         'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.',
//       author: {
//         username: 'jane',
//         avatar: 'avatar2.png',
//         email: 'example@site.com',
//         joinTimestamp: '2020-01-01T14:22:35.344Z',
//       },
//       published: true,
//       defaultRoot: '/home/sean/workspace/dumdb' as t.AbsPath,
//       duration: 662,
//       views: 100,
//       likes: 45,
//       publishTimestamp: '2023-06-06T10:22:35.344Z',
//       modificationTimestamp: '2023-08-06T10:22:35.344Z',
//       toc: [],
//     },
//   ],
//   'id',
// );

export default Codecast;
