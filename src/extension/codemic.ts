import * as misc from './misc.js';
import config from './config.js';
import Recorder from './recorder.js';
import Player from './player.js';
import WebviewProvider from './webview_provider.js';
import Session from './session/session.js';
import * as storage from './storage.js';
import * as serverApi from './server_api.js';
import type { Context, RecorderRestoreState, WorkspaceChangeGlobalState } from './types.js';
import { osPaths } from './paths.js';
import * as vscode from 'vscode';
import _ from 'lodash';
import assert from 'assert';
import * as t from '../lib/types.js';
import * as lib from '../lib/lib.js';
import * as path from '../lib/path.js';
import EventContainer from '../lib/event_container.js';

class CodeMic {
  screen: t.Screen = t.Screen.Welcome;
  account?: t.AccountState;
  recorder?: Recorder;
  player?: Player;

  session?: Session;
  featured?: t.SessionHead[];
  webviewProvider: WebviewProvider;
  // cachedSessionCoverPhotos: string[] = [];
  test: any = 0;

  constructor(public context: Context) {
    context.extension.subscriptions.push(vscode.commands.registerCommand('codemic.openView', this.openView.bind(this)));
    context.extension.subscriptions.push(
      vscode.commands.registerCommand('codemic.openWelcome', this.openWelcomeCommand.bind(this)),
    );
    context.extension.subscriptions.push(
      vscode.commands.registerCommand('codemic.account', this.openAccountCommand.bind(this)),
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
    // @ts-ignore
    globalThis.EventContainer = EventContainer;

    await this.restoreStateAfterRestart();
    await this.updateFrontend();

    await this.updateFeaturedAndUpdateFrontend();
    // await this.updateFrontend();

    // this.cachedSessionCoverPhotos = await storage.readCachedSessionCoverPhotos(
    //   this.context.userDataPath.cachedSessionCoverPhotos,
    // );

    // DEV
    if (config.debug && this.webviewProvider.bus) {
      try {
        const sessionId = '39033c97-ed93-4c22-9bee-afcc0de01d65';
        if (await Session.fromExisting(this.context, sessionId)) {
          // Recorder
          await this.messageHandler({ type: 'recorder/open', sessionId });
          await this.messageHandler({ type: 'recorder/openTab', tabId: 'editor-view' });
          await this.updateFrontend();

          // Player
          // await this.messageHandler({ type: 'player/open', sessionId });
          // await this.updateFrontend();
        }
      } catch (error) {
        console.error('ERROR trying to open debug session:', error);
      }
    }
  }

  static async fromExtensionContext(extension: vscode.ExtensionContext): Promise<CodeMic> {
    const user = extension.globalState.get<t.User>('user');
    const userDataPath = path.abs(osPaths.data, user?.username ?? lib.ANONYM_USERNAME);
    const settings = await storage.readJSON<t.Settings>(
      path.abs(userDataPath, 'settings.json'),
      CodeMic.makeDefaultSettings,
    );
    const context: Context = { extension, user, userDataPath, settings };
    return new CodeMic(context);
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
      sessionId: this.session?.head.id,
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
    try {
      const workspaceChange = this.getWorkspaceChangeGlobalState();
      if (!workspaceChange) return;
      console.log('restoreStateAfterRestart(): ', workspaceChange);

      const { screen, sessionId, recorder: recorderRestoreState } = workspaceChange;
      this.setScreen(t.Screen.Loading);

      await this.setWorkspaceChangeGlobalState();

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
    } catch (error) {
      console.error(error);
      vscode.window.showErrorMessage(`Error: `, (error as Error).message);
      this.setScreen(t.Screen.Welcome);
    }
  }

  async viewOpened() {
    try {
      this.context.view = this.webviewProvider.view;
      this.context.postAudioMessage = this.postAudioMessage.bind(this);
      this.context.postVideoMessage = this.postVideoMessage.bind(this);
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

        // Don't put the following in the try-catch above because
        // we want the errors to be handled and shown separately.
        if (user) {
          await this.changeUser(user);
        }

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

        // Don't put the following in the try-catch above because
        // we want the errors to be handled and shown separately.
        if (user) {
          await this.changeUser(user);
        }

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
        await this.player.play();
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
            // let clock = setup.sessionHead.duration;
            // if (setup.fork) {
            //   clock = setup.fork.clock;
            //   assert(setup.baseSessionHead);
            //   await db.copySessionDir(setup.baseSessionHead, setup.sessionHead);
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
          const head = Session.makeNewHead(user);
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
            const session = await Session.fromNew(this.context, workspace, head);

            if (await this.closeCurrentScreen()) {
              // We want the files on disk so that we can add the cover photo there too.
              await session.write();

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
        await this.recorder.play();
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
          // let sessionHead: t.SessionHead;
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
      case 'recorder/updateAudio': {
        assert(this.recorder);
        await this.recorder.updateAudio(req.audio);
        return this.respondWithStore();
      }
      case 'recorder/insertVideo': {
        assert(this.recorder);
        await this.recorder.insertVideo(req.uri, req.clock);
        return this.respondWithStore();
      }
      case 'recorder/deleteVideo': {
        assert(this.recorder);
        await this.recorder.deleteVideo(req.id);
        return this.respondWithStore();
      }
      case 'recorder/updateVideo': {
        assert(this.recorder);
        await this.recorder.updateVideo(req.video);
        return this.respondWithStore();
      }
      case 'recorder/setCoverPhoto': {
        assert(this.recorder);
        await this.recorder.setCoverPhoto(req.uri);
        return this.respondWithStore();
      }
      case 'recorder/deleteCoverPhoto': {
        assert(this.recorder);
        await this.recorder.deleteCoverPhoto();
        return this.respondWithStore();
      }
      case 'recorder/changeSpeed': {
        assert(this.recorder);
        await this.recorder.changeSpeed(req.range, req.factor);
        return this.respondWithStore();
      }
      case 'recorder/merge': {
        assert(this.recorder);
        await this.recorder.merge(req.range);
        return this.respondWithStore();
      }
      case 'recorder/insertGap': {
        assert(this.recorder);
        await this.recorder.insertGap(req.clock, req.dur);
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
          await this.player!.play();
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
          await this.player!.play();
        }
        return { type: 'boolean', value: answer?.title === confirmTitle };
      }
      case 'deleteSession': {
        const session = await Session.fromExisting(this.context, req.sessionId);
        if (session) {
          const confirmTitle = 'Delete';
          const answer = await vscode.window.showWarningMessage(
            `Do you want to delete session "${session.head?.title || 'Untitled'}"?`,
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
        assert(this.session?.runtime);
        this.session.runtime.handleFrontendAudioEvent(req.event);
        return this.respondWithStore();
      }
      case 'video': {
        assert(this.session?.runtime);
        this.session.runtime.handleFrontendVideoEvent(req.event);
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
    vscode.commands.executeCommand('setContext', 'codemic.canOpenWelcome', screen !== t.Screen.Welcome);
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
    // //   // const sessionStorage = this.context.storage.createSessionStorage(this.setup.sessionHead.id);
    // //   await this.session.write();
    // //   // await sessionStorage.writeSessionHead(this.setup.sessionHead);
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

  async updateFeatured() {
    try {
      const res = await serverApi.send({ type: 'featured/get' }, this.context.user?.token);
      this.featured = res.sessionHeads;
    } catch (error) {
      console.error(error);
      vscode.window.showErrorMessage('Failed to fetch featured items:', (error as Error).message);
    }
  }

  async updateFeaturedAndUpdateFrontend() {
    await this.updateFeatured();
    await this.updateFrontend();
  }

  // async showOpenSessionDialog(): Promise<t.Uri | undefined> {
  //   const uris = await vscode.window.showOpenDialog({
  //     canSelectFiles: true,
  //     canSelectMany: false,
  //     filters: { CodeMic: ['codemic'] },
  //   });
  //   return uris?.[0] && misc.uriFromVsc(uris?.[0]);
  // }

  openView() {
    this.context.view?.show();
  }

  async deactivate() {
    this.closeCurrentScreen();
    // if (this.session) {
    // await this.session.write();
    // }
    // await this.db.write();
  }

  async changeUser(user?: t.User) {
    // TODO ask user to convert anonymous sessions to the new user.

    const userDataPath = path.abs(osPaths.data, user?.username ?? lib.ANONYM_USERNAME);
    const settings = await storage.readJSON<t.Settings>(
      path.abs(userDataPath, 'settings.json'),
      CodeMic.makeDefaultSettings,
    );
    // const cachedSessionCoverPhotos = await storage.readCachedSessionCoverPhotos(userDataPath.cachedSessionCoverPhotos);

    this.session = undefined;
    // this.cachedSessionCoverPhotos = cachedSessionCoverPhotos;
    this.context.user = user;
    this.context.userDataPath = userDataPath;
    this.context.settings = settings;
    this.context.extension.globalState.update('user', user);

    // Don't await.
    this.updateFeaturedAndUpdateFrontend().catch(console.error);

    await this.openWelcome();
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

  async postVideoMessage(req: t.BackendVideoRequest): Promise<t.FrontendVideoResponse> {
    return this.webviewProvider.postMessage(req);
  }

  // getCachedSessionCoverPhotoWebviewUri(id: string): t.Uri {
  //   return this.context
  //     .view!.webview.asWebviewUri(vscode.Uri.file(this.context.userDataPath.cachedSessionCoverPhoto(id)))
  //     .toString();
  // }

  // getCachedSessionCoverPhotosWebviewUris(): t.WebviewUris {
  //   const pairs = this.featured?.map(s => [s.id, this.getCachedSessionCoverPhotoWebviewUri(s.id)]);
  //   return Object.fromEntries(pairs ?? []);
  // }

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
        sessionHead: this.session.head,
        clock: this.session.clock ?? 0,
        workspace: this.session.workspace,
        history: this.context.settings.history[this.session.head.id],
        workspaceFocusTimeline: this.session.runtime?.internalWorkspace.focusTimeline,
        audioTracks: this.session.runtime?.audioTrackPlayers.map(c => c.audioTrack),
        videoTracks: this.session.runtime?.videoTracks,
        blobsWebviewUris: this.session.getBlobsWebviewUris(),
        coverPhotoWebviewUri: this.session.getCoverPhotoWebviewUri(),
      };
    }

    let player: t.PlayerState | undefined;
    if (this.screen === t.Screen.Player) {
      assert(this.player);
      assert(this.session);
      player = {
        loaded: this.session.loaded,
        playing: this.session.playing,
        sessionHead: this.session.head,
        clock: this.session.clock ?? 0,
        workspace: this.session.workspace,
        history: this.context.settings.history[this.session.head.id],
        workspaceFocusTimeline: this.session.runtime?.internalWorkspace.focusTimeline,
        audioTracks: this.session.runtime?.audioTrackPlayers.map(c => c.audioTrack),
        videoTracks: this.session.runtime?.videoTracks,
        blobsWebviewUris: this.session.getBlobsWebviewUris(),
        coverPhotoWebviewUri: this.session.getCoverPhotoWebviewUri(),
        comments: COMMENTS[this.session.head.id],
      };
    }

    let welcome: t.WelcomeState | undefined;
    if (this.screen === t.Screen.Welcome) {
      const readHead = async (id: string) => {
        try {
          return await Session.headFromExisting(this.context, id);
        } catch (error) {
          console.error(error);
        }
      };
      const ids = Object.keys(this.context.settings.history);
      const workspace = _.compact(await Promise.all(ids.map(readHead)));

      const workspaceWebviewUriPairs = workspace.map(s => [s.id, Session.getCoverPhotoWebviewUri(this.context, s.id)]);
      const featuredWebviewUriPairs =
        this.featured?.map(s => [s.id, serverApi.getSessionCoverPhotoURLString(s.id)]) ?? [];

      const coverPhotosWebviewUris: t.WebviewUris = Object.fromEntries(
        _.concat(workspaceWebviewUriPairs, featuredWebviewUriPairs),
      );

      welcome = {
        workspace,
        featured: this.featured || [],
        history: this.context.settings.history,
        coverPhotosWebviewUris,
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

      // The followig values must not change.
      debug: config.debug,
      server: config.server,
    };
  }
}

const SCREEN_TITLES = {
  [t.Screen.Account]: 'account',
  [t.Screen.Welcome]: 'projects',
  [t.Screen.Player]: 'player',
  [t.Screen.Recorder]: 'studio',
  [t.Screen.Loading]: 'loading',
};

const COMMENTS: Record<string, t.Comment[]> = {
  '1d87d99d-e0d4-4631-8a0b-b531e47d2a8a': [
    {
      id: 'c1',
      author: 'jason_walker',
      text: 'This brings back so many memories! Love seeing how the old code works.',
      likes: 15,
      dislikes: 0,
      creation_timestamp: '2024-07-02T14:35:00Z',
    },
    {
      id: 'c2',
      author: 'marcusstone',
      text: 'Wow, the AI logic was ahead of its time. Great breakdown!',
      likes: 22,
      dislikes: 1,
      creation_timestamp: '2024-07-04T09:12:00Z',
    },
    {
      id: 'c3',
      author: 'alexturner',
      text: "Never thought I'd be tweaking DOOM's code in 2024. Thanks for this!",
      likes: 18,
      dislikes: 0,
      creation_timestamp: '2024-06-28T18:47:00Z',
    },
    {
      id: 'c4',
      author: 'ashley_taylor',
      text: 'The way you explain the architecture makes it so easy to follow. Awesome content!',
      likes: 25,
      dislikes: 0,
      creation_timestamp: '2024-07-10T11:30:00Z',
    },
    {
      id: 'c5',
      author: 'emily_james',
      text: "I've always wondered how the AI worked in DOOM. Super insightful!",
      likes: 30,
      dislikes: 2,
      creation_timestamp: '2024-08-01T16:20:00Z',
    },
    {
      id: 'c6',
      author: 'matthughes',
      text: "Your enthusiasm for the game is infectious. Can't wait to try these tweaks myself!",
      likes: 12,
      dislikes: 0,
      creation_timestamp: '2024-07-15T14:45:00Z',
    },
    {
      id: 'c7',
      author: 'ethanross',
      text: 'I didn’t realize how complex the enemy logic was. This is gold!',
      likes: 20,
      dislikes: 1,
      creation_timestamp: '2024-06-30T10:15:00Z',
    },
    {
      id: 'c8',
      author: 'samuelgreen',
      text: 'Perfect mix of nostalgia and learning. Keep these deep dives coming!',
      likes: 28,
      dislikes: 0,
      creation_timestamp: '2024-07-18T12:50:00Z',
    },
    {
      id: 'c9',
      author: 'andrew_clark',
      text: 'Watching this made me want to fire up DOOM again. Great video!',
      likes: 16,
      dislikes: 0,
      creation_timestamp: '2024-08-05T17:10:00Z',
    },
    {
      id: 'c10',
      author: 'chrismiller',
      text: 'Can’t believe how well you explained such a complex system. Subscribed for more!',
      likes: 35,
      dislikes: 0,
      creation_timestamp: '2024-07-22T14:22:00Z',
    },
  ],

  '6f9e08ff-be59-41ee-a082-803f22f67711': [
    {
      id: 'c11',
      author: 'chrismiller',
      text: 'I had no idea Minetest had such a solid rendering engine. Awesome breakdown!',
      likes: 19,
      dislikes: 0,
      creation_timestamp: '2024-08-10T10:12:00Z',
    },
    {
      id: 'c12',
      author: 'andrew_clark',
      text: 'This is exactly what I was looking for! Great explanation of the OpenGL renderer.',
      likes: 24,
      dislikes: 1,
      creation_timestamp: '2024-07-28T16:35:00Z',
    },
    {
      id: 'c13',
      author: 'emily_james',
      text: 'The design choices here are fascinating. Minetest is truly underrated!',
      likes: 22,
      dislikes: 0,
      creation_timestamp: '2024-07-05T11:27:00Z',
    },
    {
      id: 'c14',
      author: 'alexturner',
      text: 'Love seeing the OpenGL details. Can you do a deeper dive into the shaders next?',
      likes: 18,
      dislikes: 0,
      creation_timestamp: '2024-08-02T14:47:00Z',
    },
    {
      id: 'c15',
      author: 'marcusstone',
      text: 'Minetest deserves more attention, especially with such a capable renderer!',
      likes: 26,
      dislikes: 0,
      creation_timestamp: '2024-06-30T13:59:00Z',
    },
    {
      id: 'c16',
      author: 'jason_walker',
      text: 'This video helped me appreciate the rendering process so much more. Thanks!',
      likes: 20,
      dislikes: 1,
      creation_timestamp: '2024-07-15T09:45:00Z',
    },
    {
      id: 'c17',
      author: 'ethanross',
      text: 'Breaking down OpenGL in Minetest is no small feat. Thanks for making it accessible!',
      likes: 17,
      dislikes: 0,
      creation_timestamp: '2024-08-07T15:30:00Z',
    },
    {
      id: 'c18',
      author: 'marcusstone',
      text: 'I’ve been playing Minetest for years, but never knew how the rendering worked. Awesome!',
      likes: 23,
      dislikes: 0,
      creation_timestamp: '2024-07-22T12:10:00Z',
    },
    {
      id: 'c19',
      author: 'emily_james',
      text: 'Amazing content! Can’t wait to see more videos on rendering engines.',
      likes: 28,
      dislikes: 0,
      creation_timestamp: '2024-08-15T18:55:00Z',
    },
    {
      id: 'c20',
      author: 'matthughes',
      text: 'Great breakdown of the OpenGL renderer! Learned a lot from this.',
      likes: 32,
      dislikes: 0,
      creation_timestamp: '2024-07-19T14:00:00Z',
    },
  ],
};

export default CodeMic;
