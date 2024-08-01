import * as misc from './misc.js';
import Recorder from './recorder.js';
import Player from './player.js';
import WebviewProvider from './webview_provider.js';
import Session from './session/session.js';
import * as storage from './storage.js';
import * as serverApi from './server_api.js';
import type { Context, RecorderRestoreState, WorkspaceChangeGlobalState } from './types.js';
import * as paths from './paths.js';
import * as vscode from 'vscode';
import _ from 'lodash';
import assert from 'assert';
import { types as t, lib, path } from '@codecast/lib';
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

    this.onStartUp().catch(console.error);
  }

  async onStartUp() {
    await this.restoreStateAfterRestart();
    await this.updateFrontend();

    await this.fetchFeatured();
    await this.updateFrontend();

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

  async setWorkspaceChangeGlobalState(state?: WorkspaceChangeGlobalState) {
    await this.context.extension.globalState.update('workspaceChange', state);
  }
  getWorkspaceChangeGlobalState(): WorkspaceChangeGlobalState | undefined {
    return this.context.extension.globalState.get<WorkspaceChangeGlobalState>('workspaceChange');
  }

  async setUpWorkspace(restoreState?: { recorder?: RecorderRestoreState }) {
    assert(this.session);

    // Is workspace already up-to-date?
    if (misc.getDefaultVscWorkspace() === this.session.workspace) return;

    // Save recorder first so that we can restore it after vscode restart.
    if (this.recorder) {
      await this.recorder.save();
    }

    // Set global state to get ready for possible restart.
    await this.setWorkspaceChangeGlobalState({
      screen: this.screen,
      sessionId: this.session?.summary.id,
      recorder: restoreState?.recorder,
    });

    // Change vscode's workspace folders.
    {
      const disposables: vscode.Disposable[] = [];
      const done = new Promise(resolve => {
        vscode.workspace.onDidChangeWorkspaceFolders(() => resolve(undefined), undefined, disposables);
      });
      const success = vscode.workspace.updateWorkspaceFolders(0, vscode.workspace.workspaceFolders?.length ?? 0, {
        uri: vscode.Uri.file(this.session.workspace),
      });
      assert(success);
      await done;
      for (const d of disposables) d.dispose();
    }

    // Clear global state.
    await this.setWorkspaceChangeGlobalState();

    // Make sure workspace is updated properly.
    assert(misc.getDefaultVscWorkspace() === this.session.workspace);
  }

  async restoreStateAfterRestart() {
    const workspaceChange = this.getWorkspaceChangeGlobalState();
    await this.setWorkspaceChangeGlobalState();

    console.log('restoreStateAfterRestart(): ', workspaceChange);
    if (workspaceChange) {
      const { screen, sessionId, recorder: recorderRestoreState } = workspaceChange;

      if (sessionId) {
        const session = await Session.fromExisting(this.context, sessionId);
        assert(session);
        assert(misc.getDefaultVscWorkspace() === session.workspace);

        this.session = session;
        if (screen === t.Screen.Player) {
          this.player = new Player(this.session);
          await this.player.load();
        } else if (screen === t.Screen.Recorder) {
          this.recorder = new Recorder(this.session, Boolean(recorderRestoreState?.mustScan));
          await this.recorder.load(recorderRestoreState);
          if (recorderRestoreState?.tabId) this.recorder.tabId = recorderRestoreState.tabId;
        }
      }
      this.setScreen(screen);
    }
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

        let user: t.User | undefined;
        try {
          user = (await serverApi.send({ type: 'account/join', credentials: this.account.credentials })).user;
        } catch (error) {
          console.error(error);
          this.account.error = (error as Error).message;
        }
        if (user) await this.changeUser(user);
        return this.respondWithStore();
      }
      case 'account/login': {
        assert(this.account);
        this.account.join = false;

        let user: t.User | undefined;
        try {
          user = (await serverApi.send({ type: 'account/login', credentials: this.account.credentials })).user;
        } catch (error) {
          console.error(error);
          if (this.account) this.account.error = (error as Error).message;
        }
        if (user) await this.changeUser(user);
        return this.respondWithStore();
      }
      case 'account/logout': {
        await this.changeUser();
        return this.respondWithStore();
      }
      case 'welcome/open': {
        await this.openWelcome();
        return this.respondWithStore();
      }
      case 'player/open': {
        if (await this.closeCurrentScreen()) {
          this.session = await Session.fromExisting(this.context, req.sessionId);
          if (!this.session) {
            vscode.window.showErrorMessage(`Session files don't exist.`);
          } else {
            this.player = new Player(this.session);
            this.setScreen(t.Screen.Player);
          }
        }
        return this.respondWithStore();
      }
      case 'player/load': {
        assert(this.player);
        await this.setUpWorkspace();
        await this.player.load();
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
        const user = this.context.user && lib.userToUserSummary(this.context.user);

        if (req.sessionId) {
          let session: Session | undefined;
          let seekClock: number | undefined;
          let cutClock: number | undefined;

          // TODO check if this.session already contains req.sessionId
          if (req.fork) {
            // Fork existing session.
            session = await Session.fromFork(this.context, req.sessionId, { author: user });
            if (req.clock !== undefined && req.clock > 0) {
              seekClock = req.clock;
              cutClock = req.clock;
            }
            //
            // let clock = setup.sessionSummary.duration;
            // if (setup.fork) {
            //   clock = setup.fork.clock;
            //   assert(setup.baseSessionSummary);
            //   await db.copySessionDir(setup.baseSessionSummary, setup.sessionSummary);
            // }
          } else {
            // Edit existing session.
            session = await Session.fromExisting(this.context, req.sessionId);
            if (req.clock !== undefined && req.clock > 0) {
              seekClock = req.clock;
            }
          }

          if (session) {
            // await session.readBody({ download: true });

            if (await this.closeCurrentScreen()) {
              this.session = session;
              this.recorder = new Recorder(this.session, false);
              this.setScreen(t.Screen.Recorder);

              // This might trigger a vscode restart in which case this.restoreStateAfterRestart() will be
              // called and it will recreate the session, recorder, call recorder.load(), and set the screen.
              await this.setUpWorkspace({ recorder: { mustScan: false, seekClock, cutClock } });

              // Must be called after this.setUpWorkspace()
              await this.recorder.load({ seekClock, cutClock });
            }
          }
        } else {
          // Create new session.

          // For new sessions, user will manually call recorder/load which will call setUpWorkspace().
          const summary = Session.makeNewSummary(user);
          let workspace = misc.getDefaultVscWorkspace();
          if (!workspace) {
            const options = {
              canSelectFiles: false,
              canSelectFolders: true,
              canSelectMany: false,
              title: 'Select a directory to start recording.',
            };
            const uris = await vscode.window.showOpenDialog(options);
            if (uris?.length === 1) workspace = path.abs(uris[0].path);
          }

          if (workspace) {
            const session = await Session.fromNew(this.context, workspace, summary);

            if (await this.closeCurrentScreen()) {
              this.session = session;
              this.recorder = new Recorder(session, true);
              this.setScreen(t.Screen.Recorder);
            }
          }
        }

        return this.respondWithStore();
      }
      case 'recorder/openTab': {
        assert(this.session);
        assert(this.recorder);
        if (req.tabId === 'editor-view' && !this.session.loaded) {
          // This might trigger a vscode restart in which case this.restoreStateAfterRestart() will be
          // called and it will recreate the session, recorder, call recorder.load(), and set the screen.
          await this.setUpWorkspace({ recorder: { mustScan: this.recorder.mustScan, tabId: 'editor-view' } });
          await this.recorder.load();
        }
        this.recorder.tabId = req.tabId;
        return this.respondWithStore();
      }
      case 'recorder/load': {
        assert(this.session);
        assert(this.recorder);

        // This might trigger a vscode restart in which case this.restoreStateAfterRestart() will be
        // called and it will recreate the session, recorder, call recorder.load(), and set the screen.
        await this.setUpWorkspace({ recorder: { mustScan: this.recorder.mustScan, tabId: 'editor-view' } });

        await this.recorder.load();
        this.recorder.tabId = 'editor-view';
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
        await this.saveRecorder();
        return this.respondWithStore();
      }
      case 'recorder/publish': {
        try {
          assert(this.session);
          // let sessionSummary: t.SessionSummary;
          if (await this.saveRecorder()) {
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
        if (session) {
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

  // async scanOrLoadRecorder(options?: { afterRestart: boolean }) {
  //   assert(this.session);
  //   assert(this.recorder);

  // }

  // async loadPlayer(options?: { afterRestart: boolean }) {
  //   assert(this.player);

  // }

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
    if (await this.saveRecorder()) {
      this.recorder = undefined;
      return true;
    }

    return false;
  }

  /**
   * Returns true if successfull and false if cancelled.
   * In verbose mode, it'll show a message even when there are no changes to save.
   */
  async saveRecorder(): Promise<boolean> {
    assert(this.recorder);

    if (this.session?.running) {
      this.recorder.pause();
    }
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
    if (this.player && this.session?.running) {
      this.player.pause();
    }

    this.player = undefined;
    return true;
  }

  async fetchFeatured() {
    try {
      const res = await serverApi.send({ type: 'featured/get' }, this.context.user?.token);
      this.featured = res.sessionSummaries;
    } catch (error) {
      vscode.window.showErrorMessage('Failed to fetch featured items:', (error as Error).message);
    }
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
    if (this.session) {
      await this.session.write();
    }
    // await this.db.write();
  }

  async changeUser(user?: t.User) {
    // TODO ask user to convert anonymous sessions to the new user.

    const dataPaths = paths.dataPaths(user?.username);
    const settings = await storage.readJSON<t.Settings>(this.context.dataPaths.settings, Codecast.makeDefaultSettings);

    this.session = undefined;
    this.context.user = user;
    this.context.dataPaths = dataPaths;
    this.context.settings = settings;
    this.context.extension.globalState.update('user', user);
  }

  async respondWithStore(): Promise<t.BackendResponse> {
    return { type: 'store', store: await this.getStore() };
  }

  async updateFrontend() {
    if (this.context.view) {
      await this.webviewProvider.postMessage({ type: 'updateStore', store: await this.getStore() });
    }
  }

  getFirstSessionHistoryById(...ids: (string | undefined)[]): t.SessionHistory | undefined {
    return _.compact(ids)
      .map(id => this.context.settings.history[id])
      .find(Boolean);
  }

  async postAudioMessage(req: t.BackendAudioRequest): Promise<t.FrontendAudioResponse> {
    return this.webviewProvider.postMessage(req);
  }

  async getStore(): Promise<t.Store> {
    let recorder: t.RecorderState | undefined;
    if (this.screen === t.Screen.Recorder) {
      assert(this.recorder);
      assert(this.session);
      recorder = {
        tabId: this.recorder.tabId,
        mustScan: this.recorder.mustScan,
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
      const readSummary = async (id: string) => {
        try {
          return await Session.summaryFromExisting(this.context, id);
        } catch (error) {
          console.error(error);
        }
      };
      const ids = Object.keys(this.context.settings.history);
      const workspace = _.compact(await Promise.all(ids.map(readSummary)));
      welcome = {
        workspace,
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
