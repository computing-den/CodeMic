import './config.js'; // Init config
import WebviewProvider from './webview_provider.js';
import config from './config.js';
import Session from './session/session.js';
import * as storage from './storage.js';
import * as serverApi from './server_api.js';
import type { Context, WorkspaceChangeGlobalState } from './types.js';
import osPaths from './os_paths.js';
import * as vscode from 'vscode';
import _ from 'lodash';
import assert from 'assert';
import * as t from '../lib/types.js';
import * as lib from '../lib/lib.js';
import * as paths from '../lib/paths.js';
import VscWorkspace from './session/vsc_workspace.js';
import path from 'path';
import cache from './cache.js';

const SAVE_TIMEOUT_MS = 5_000;

class CodeMic {
  screen: t.Screen = t.Screen.Welcome;
  account?: t.AccountState;
  session?: Session;
  featured?: t.SessionHead[];
  recorder?: { tabId: t.RecorderUITabId };
  webviewProvider: WebviewProvider;

  frontendUpdateBlockCounter = 0;
  isFrontendDirty = true;

  test: any = 0;

  constructor(public context: Context) {
    context.extension.subscriptions.push(vscode.commands.registerCommand('codemic.openView', this.openView.bind(this)));
    context.extension.subscriptions.push(
      vscode.commands.registerCommand('codemic.openWelcome', this.openWelcomeCommand.bind(this)),
    );
    context.extension.subscriptions.push(
      vscode.commands.registerCommand('codemic.account', this.openAccountCommand.bind(this)),
    );

    this.webviewProvider = new WebviewProvider(context, this.handleMessage.bind(this), this.viewOpened.bind(this));

    context.extension.subscriptions.push(
      vscode.window.registerWebviewViewProvider(WebviewProvider.viewType, this.webviewProvider, {
        webviewOptions: { retainContextWhenHidden: true },
      }),
    );

    // context.cache.onChange = this.cacheChanged.bind(this);

    this.onStartUp().catch(console.error);
  }

  async onStartUp() {
    await this.restoreStateAfterRestart();
    await this.updateFrontend();

    this.updateFeaturedAndCache().finally(this.updateFrontend.bind(this));

    // DEV
    if (config.debug && this.webviewProvider.bus) {
      try {
        const sessionId = '2f324d7a-1a2c-478e-ab80-df60f09e45bd';
        if (await Session.Core.fromLocal(this.context, sessionId)) {
          // Recorder
          await this.handleMessage({ type: 'recorder/open', sessionId });
          await this.handleMessage({ type: 'recorder/openTab', tabId: 'editor-view' });
          await this.updateFrontend();

          // Player
          // await this.handleMessage({ type: 'player/open', sessionId });
          // await this.updateFrontend();
        }
      } catch (error) {
        console.error('ERROR trying to open debug session:', error);
      }
    }
  }

  static async fromExtensionContext(extension: vscode.ExtensionContext): Promise<CodeMic> {
    const user = extension.globalState.get<t.User>('user');
    const userDataPath = path.join(osPaths.data, user?.username ?? lib.ANONYM_USERNAME);
    const userSettingsPath = path.join(userDataPath, 'settings.json');
    const settings = await storage.readJSON<t.Settings>(userSettingsPath, CodeMic.makeDefaultSettings);
    const context: Context = { extension, user, userDataPath, userSettingsPath, settings };
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

  /**
   * Set this.session with proper workspace before calling this.
   */
  async setUpWorkspace(restoreState?: { recorder?: { tabId: t.RecorderUITabId; clock?: number } }) {
    assert(this.session);

    // Return if workspace is already up-to-date.
    if (VscWorkspace.getDefaultVscWorkspace() === this.session.workspace) return;

    // Save first so that we can restore it after vscode restart.
    if (this.screen === t.Screen.Recorder) {
      await this.session.core.write();
    }

    // Set global state to get ready for possible restart.
    await this.setWorkspaceChangeGlobalState({
      screen: this.screen,
      sessionId: this.session.head.id,
      sessionHandle: this.session.head.handle,
      workspace: this.session.workspace,
      recorder: restoreState?.recorder && { tabId: restoreState?.recorder.tabId, mustScan: this.session.mustScan },
    });

    // Change vscode's workspace folders.
    // This may cause vscode to restart and the rest of the would not run.
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
    assert(VscWorkspace.getDefaultVscWorkspace() === this.session.workspace);
  }

  async restoreStateAfterRestart() {
    try {
      const workspaceChange = this.getWorkspaceChangeGlobalState();
      if (!workspaceChange) return;

      console.log('restoreStateAfterRestart(): ', workspaceChange);

      const { screen, sessionId, recorder, workspace } = workspaceChange;
      this.setScreen(t.Screen.Loading);

      await this.setWorkspaceChangeGlobalState();

      if (sessionId) {
        const session = await Session.Core.fromLocal(this.context, workspace, {
          mustScan: recorder?.mustScan,
        });
        assert(session);
        assert(VscWorkspace.getDefaultVscWorkspace() === session.workspace);

        this.setSession(session);
        await session.prepare(recorder);
        if (recorder) {
          this.recorder = { tabId: recorder.tabId };
        }
      }
      this.setScreen(screen);
    } catch (error) {
      console.error(error);
      this.showError(error as Error);
      this.setScreen(t.Screen.Welcome);
    }
  }

  async viewOpened() {
    try {
      this.context.view = this.webviewProvider.view;
      this.context.postAudioMessage = this.postAudioMessage.bind(this);
      this.context.postVideoMessage = this.postVideoMessage.bind(this);
      this.context.updateFrontend = this.updateFrontend.bind(this);
      this.context.postMessage = this.webviewProvider.postMessage.bind(this.webviewProvider);
      this.updateViewTitle();
    } catch (error) {
      console.error(error);
    }
  }

  async handleMessage(req: t.FrontendRequest): Promise<t.BackendResponse> {
    try {
      this.frontendUpdateBlockInc();
      return await this.handleMessageInner(req);
    } catch (error) {
      this.showError(error as Error);
      throw error;
    } finally {
      await this.frontendUpdateBlockDec();
    }
  }
  async handleMessageInner(req: t.FrontendRequest): Promise<t.BackendResponse> {
    // console.log('extension received: ', req);
    const ok = { type: 'ok' } as t.OKResponse;

    switch (req.type) {
      case 'account/open': {
        await this.openAccount(req);
        this.enqueueFrontendUpdate();
        return ok;
      }
      case 'account/update': {
        assert(this.account);
        this.account = { ...this.account, ...req.changes };
        this.enqueueFrontendUpdate();
        return ok;
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

        this.enqueueFrontendUpdate();
        return ok;
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

        this.enqueueFrontendUpdate();
        return ok;
      }
      case 'account/logout': {
        await this.changeUser();
        this.enqueueFrontendUpdate();
        return ok;
      }
      case 'welcome/open': {
        await this.openWelcome();
        this.enqueueFrontendUpdate();
        return ok;
      }
      case 'player/open': {
        const history = this.context.settings.history[req.sessionId];
        const featured = this.featured?.find(s => s.id === req.sessionId);
        let session: Session | undefined;

        if (history) {
          session = await Session.Core.fromLocal(this.context, history.workspace);
        } else if (featured) {
          session = await Session.Core.fromRemote(this.context, featured);
        }

        if (session) {
          if (await this.closeCurrentScreen()) {
            this.setSession(session);
            this.setScreen(t.Screen.Player);
          }
        } else {
          this.showError(new Error(`Could not find requested session.`));
        }

        this.enqueueFrontendUpdate();
        return ok;
      }
      case 'player/load': {
        assert(this.session);
        this.session.core.assertFormatVersionSupport();
        await this.setUpWorkspace();
        await this.session.prepare();
        this.enqueueFrontendUpdate();
        return ok;
      }
      case 'player/play': {
        assert(this.session?.isLoaded());
        await this.session.rr.play();
        await this.session?.core.writeHistoryOpenClose();
        this.enqueueFrontendUpdate();
        return ok;
      }
      case 'player/pause': {
        assert(this.session?.isLoaded());
        this.session.rr.pause();
        await this.session?.core.writeHistoryClock();
        this.enqueueFrontendUpdate();
        return ok;
      }
      case 'player/seek': {
        assert(this.session?.isLoaded());
        this.session.rr.seek(req.clock);
        this.enqueueFrontendUpdate();
        return ok;
      }
      // case 'player/update': {
      //   throw new Error('DELETE THIS');
      //   // assert(this.session.isLoaded())
      //   // this.player.updateState(req.changes);
      //   // return ok
      // }
      case 'recorder/open': {
        if (req.sessionId) {
          await this.openRecorderExistingSession(req.sessionId, req.clock, req.fork);
        } else {
          await this.openRecorderNewSession();
        }

        this.enqueueFrontendUpdate();
        return ok;
      }
      case 'recorder/openTab': {
        assert(this.session);
        assert(this.recorder);
        if (req.tabId === 'editor-view' && !this.session.isLoaded()) {
          await this.loadRecorder();
        } else {
          this.recorder.tabId = req.tabId;
        }
        this.enqueueFrontendUpdate();
        return ok;
      }
      case 'recorder/load': {
        await this.loadRecorder();
        this.enqueueFrontendUpdate();
        return ok;
      }
      case 'recorder/record': {
        assert(this.session?.isLoaded());
        await this.session.rr.record();
        this.enqueueFrontendUpdate();
        return ok;
      }
      case 'recorder/play': {
        assert(this.session?.isLoaded());
        await this.session.rr.play();
        this.enqueueFrontendUpdate();
        return ok;
      }
      case 'recorder/pause': {
        assert(this.session?.isLoaded());
        this.session.rr.pause();
        this.enqueueFrontendUpdate();
        return ok;
      }
      case 'recorder/seek': {
        assert(this.session?.isLoaded());
        await this.session.rr.seek(req.clock);
        this.enqueueFrontendUpdate();
        return ok;
      }
      case 'recorder/save': {
        assert(this.session?.isLoaded());
        await this.writeSession({ pause: true });
        this.enqueueFrontendUpdate();
        return ok;
      }
      case 'recorder/publish': {
        try {
          assert(this.session?.isLoaded());
          // let sessionHead: t.SessionHead;
          await this.writeSession({ pause: true });
          await this.session.core.publish();
          vscode.window.showInformationMessage('Published session.');
        } catch (error) {
          this.showError(error as Error);
        }
        this.enqueueFrontendUpdate();
        return ok;
      }
      case 'getStore': {
        return { type: 'store', store: await this.getStore() };
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
      case 'recorder/undo': {
        assert(this.session?.isLoaded());
        await this.session.commander.undo();
        // const cmds = this.session.editor.undo();
        // await this.session.rr.unapplyCmds(cmds);
        // console.log('Undo: ', cmds);
        this.enqueueFrontendUpdate();
        return ok;
      }
      case 'recorder/redo': {
        assert(this.session?.isLoaded());
        await this.session.commander.redo();
        // const cmds = this.session.editor.redo();
        // await this.session.rr.applyCmds(cmds);
        // console.log('Redo: ', cmds);
        this.enqueueFrontendUpdate();
        return ok;
      }
      case 'recorder/updateDetails': {
        assert(this.session);
        this.session.editor.updateFromUI(req.changes);
        this.enqueueFrontendUpdate();
        return ok;
      }
      // case 'recorder/updateDuration': {
      //   assert(this.session);
      //   this.session.editor.updateDuration(req.duration);
      //   // await this.session.rr?.applyCmds([cmd]);
      //   this.enqueueFrontendUpdate();
      //   return ok;
      // }
      case 'recorder/insertAudio': {
        assert(this.session?.isLoaded());
        // await this.session.commander.insertAudioTrack(req.uri, req.clock);
        const cmd = await this.session.editor.createInsertAudioTrack(req.uri, req.clock);
        await this.session.commander.applyInsertAudioTrack(cmd);
        this.enqueueFrontendUpdate();
        return ok;
      }
      case 'recorder/deleteAudio': {
        assert(this.session?.isLoaded());
        // await this.session.commander.deleteAudioTrack(req.id);
        const cmd = this.session.editor.createDeleteAudioTrack(req.id);
        await this.session.commander.applyDeleteAudioTrack(cmd);
        this.enqueueFrontendUpdate();
        return ok;
      }
      case 'recorder/updateAudio': {
        assert(this.session?.isLoaded());
        // await this.session.commander.updateAudioTrack(req.update);
        const cmd = this.session.editor.createUpdateAudioTrack(req.update);
        if (cmd) await this.session.commander.applyUpdateAudioTrack(cmd);
        this.enqueueFrontendUpdate();
        return ok;
      }
      case 'recorder/insertVideo': {
        assert(this.session?.isLoaded());
        // await this.session.commander.insertVideoTrack(req.uri, req.clock);
        const cmd = await this.session.editor.createInsertVideoTrack(req.uri, req.clock);
        await this.session.commander.applyInsertVideoTrack(cmd);
        this.enqueueFrontendUpdate();
        return ok;
      }
      case 'recorder/deleteVideo': {
        assert(this.session?.isLoaded());
        // await this.session.commander.deleteVideoTrack(req.id);
        const cmd = this.session.editor.createDeleteVideoTrack(req.id);
        await this.session.commander.applyDeleteVideoTrack(cmd);
        this.enqueueFrontendUpdate();
        return ok;
      }
      case 'recorder/updateVideo': {
        assert(this.session?.isLoaded());
        // await this.session.commander.updateVideoTrack(req.update);
        const cmd = this.session.editor.createUpdateVideoTrack(req.update);
        if (cmd) await this.session.commander.applyUpdateVideoTrack(cmd);
        this.enqueueFrontendUpdate();
        return ok;
      }
      case 'recorder/setCover': {
        // assert(this.session?.isLoaded());
        assert(this.session);
        await this.session.editor.setCover(req.uri);
        this.enqueueFrontendUpdate();
        return ok;
      }
      case 'recorder/deleteCover': {
        assert(this.session?.isLoaded());
        await this.session.editor.deleteCover();
        this.enqueueFrontendUpdate();
        return ok;
      }
      case 'recorder/changeSpeed': {
        assert(this.session?.isLoaded());
        // await this.session.commander.changeSpeed(req.range, req.factor);
        const cmd = this.session.editor.createChangeSpeed(req.range, req.factor);
        await this.session.commander.applyChangeSpeed(cmd);
        this.enqueueFrontendUpdate();
        return ok;
      }
      case 'recorder/merge': {
        assert(this.session?.isLoaded());
        // await this.session.commander.merge(req.range);
        const cmd = this.session.editor.createMerge(req.range);
        await this.session.commander.applyMerge(cmd);
        this.enqueueFrontendUpdate();
        return ok;
      }
      case 'recorder/insertGap': {
        assert(this.session?.isLoaded());
        // await this.session.commander.insertGap(req.clock, req.dur);
        const cmd = this.session.editor.createInsertGap(req.clock, req.dur);
        await this.session.commander.applyInsertGap(cmd);
        this.enqueueFrontendUpdate();
        return ok;
      }
      case 'recorder/insertChapter': {
        assert(this.session?.isLoaded());
        const cmd = this.session.editor.createInsertChapter(req.clock, req.title);
        await this.session.commander.applyInsertChapter(cmd);
        this.enqueueFrontendUpdate();
        return ok;
      }
      case 'recorder/updateChapter': {
        assert(this.session?.isLoaded());
        const cmd = this.session.editor.createUpdateChapter(req.index, req.update);
        await this.session.commander.applyUpdateChapter(cmd);
        this.enqueueFrontendUpdate();
        return ok;
      }
      case 'recorder/deleteChapter': {
        assert(this.session?.isLoaded());
        const cmd = this.session.editor.createDeleteChapter(req.index);
        await this.session.commander.applyDeleteChapter(cmd);
        this.enqueueFrontendUpdate();
        return ok;
      }
      case 'recorder/crop': {
        assert(this.session?.isLoaded());
        // await this.session.commander.crop(req.clock);
        const cmd = this.session.editor.createCrop(req.clock);
        await this.session.commander.applyCrop(cmd);
        this.enqueueFrontendUpdate();
        return ok;
      }
      case 'confirmForkFromPlayer': {
        if (!this.session?.isLoaded() || !this.session.rr.playing) {
          return { type: 'boolean', value: true };
        }

        const wasRunning = this.session.rr.playing;
        this.session.rr.pause();

        const confirmTitle = 'Fork';
        const answer = await vscode.window.showWarningMessage(
          `Do you want to stop playing and fork the current session?`,
          { modal: true },
          { title: 'Cancel', isCloseAffordance: true },
          { title: confirmTitle },
        );
        if (answer?.title != confirmTitle && wasRunning) {
          await this.session.rr.play();
        }
        this.enqueueFrontendUpdate();
        return { type: 'boolean', value: answer?.title === confirmTitle };
      }
      case 'confirmEditFromPlayer': {
        if (!this.session?.isLoaded() || !this.session.rr.playing) {
          return { type: 'boolean', value: true };
        }
        const wasRunning = this.session.rr.playing;
        this.session.rr.pause();

        const confirmTitle = 'Edit';
        const answer = await vscode.window.showWarningMessage(
          `Do you want to stop playing and edit the current session at ${lib.formatTimeSeconds(req.clock)}?`,
          { modal: true },
          { title: 'Cancel', isCloseAffordance: true },
          { title: confirmTitle },
        );
        if (answer?.title != confirmTitle && wasRunning) {
          await this.session.rr.play();
        }
        this.enqueueFrontendUpdate();
        return { type: 'boolean', value: answer?.title === confirmTitle };
      }
      case 'deleteSession': {
        const history = this.context.settings.history[req.sessionId];
        if (history) {
          const session = await Session.Core.fromLocal(this.context, history.workspace);
          if (session) {
            const confirmTitle = 'Delete';
            const answer = await vscode.window.showWarningMessage(
              `Do you want to delete session "${session.head?.title || 'Untitled'}"?`,
              { modal: true },
              { title: 'Cancel', isCloseAffordance: true },
              { title: confirmTitle },
            );
            if (answer?.title === confirmTitle) {
              await session.core.delete();
            }
          }
        }

        this.enqueueFrontendUpdate();
        return ok;
      }
      case 'audio': {
        assert(this.session?.isLoaded());
        this.session.rr.handleFrontendAudioEvent(req.event);
        return ok;
      }
      case 'video': {
        assert(this.session?.isLoaded());
        this.session.rr.handleFrontendVideoEvent(req.event);
        return ok;
      }
      case 'test': {
        this.test = req.value;
        return ok;
      }
      default: {
        lib.unreachable(req);
      }
    }
  }

  async openRecorderExistingSession(sessionId: string, clock?: number, fork?: boolean) {
    if (fork) {
      // Fork existing session.
      // const user = this.context.user && lib.userToUserSummary(this.context.user);
      // session = await Session.Core.fromFork(this.context, sessionId, { author: user });

      // TODO we may need to download the session. Where to download it to?
      //      what should the handle be? where to store the session data?
      vscode.window.showErrorMessage('TODO: support forking session.');
      return;
    }

    // Edit existing session.
    const history = this.context.settings.history[sessionId];
    const featured = this.featured?.find(s => s.id === sessionId);
    let session: Session | undefined;

    if (history) {
      session = await Session.Core.fromLocal(this.context, history.workspace);
    } else if (featured) {
      session = await Session.Core.fromRemote(this.context, featured);
      session.core.assertFormatVersionSupport();
      await session.core.download({ skipIfExists: true });
    }

    if (session) {
      if (await this.closeCurrentScreen()) {
        this.setSession(session);
        this.setScreen(t.Screen.Recorder);
        this.recorder = { tabId: 'details-view' };

        // This might trigger a vscode restart in which case nothing after this line will run.
        // After restart, this.restoreStateAfterRestart() will be called and it will recreate
        // the session, call session.prepare(), and set the screen.
        await this.setUpWorkspace({ recorder: { clock, tabId: this.recorder.tabId } });

        // Must be called after this.setUpWorkspace()
        await this.session!.prepare({ clock });
      }
    } else {
      this.showError(new Error(`Could not find requested session.`));
    }
  }

  async openRecorderNewSession() {
    const user = this.context.user && lib.userToUserSummary(this.context.user);
    // For new sessions, user will manually call recorder/load which will call setUpWorkspace().
    const head = Session.Core.makeNewHead(user);
    const workspace =
      VscWorkspace.getDefaultVscWorkspace() ??
      path.join(paths.getDefaultWorkspaceBasePath(osPaths.home), user?.username ?? 'anonym', 'new_session');

    // if (!workspace) {
    //   const options = {
    //     canSelectFiles: false,
    //     canSelectFolders: true,
    //     canSelectMany: false,
    //     title: 'Select a directory to start recording.',
    //   };
    //   const uris = await vscode.window.showOpenDialog(options);
    //   if (uris?.length === 1) workspace = path.abs(uris[0].path);
    // }

    const session = await Session.Core.fromNew(this.context, workspace, head);

    if (await this.closeCurrentScreen()) {
      this.setSession(session);
      this.setScreen(t.Screen.Recorder);
      this.recorder = { tabId: 'details-view' };
    }
  }

  async loadRecorder() {
    assert(this.session);
    assert(this.recorder);

    if (!this.session.workspace) {
      vscode.window.showErrorMessage('Please select a workspace for the session.');
      return;
    }
    if (!this.session.head.handle) {
      vscode.window.showErrorMessage('Please select a handle for the session.');
      return;
    }

    if (this.session.temp) {
      if (await Session.Core.sessionExists(this.session.workspace)) {
        const confirmTitle = 'Overwrite';
        const answer = await vscode.window.showWarningMessage(
          `A session already exists at ${this.session.workspace}. Do you want to overwrite it?`,
          { modal: true },
          { title: 'Cancel', isCloseAffordance: true },
          { title: confirmTitle },
        );
        if (answer?.title !== confirmTitle) return;
      } else {
        const confirmTitle = 'Continue';
        const answer = await vscode.window.showWarningMessage(
          `Contents of ${this.session.workspace} will be overwritten during recording and playback.`,
          { modal: true },
          { title: 'Cancel', isCloseAffordance: true },
          { title: confirmTitle },
        );
        if (answer?.title !== confirmTitle) return;
      }

      // Commit the temp session. Copies the temp session to its final destination based on workspace and handle.
      await this.session.core.commitTemp();
    }

    // This might trigger a vscode restart in which case nothing after this line will run.
    // After restart, this.restoreStateAfterRestart() will be called and it will recreate
    // the session, call session.prepare(), and set the screen.
    await this.setUpWorkspace({ recorder: { tabId: 'editor-view' } });

    await this.session.prepare();
    this.recorder.tabId = 'editor-view';
  }

  updateViewTitle() {
    // console.log('updateViewTitle: webviewProvider.view ' + (this.webviewProvider.view ? 'is set' : 'is NOT set'));
    if (this.context.view) {
      const username = this.context.user?.username;
      const title = username
        ? ` ${username} / ` + SCREEN_TITLES[this.screen]
        : SCREEN_TITLES[this.screen] + ` (not logged in) `;
      this.context.view.title = title;
    }
  }

  setScreen(screen: t.Screen) {
    this.screen = screen;
    this.updateViewTitle();
    vscode.commands.executeCommand('setContext', 'codemic.canOpenWelcome', screen !== t.Screen.Welcome);
  }

  setSession(session: Session) {
    this.session = session;
    session.onError = this.showError.bind(this);
    session.onProgress = this.handleSessionProgress.bind(this);
    session.onChange = this.handleSessionChange.bind(this);
  }

  async handleSessionProgress() {
    if (this.screen === t.Screen.Player) {
      await this.session!.core.writeHistoryClock();
    }
    await this.updateFrontend();
  }

  async handleSessionChange() {
    await this.updateFrontend();
    this.writeSessionThrottled();
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
  //   assert(this.session?.isLoaded())

  // }

  // async loadPlayer(options?: { afterRestart: boolean }) {
  //   assert(this.session?.isLoaded())

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
    assert(this.session);
    if (this.session.mustScan) {
      const cancel = 'Cancel';
      const exit = 'Exit';
      const answer = await vscode.window.showWarningMessage(
        'Are you sure you want to exit the recorder?',
        { modal: true, detail: 'Your changes will be lost if you exit.' },
        { title: cancel, isCloseAffordance: true },
        { title: exit },
      );

      return answer?.title === exit;
    }

    await this.writeSession({ pause: true });
    await this.session.core.gcBlobs();
    this.session = undefined;
    this.recorder = undefined;
    return true;
  }

  async playerWillClose(): Promise<boolean> {
    if (this.session?.rr?.running) {
      this.session.rr.pause();
    }
    this.session = undefined;
    return true;
  }

  /**
   * Session may not be loaded in which case only its head is written.
   */
  async writeSession(opts?: { pause?: boolean; ifDirty?: boolean }) {
    assert(this.session);
    this.writeSessionThrottled.cancel();

    if (opts?.pause && this.session.rr?.running) {
      this.session.rr.pause();
    }

    if (!opts?.ifDirty || this.session.editor.dirty) {
      await this.session.core.write();
      await this.session.core.writeHistoryRecording();
    }
  }

  // Defined as arrow function to preserve the value of "this" for _.throttle().
  writeSessionThrottledCommit = () => {
    this.writeSession({ ifDirty: true }).catch(console.error);
  };

  writeSessionThrottled = _.throttle(this.writeSessionThrottledCommit, SAVE_TIMEOUT_MS, { leading: false });

  async updateFeatured() {
    try {
      const res = await serverApi.send({ type: 'featured/get' }, this.context.user?.token);

      await Promise.allSettled(
        res.sessionHeads.flatMap(head => [
          serverApi.downloadSessionCover(head.id),
          head.author && serverApi.downloadAvatar(head.author.username),
        ]),
      ).then(lib.logRejectedPromises);

      this.featured = res.sessionHeads;
    } catch (error) {
      console.error(error);
      vscode.window.showErrorMessage('Failed to fetch featured items:', (error as Error).message);
    }
  }

  async updateWorkspaceCache() {
    const workspace = VscWorkspace.getDefaultVscWorkspace();
    const session = workspace && (await Session.Core.fromLocal(this.context, workspace));
    if (!session) return;

    await Promise.allSettled([
      session.head.author && serverApi.downloadAvatar(session.head.author.username),
      cache.copyCover(session.core.dataPath, session.head.id),
    ]).then(lib.logRejectedPromises);
  }

  async updateFeaturedAndCache() {
    await Promise.allSettled([
      this.context.user && serverApi.downloadAvatar(this.context.user.username),
      this.updateFeatured(),
      this.updateWorkspaceCache(),
    ]).then(lib.logRejectedPromises);
  }

  // async cacheChanged(version: number) {
  //   await this.context.postMessage?.({ type: 'updateCacheVersion', version });
  // }

  openView() {
    this.context.view?.show();
  }

  async deactivate() {
    await this.closeCurrentScreen();
  }

  async changeUser(user?: t.User) {
    // TODO ask user to convert anonymous sessions to the new user.

    const userDataPath = path.join(osPaths.data, user?.username ?? lib.ANONYM_USERNAME);
    const userSettingsPath = path.join(userDataPath, 'settings.json');
    const settings = await storage.readJSON<t.Settings>(userSettingsPath, CodeMic.makeDefaultSettings);

    this.session = undefined;
    this.context.user = user;
    this.context.userDataPath = userDataPath;
    this.context.userSettingsPath = userSettingsPath;
    this.context.settings = settings;
    this.context.extension.globalState.update('user', user);

    this.updateFeaturedAndCache().finally(this.updateFrontend.bind(this));

    await this.openWelcome();
  }

  async updateFrontend() {
    if (this.frontendUpdateBlockCounter > 0) {
      this.isFrontendDirty = true;
      return;
    }
    const store = await this.getStore();
    await this.context.postMessage?.({ type: 'updateStore', store });
    this.isFrontendDirty = false;
  }

  enqueueFrontendUpdate() {
    assert(
      this.frontendUpdateBlockCounter > 0,
      'It does not make much sense to call enqueueFrontendUpdate() when frontend update is not blocked. Call updateFrontend() directly.',
    );
    this.isFrontendDirty = true;
  }

  frontendUpdateBlockInc() {
    this.frontendUpdateBlockCounter++;
  }
  async frontendUpdateBlockDec() {
    if (--this.frontendUpdateBlockCounter === 0) {
      if (this.isFrontendDirty) await this.updateFrontend();
    }
  }

  showError(error: Error) {
    vscode.window.showErrorMessage(error.message);
  }

  getFirstSessionHistoryById(...ids: (string | undefined)[]): t.SessionHistory | undefined {
    return _.compact(ids)
      .map(id => this.context.settings.history[id])
      .find(Boolean);
  }

  async postAudioMessage(req: t.BackendAudioRequest): Promise<t.FrontendAudioResponse> {
    assert(this.context.postMessage);
    return this.context.postMessage(req);
  }

  async postVideoMessage(req: t.BackendVideoRequest): Promise<t.FrontendVideoResponse> {
    assert(this.context.postMessage);
    return this.context.postMessage?.(req);
  }

  // getCoverCacheUri(id: string): string {
  //   return this.context
  //     .view!.webview.asWebviewUri(vscode.Uri.file(this.context.cache.getCoverPath(id)))
  //     .toString();
  // }

  async getStore(): Promise<t.Store> {
    let session: t.SessionUIState | undefined;
    if (this.session) {
      session = {
        temp: this.session.temp,
        mustScan: this.session.mustScan,
        loaded: this.session.isLoaded(),
        canUndo: this.session.editor.canUndo,
        canRedo: this.session.editor.canRedo,
        playing: this.session.rr?.playing ?? false,
        recording: this.session.rr?.recording ?? false,
        head: this.session.head,
        clock: this.session.rr?.clock ?? 0,
        workspace: this.session.workspace,
        dataPath: this.session.core.dataPath,
        history: this.context.settings.history[this.session.head.id],
        // Get cover from cache because session may not be on disk.
        // coverUri: this.getCoverCacheUri(this.session.head.id),
        workspaceFocusTimeline: this.session.body?.focusTimeline,
        audioTracks: this.session.body?.audioTracks,
        videoTracks: this.session.body?.videoTracks,
        // blobsUriMap: this.session.rr?.vscWorkspace.getBlobsUriMap(),
        comments: COMMENTS[this.session.head.id],
      };
    }

    let welcome: t.WelcomeUIState | undefined;
    if (this.screen === t.Screen.Welcome) {
      // const coversUris: t.UriMap = {};
      // const avatarsUris: t.UriMap = {};
      const recent: t.SessionHead[] = [];

      const workspace = VscWorkspace.getDefaultVscWorkspace();
      let current: t.SessionHead | undefined;
      if (workspace) {
        current = (await Session.Core.fromLocal(this.context, workspace))?.head;
        // if (current) {
        //   coversUris[current.id] = this.getCoverCacheUri(current.id);
        // }
      }

      for (const history of Object.values(this.context.settings.history)) {
        try {
          const session = await Session.Core.fromLocal(this.context, history.workspace);
          if (!session) continue;

          // coversUris[session.head.id] = this.getCoverCacheUri(session.head.id);
          recent.push(session.head);
        } catch (error) {
          console.error(error);
        }
      }

      // for (const head of this.featured ?? []) {
      //   coversUris[head.id] = this.getCoverCacheUri(head.id);
      // }

      welcome = {
        current,
        recent,
        featured: this.featured || [],
        history: this.context.settings.history,
        // coversUris,
      };
    }

    return {
      screen: this.screen,
      user: this.context.user,
      account: this.account,
      welcome,
      recorder: this.recorder,
      player: {},
      session,
      test: this.test,
      cache: {
        avatarsPath: cache.avatarsPath,
        coversPath: cache.coversPath,
        version: cache.version,
      },
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
