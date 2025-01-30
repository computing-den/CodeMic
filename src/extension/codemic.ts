import './config.js'; // Init config
import WebviewProvider from './webview_provider.js';
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
import { doesVscHaveCorrectWorkspace } from './misc.js';

const SAVE_TIMEOUT_MS = 5_000;

type OpenScreenParams =
  | { screen: t.Screen.Loading }
  | { screen: t.Screen.Account; join?: boolean }
  | { screen: t.Screen.Player; session: Session }
  | { screen: t.Screen.Recorder; session: Session; tabId: t.RecorderUITabId; clock?: number }
  | { screen: t.Screen.Welcome };

class CodeMic {
  context: Context;
  screen: t.Screen = t.Screen.Loading;
  session?: Session;
  account?: t.AccountState;
  recorder?: { tabId: t.RecorderUITabId };
  welcome?: {
    current?: Session;
    recent: Session[];
    featured?: Session[];
    loading: boolean;
    error?: string;
  };

  frontendUpdateBlockCounter = 0;
  isFrontendDirty = true;

  test: any = 0;

  constructor(context: Context) {
    this.context = context;
  }

  static async fromExtensionContext(extension: vscode.ExtensionContext): Promise<CodeMic> {
    const webviewProvider = new WebviewProvider(extension);
    const user = extension.globalState.get<t.User>('user');
    const earlyAccessEmail = extension.globalState.get<string>('earlyAccessEmail');
    const userDataPath = path.join(osPaths.data, user?.username ?? lib.ANONYM_USERNAME);
    const userSettingsPath = path.join(userDataPath, 'settings.json');
    const settings = await storage.readJSON<t.Settings>(userSettingsPath, CodeMic.makeDefaultSettings);
    const context: Context = {
      extension,
      webviewProvider,
      user,
      userDataPath,
      userSettingsPath,
      settings,
      earlyAccessEmail,
      withProgress(options, task) {
        return vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, ...options },
          (progress, cancellationToken) => {
            const controller = new AbortController();
            cancellationToken.onCancellationRequested(controller.abort);
            return task(progress, controller);
          },
        );
      },
    };
    return new CodeMic(context);
  }

  static makeDefaultSettings(): t.Settings {
    return { history: {} };
  }

  async start() {
    // Set up commands.
    this.context.extension.subscriptions.push(
      vscode.commands.registerCommand('codemic.openView', this.openView.bind(this)),
    );
    this.context.extension.subscriptions.push(
      vscode.commands.registerCommand('codemic.openHome', () => this.openScreen({ screen: t.Screen.Welcome })),
    );
    this.context.extension.subscriptions.push(
      vscode.commands.registerCommand('codemic.refreshHome', () => this.openScreen({ screen: t.Screen.Welcome })),
    );
    this.context.extension.subscriptions.push(
      vscode.commands.registerCommand('codemic.account', () => this.openScreen({ screen: t.Screen.Account })),
    );

    // Set up webview.
    this.context.webviewProvider.onMessage = this.handleMessage.bind(this);
    this.context.webviewProvider.onViewOpen = this.viewOpened.bind(this);
    this.context.extension.subscriptions.push(
      vscode.window.registerWebviewViewProvider(WebviewProvider.viewType, this.context.webviewProvider, {
        webviewOptions: { retainContextWhenHidden: true },
      }),
    );

    // Vscode may restart after changing workspace. Restore state after such restart.
    // Otherwise, open the welcome screen.
    if (!(await this.restoreStateAfterRestart())) {
      await this.openScreen({ screen: t.Screen.Welcome });
    }
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
  async setUpWorkspace_MAY_RESTART_VSCODE(restoreState?: { recorder?: { tabId: t.RecorderUITabId; clock?: number } }) {
    assert(this.session);

    // Return if workspace is already up-to-date.
    if (doesVscHaveCorrectWorkspace(this.session.workspace)) return;

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
    assert(doesVscHaveCorrectWorkspace(this.session.workspace));
  }

  /**
   * Will not reject.
   * Returns true if we have restart state and it was restored properly.
   */
  async restoreStateAfterRestart() {
    try {
      const workspaceChange = this.getWorkspaceChangeGlobalState();
      if (!workspaceChange) return false;

      console.log('restoreStateAfterRestart(): ', workspaceChange);
      await this.setWorkspaceChangeGlobalState();

      const { screen, sessionId, recorder, workspace } = workspaceChange;

      const session = await Session.Core.fromLocal(this.context, workspace, { mustScan: recorder?.mustScan });
      assert(session);
      assert(doesVscHaveCorrectWorkspace(session.workspace));

      if (screen === t.Screen.Player) {
        await this.openScreen({ screen, session });
      } else if (screen === t.Screen.Recorder) {
        await this.openScreen({ screen, session, tabId: recorder!.tabId, clock: recorder!.clock });
      } else {
        throw new Error('Why was workspaceChange set?');
      }

      return true;

      // this.setScreen(t.Screen.Loading);

      // await this.setWorkspaceChangeGlobalState();

      // if (sessionId) {
      //   const session = await Session.Core.fromLocal(this.context, workspace, {
      //     mustScan: recorder?.mustScan,
      //   });
      //   assert(session);
      //   assert(VscWorkspace.getDefaultVscWorkspace() === session.workspace);

      //   this.setSession(session);
      //   await session.prepare(recorder);
      //   if (recorder) {
      //     this.recorder = { tabId: recorder.tabId };
      //   }
      // }
      // this.setScreen(screen);
      // return true;
    } catch (error) {
      console.error(error);
      this.showError(error as Error);
      return false;
    }
  }

  /**
   * HTML DOM is not necessarily loaded. See the webviewLoaded message handler.
   */
  async viewOpened() {
    try {
      this.context.postAudioMessage = this.postAudioMessage.bind(this);
      this.context.postVideoMessage = this.postVideoMessage.bind(this);
      this.context.updateFrontend = this.updateFrontend.bind(this);
      this.updateViewTitle();
      // await this.updateFrontend();

      // // DEV
      // if (config.debug && this.webviewProvider.bus) {
      //   try {
      //     const sessionId = '2f324d7a-1a2c-478e-ab80-df60f09e45bd';
      //     if (await Session.Core.fromLocal(this.context, sessionId)) {
      //       // Recorder
      //       await this.handleMessage({ type: 'recorder/open', sessionId });
      //       await this.handleMessage({ type: 'recorder/openTab', tabId: 'editor-view' });
      //       await this.updateFrontend();

      //       // Player
      //       // await this.handleMessage({ type: 'player/open', sessionId });
      //       // await this.updateFrontend();
      //     }
      //   } catch (error) {
      //     console.error('ERROR trying to open debug session:', error);
      //   }
      // }
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
      case 'webviewLoaded': {
        this.updateFrontend();
        return ok;
      }
      case 'account/open': {
        await this.openScreen({ screen: t.Screen.Account, join: req.join });
        this.updateFrontend();
        return ok;
      }
      case 'account/update': {
        assert(this.account);
        this.account = { ...this.account, ...req.changes };
        this.updateFrontend();
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

        this.updateFrontend();
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

        this.updateFrontend();
        return ok;
      }
      case 'account/logout': {
        await this.changeUser();
        this.updateFrontend();
        return ok;
      }
      case 'welcome/open': {
        await this.openScreen({ screen: t.Screen.Welcome });
        this.updateFrontend();
        return ok;
      }
      case 'welcome/earlyAccessEmail': {
        assert(this.welcome);
        const res = await serverApi.send({ type: 'earlyAccessEmail', email: req.email }, this.context.user?.token);
        this.welcome.error = undefined;

        if (res.value) {
          this.context.extension.globalState.update('earlyAccessEmail', req.email);
          this.context.earlyAccessEmail = req.email;
        } else {
          this.context.extension.globalState.update('earlyAccessEmail', undefined);
          this.welcome.error = 'Email is not on the early-access list.';
          this.context.earlyAccessEmail = undefined;
        }

        this.updateFrontend();
        return ok;
      }
      case 'welcome/openSessionInPlayer': {
        const session = this.findSessionInWelcomeById(req.sessionId);
        await this.openScreen({ screen: t.Screen.Player, session });

        this.updateFrontend();
        return ok;
      }
      case 'welcome/openSessionInRecorder': {
        const session = this.findSessionInWelcomeById(req.sessionId);
        await this.openScreen({ screen: t.Screen.Recorder, session, tabId: 'details-view' });

        this.updateFrontend();
        return ok;
      }
      case 'welcome/openNewSessionInRecorder': {
        const user = this.context.user && lib.userToUserSummary(this.context.user);
        // For new sessions, user will manually call recorder/load which will call setUpWorkspace.
        const head = Session.Core.makeNewHead(user?.username);
        const workspace =
          VscWorkspace.getDefaultVscWorkspace() ??
          path.join(paths.getDefaultWorkspaceBasePath(osPaths.home), user?.username ?? 'anonym', 'new_session');

        const session = await Session.Core.fromNew(this.context, workspace, head);
        await this.openScreen({ screen: t.Screen.Recorder, session, tabId: 'details-view' });

        this.updateFrontend();
        return ok;
      }
      case 'welcome/deleteSession': {
        const session = this.findSessionInWelcomeById(req.sessionId);

        const cancel = 'Cancel';
        const del = 'Delete';
        const answer = await vscode.window.showWarningMessage(
          `Are you sure you want to delete session ${session.head.handle}?`,
          { modal: true, detail: `${session.workspace} will be deleted.` },
          { title: cancel, isCloseAffordance: true },
          { title: del },
        );

        if (answer?.title === del) {
          await session.core.delete();
        }
        this.updateFrontend();
        return ok;
      }
      case 'welcome/likeSession': {
        const session = this.findSessionInWelcomeById(req.sessionId);
        await this.likeSession(session, req.value);

        this.updateFrontend();
        return ok;
      }

      case 'player/openInRecorder': {
        assert(this.session);
        let cancel = false;
        if (this.session.rr?.playing) {
          this.session.rr.pause();

          const confirmTitle = 'Edit';
          const answer = await vscode.window.showWarningMessage(
            `Do you want to stop playing and edit the current session at ${lib.formatTimeSeconds(
              this.session.rr.clock,
            )}?`,
            { modal: true },
            { title: 'Cancel', isCloseAffordance: true },
            { title: confirmTitle },
          );
          cancel = answer?.title != confirmTitle;
          if (cancel) await this.session.rr.play();
        }

        if (!cancel) {
          await this.openScreen({
            screen: t.Screen.Recorder,
            session: this.session,
            tabId: 'editor-view',
            clock: this.session.rr?.clock,
          });
        }

        this.updateFrontend();
        return ok;
      }
      case 'player/load': {
        assert(this.session);
        this.session.core.assertFormatVersionSupport();

        // Write history. Do it before setUpWorkspace because that may cause vscode restart.
        await this.session.core.writeHistoryOpenClose();

        // This might trigger a vscode restart in which case nothing after this line will run.
        // After restart, this.restoreStateAfterRestart() will be called and it will recreate
        // the session, call session.prepare(), and set the screen.
        await this.setUpWorkspace_MAY_RESTART_VSCODE();

        await this.session.prepare();
        this.updateFrontend();
        return ok;
      }
      case 'player/play': {
        assert(this.session?.isLoaded());
        await this.session.rr.play();
        await this.session.core.writeHistoryOpenClose();
        this.updateFrontend();
        return ok;
      }
      case 'player/pause': {
        assert(this.session?.isLoaded());
        this.session.rr.pause();
        await this.session.core.writeHistoryClock();
        this.updateFrontend();
        return ok;
      }
      case 'player/seek': {
        assert(this.session?.isLoaded());
        this.session.rr.seek(req.clock);
        this.updateFrontend();
        return ok;
      }
      case 'player/comment': {
        assert(this.session);
        await this.postComment(this.session, req.text, req.clock);
        this.updateFrontend();
        return ok;
      }
      case 'player/likeSession': {
        assert(this.session);
        await this.likeSession(this.session, req.value);

        this.updateFrontend();
        return ok;
      }
      // case 'player/update': {
      //   throw new Error('DELETE THIS');
      //   // assert(this.session.isLoaded())
      //   // this.player.updateState(req.changes);
      //   // return ok
      // }
      case 'recorder/openTab': {
        assert(this.session);
        assert(this.recorder);
        assert(req.tabId !== 'editor-view' || this.session.isLoaded());
        this.recorder.tabId = req.tabId;
        this.updateFrontend();
        return ok;
      }
      case 'recorder/load': {
        await this.loadRecorder();
        this.updateFrontend();
        return ok;
      }
      case 'recorder/record': {
        assert(this.session?.isLoaded());
        await this.session.rr.record();
        this.updateFrontend();
        return ok;
      }
      case 'recorder/play': {
        assert(this.session?.isLoaded());
        await this.session.rr.play();
        this.updateFrontend();
        return ok;
      }
      case 'recorder/pause': {
        assert(this.session?.isLoaded());
        this.session.rr.pause();
        this.updateFrontend();
        return ok;
      }
      case 'recorder/seek': {
        assert(this.session?.isLoaded());
        await this.session.rr.seek(req.clock);
        this.updateFrontend();
        return ok;
      }
      case 'recorder/save': {
        assert(this.session?.isLoaded());
        await this.writeSession({ pause: true });
        this.updateFrontend();
        return ok;
      }
      case 'recorder/publish': {
        try {
          assert(this.session?.isLoaded());
          await this.writeSession({ pause: true });
          await this.context.withProgress(
            { title: `Publishing session ${this.session.head.handle}`, cancellable: true },
            async (progress, abortController) => {
              assert(this.session?.isLoaded());
              await this.session.core.publish({ progress, abortController });
              vscode.window.showInformationMessage('Published session.');
            },
          );
        } catch (error) {
          this.showError(error as Error);
        }
        this.updateFrontend();
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
        this.updateFrontend();
        return ok;
      }
      case 'recorder/redo': {
        assert(this.session?.isLoaded());
        await this.session.commander.redo();
        // const cmds = this.session.editor.redo();
        // await this.session.rr.applyCmds(cmds);
        // console.log('Redo: ', cmds);
        this.updateFrontend();
        return ok;
      }
      case 'recorder/updateDetails': {
        assert(this.session);
        this.session.editor.updateDetails(req.changes);
        this.updateFrontend();
        return ok;
      }
      // case 'recorder/updateDuration': {
      //   assert(this.session);
      //   this.session.editor.updateDuration(req.duration);
      //   // await this.session.rr?.applyCmds([cmd]);
      //   this.updateFrontend();
      //   return ok;
      // }
      case 'recorder/insertAudio': {
        assert(this.session?.isLoaded());
        // await this.session.commander.insertAudioTrack(req.uri, req.clock);
        const cmd = await this.session.editor.createInsertAudioTrack(req.uri, req.clock);
        await this.session.commander.applyInsertAudioTrack(cmd);
        this.updateFrontend();
        return ok;
      }
      case 'recorder/deleteAudio': {
        assert(this.session?.isLoaded());
        // await this.session.commander.deleteAudioTrack(req.id);
        const cmd = this.session.editor.createDeleteAudioTrack(req.id);
        await this.session.commander.applyDeleteAudioTrack(cmd);
        this.updateFrontend();
        return ok;
      }
      case 'recorder/updateAudio': {
        assert(this.session?.isLoaded());
        // await this.session.commander.updateAudioTrack(req.update);
        const cmd = this.session.editor.createUpdateAudioTrack(req.update);
        if (cmd) await this.session.commander.applyUpdateAudioTrack(cmd);
        this.updateFrontend();
        return ok;
      }
      case 'recorder/insertVideo': {
        assert(this.session?.isLoaded());
        // await this.session.commander.insertVideoTrack(req.uri, req.clock);
        const cmd = await this.session.editor.createInsertVideoTrack(req.uri, req.clock);
        await this.session.commander.applyInsertVideoTrack(cmd);
        this.updateFrontend();
        return ok;
      }
      case 'recorder/deleteVideo': {
        assert(this.session?.isLoaded());
        // await this.session.commander.deleteVideoTrack(req.id);
        const cmd = this.session.editor.createDeleteVideoTrack(req.id);
        await this.session.commander.applyDeleteVideoTrack(cmd);
        this.updateFrontend();
        return ok;
      }
      case 'recorder/updateVideo': {
        assert(this.session?.isLoaded());
        // await this.session.commander.updateVideoTrack(req.update);
        const cmd = this.session.editor.createUpdateVideoTrack(req.update);
        if (cmd) await this.session.commander.applyUpdateVideoTrack(cmd);
        this.updateFrontend();
        return ok;
      }
      case 'recorder/setCover': {
        // assert(this.session?.isLoaded());
        assert(this.session);
        await this.session.editor.setCover(req.uri);
        this.updateFrontend();
        return ok;
      }
      case 'recorder/deleteCover': {
        assert(this.session?.isLoaded());
        await this.session.editor.deleteCover();
        this.updateFrontend();
        return ok;
      }
      case 'recorder/changeSpeed': {
        assert(this.session?.isLoaded());
        // await this.session.commander.changeSpeed(req.range, req.factor);
        const cmd = this.session.editor.createChangeSpeed(req.range, req.factor);
        await this.session.commander.applyChangeSpeed(cmd);
        this.updateFrontend();
        return ok;
      }
      case 'recorder/merge': {
        assert(this.session?.isLoaded());
        // await this.session.commander.merge(req.range);
        const cmd = this.session.editor.createMerge(req.range);
        await this.session.commander.applyMerge(cmd);
        this.updateFrontend();
        return ok;
      }
      case 'recorder/insertGap': {
        assert(this.session?.isLoaded());
        // await this.session.commander.insertGap(req.clock, req.dur);
        const cmd = this.session.editor.createInsertGap(req.clock, req.dur);
        await this.session.commander.applyInsertGap(cmd);
        this.updateFrontend();
        return ok;
      }
      case 'recorder/insertChapter': {
        assert(this.session?.isLoaded());
        const cmd = this.session.editor.createInsertChapter(req.clock, req.title);
        await this.session.commander.applyInsertChapter(cmd);
        this.updateFrontend();
        return ok;
      }
      case 'recorder/updateChapter': {
        assert(this.session?.isLoaded());
        const cmd = this.session.editor.createUpdateChapter(req.index, req.update);
        await this.session.commander.applyUpdateChapter(cmd);
        this.updateFrontend();
        return ok;
      }
      case 'recorder/deleteChapter': {
        assert(this.session?.isLoaded());
        const cmd = this.session.editor.createDeleteChapter(req.index);
        await this.session.commander.applyDeleteChapter(cmd);
        this.updateFrontend();
        return ok;
      }
      case 'recorder/crop': {
        assert(this.session?.isLoaded());
        // await this.session.commander.crop(req.clock);
        const cmd = this.session.editor.createCrop(req.clock);
        await this.session.commander.applyCrop(cmd);
        this.updateFrontend();
        return ok;
      }
      // case 'confirmForkFromPlayer': {
      //   if (!this.session?.isLoaded() || !this.session.rr.playing) {
      //     return { type: 'boolean', value: true };
      //   }

      //   const wasRunning = this.session.rr.playing;
      //   this.session.rr.pause();

      //   const confirmTitle = 'Fork';
      //   const answer = await vscode.window.showWarningMessage(
      //     `Do you want to stop playing and fork the current session?`,
      //     { modal: true },
      //     { title: 'Cancel', isCloseAffordance: true },
      //     { title: confirmTitle },
      //   );
      //   if (answer?.title != confirmTitle && wasRunning) {
      //     await this.session.rr.play();
      //   }
      //   this.updateFrontend();
      //   return { type: 'boolean', value: answer?.title === confirmTitle };
      // }
      // case 'confirmEditFromPlayer': {
      // }
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

  // async openRecorderExistingSession(sessionId: string, clock?: number, fork?: boolean) {
  //   if (fork) {
  //     // Fork existing session.
  //     // const user = this.context.user && lib.userToUserSummary(this.context.user);
  //     // session = await Session.Core.fromFork(this.context, sessionId, { author: user });

  //     // TODO we may need to download the session. Where to download it to?
  //     //      what should the handle be? where to store the session data?
  //     vscode.window.showErrorMessage('TODO: support forking session.');
  //     return;
  //   }

  //   // Edit existing session.
  //   const session = this.findSessionInWelcomeById(sessionId);
  //   if (session) {
  //     session.core.assertFormatVersionSupport();
  //     await session.download({ skipIfExists: true });

  //     await this.openScreen({ screen: t.Screen.Recorder, session, tabId: 'details-view', clock });

  //     // if (await this.closeCurrentScreen()) {
  //     //   this.setSession(session);
  //     //   this.setScreen(t.Screen.Recorder);
  //     //   this.recorder = { tabId: 'details-view' };

  //     //   // Write history. Do it before setUpWorkspace because that may cause vscode restart.
  //     //   await session.core.writeHistoryRecording();

  //     //   // This might trigger a vscode restart in which case nothing after this line will run.
  //     //   // After restart, this.restoreStateAfterRestart() will be called and it will recreate
  //     //   // the session, call session.prepare(), and set the screen.
  //     //   await this.setUpWorkspace_MAY_RESTART_VSCODE({ recorder: { clock, tabId: this.recorder.tabId } });

  //     //   // Must be called after setUpWorkspace
  //     //   await this.session!.prepare({ clock });
  //     // }
  //   } else {
  //     this.showError(new Error(`Could not find requested session.`));
  //   }
  // }

  // async openRecorderNewSession() {
  //   const user = this.context.user && lib.userToUserSummary(this.context.user);
  //   // For new sessions, user will manually call recorder/load which will call setUpWorkspace.
  //   const head = Session.Core.makeNewHead(user?.username);
  //   const workspace =
  //     VscWorkspace.getDefaultVscWorkspace() ??
  //     path.join(paths.getDefaultWorkspaceBasePath(osPaths.home), user?.username ?? 'anonym', 'new_session');

  //   const session = await Session.Core.fromNew(this.context, workspace, head);
  //   await this.openScreen({ screen: t.Screen.Recorder, session, tabId: 'details-view' });

  //   // if (await this.closeCurrentScreen()) {
  //   //   this.setSession(session);
  //   //   this.setScreen(t.Screen.Recorder);
  //   //   this.recorder = { tabId: 'details-view' };
  //   // }
  // }

  async loadRecorder() {
    // This is currently only used on temp sessions. Previously, it used to be used on committed
    // sessions too but decided that session must be fully loaded on opening recorder.

    assert(this.session);
    assert(this.recorder);

    if (this.session.temp) {
      const errorMessage = this.session.core.verifyAndNormalizeTemp();
      if (errorMessage) {
        vscode.window.showErrorMessage(errorMessage);
        return;
      }

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

    // Write history. Do it before setUpWorkspace because that may cause vscode restart.
    await this.session.core.writeHistoryRecording();

    // This might trigger a vscode restart in which case nothing after this line will run.
    // After restart, this.restoreStateAfterRestart() will be called and it will recreate
    // the session, call session.prepare(), and set the screen.
    await this.setUpWorkspace_MAY_RESTART_VSCODE({ recorder: { tabId: 'editor-view' } });

    await this.session.prepare();
    this.recorder.tabId = 'editor-view';
  }

  updateViewTitle() {
    const username = this.context.user?.username;
    const title = username
      ? _.compact([` ${username}`, SCREEN_TITLES[this.screen]]).join(' / ')
      : _.compact([SCREEN_TITLES[this.screen], `(not logged in) `]).join(' ');
    this.context.webviewProvider.setTitle(title);
  }

  setScreen(screen: t.Screen) {
    this.screen = screen;
    vscode.commands.executeCommand('setContext', 'codemic.canOpenHome', screen !== t.Screen.Welcome);
    vscode.commands.executeCommand('setContext', 'codemic.canRefreshHome', screen === t.Screen.Welcome);
    this.updateViewTitle();
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
    if (this.session && !this.session.temp) {
      this.writeSessionThrottled();
    }
  }

  // async openWelcome() {
  //   if (await this.closeCurrentScreen()) {
  //     await this.updateFrontend();
  //     this.updateWelcome().catch(console.error); // Do not await.
  //   }
  // }

  // async openAccount(options?: { join?: boolean }) {
  //   if (await this.closeCurrentScreen()) {
  //     this.account = {
  //       credentials: {
  //         email: this.context.earlyAccessEmail ?? '',
  //         username: '',
  //         password: '',
  //       },
  //       join: options?.join ?? false,
  //     };
  //     this.setScreen(t.Screen.Account);
  //     await this.updateFrontend();
  //   }
  // }

  async openScreen(params: OpenScreenParams): Promise<void> {
    // NOTE: opening the same screen is akin to F5 refresh and used for the refreshHome command.
    // if (params.screen === this.screen) return;

    if (!(await this.closeCurrentScreen())) return;

    switch (params.screen) {
      case t.Screen.Loading: {
        this.setScreen(t.Screen.Loading);
        await this.updateFrontend();
        break;
      }
      case t.Screen.Account: {
        this.account = {
          credentials: {
            email: this.context.earlyAccessEmail ?? '',
            username: '',
            password: '',
          },
          join: Boolean(params.join),
        };
        this.setScreen(t.Screen.Account);
        await this.updateFrontend();
        break;
      }
      case t.Screen.Player: {
        this.setSession(params.session);
        this.enrichSessions([params.session], { refreshPublication: true }).catch(console.error);
        this.setScreen(t.Screen.Player);
        await this.updateFrontend();
        break;
      }
      case t.Screen.Recorder: {
        params.session.core.assertFormatVersionSupport();
        await params.session.download({ skipIfExists: true });
        this.setSession(params.session);
        assert(this.session);

        this.enrichSessions([this.session], { refreshPublication: true }).catch(console.error);
        this.recorder = { tabId: params.tabId };

        // A non-temp session must be loaded immediately.
        if (!this.session.temp) {
          // Write history. Do it before setUpWorkspace because that may cause vscode restart.
          await this.session.core.writeHistoryRecording();

          // This might trigger a vscode restart in which case nothing after this line will run.
          // After restart, this.restoreStateAfterRestart() will be called and it will recreate
          // the session, call session.prepare(), and set the screen.
          await this.setUpWorkspace_MAY_RESTART_VSCODE({ recorder: { tabId: params.tabId, clock: params.clock } });

          // Must be called after setUpWorkspace
          await this.session.prepare({ clock: params.clock });
        }

        this.setScreen(t.Screen.Recorder);
        await this.updateFrontend();
        break;
      }
      case t.Screen.Welcome: {
        const current = await this.getSessionOfDefaultVscWorkspace();
        const recent = await this.getRecentSessions();
        this.welcome = {
          current,
          recent,
          loading: true,
        };

        // Do not block the welcome screen while enriching current and recent sessions.
        this.enrichSessions(_.compact([current, ...recent]), { refreshPublication: true }).catch(console.error);

        // Do not block the welcome screen while fetching featured sessions.
        (async () => {
          try {
            const featured = await this.fetchFeaturedSessions();
            if (this.welcome) {
              this.welcome.featured = featured;
              this.enrichSessions(featured);
            }
          } catch (error) {
            console.error(error);
          } finally {
            if (this.welcome) this.welcome.loading = false;
          }
        })();

        this.setScreen(t.Screen.Welcome);
        await this.updateFrontend();
        break;
      }
      default:
        lib.unreachable(params);
    }
  }

  async closeCurrentScreen(): Promise<boolean> {
    switch (this.screen) {
      case t.Screen.Loading: {
        break;
      }
      case t.Screen.Account: {
        this.account = undefined;
        break;
      }
      case t.Screen.Player: {
        this.session?.rr?.pause();
        this.session = undefined;
        break;
      }
      case t.Screen.Recorder: {
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

          if (answer?.title !== exit) return false;
        }

        await this.writeSession({ pause: true });
        await this.session.core.gcBlobs();
        this.session = undefined;
        this.recorder = undefined;
        break;
      }
      case t.Screen.Welcome: {
        break;
      }
      default:
        lib.unreachable(this.screen);
    }

    this.setScreen(t.Screen.Loading);
    return true;
  }

  /**
   * Session may not be loaded in which case only its head is written.
   */
  async writeSession(opts?: { pause?: boolean; ifDirty?: boolean }) {
    assert(this.session);
    assert(!this.session.temp);
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

  // async downloadSessionsPublication(sessionIds: string[]) {
  //   const { type, publications } = await serverApi.send(
  //     { type: 'sessions/publication', sessionIds },
  //     this.context.user?.token,
  //   );
  //   assert(type === 'sessionPublication');
  //   throw new Error('TODO'); // what to do with the publications?
  // }

  // async updateWelcome() {
  //   try {
  //     const welcome: t.WelcomeUIState = {
  //       recent: [],
  //       featured: [],
  //       loading: true,
  //     };
  //     this.welcome = welcome;

  //     // Update user avatar.
  //     const loadUser = async () => {
  //       if (this.context.user) {
  //         serverApi.downloadAvatar(this.context.user.username, this.context.user.token);
  //       }
  //     };

  //     // Update Workspace cover and avatar.
  //     const loadCurrent = async () => {
  //       const session = await this.getSessionOfDefaultVscWorkspace();
  //       welcome.current = session?.head;
  //       if (!session) return;

  //       const innerPromises = [
  //         session.head.author && serverApi.downloadAvatar(session.head.author, this.context.user?.token),
  //         cache.copyCover(session.core.dataPath, session.head.id),
  //         this.downloadSessionsPublication([session.head.id]),
  //       ];
  //       lib.logRejectedPromises(await Promise.allSettled(innerPromises));
  //     };

  //     const loadFeatured = async () => {
  //       const { sessionHeads } = await serverApi.send({ type: 'sessions/featured' }, this.context.user?.token);
  //       welcome.featured = sessionHeads;

  //       const innerPromises = sessionHeads.flatMap(head => [
  //         serverApi.downloadSessionCover(head.id, this.context.user?.token),
  //         head.author && serverApi.downloadAvatar(head.author, this.context.user?.token),
  //         this.downloadSessionsPublication(sessionHeads.map(h => h.id)),
  //       ]);
  //       lib.logRejectedPromises(await Promise.allSettled(innerPromises));
  //     };

  //     // TODO load recent sessions

  //     const promises = [loadUser(), loadCurrent(), loadFeatured()];
  //     lib.logRejectedPromises(await Promise.allSettled(promises));

  //     // Update featured sessions.
  //     // try {
  //     // } catch (error) {
  //     //   console.error(error);
  //     //   vscode.window.showErrorMessage('Failed to fetch featured items:', (error as Error).message);
  //     // } finally {
  //     //   this.loadingFeatured = false;
  //     // }
  //     await this.updateFrontend();
  //   } catch (error) {
  //     this.showError(error as Error);
  //   } finally {
  //     if (this.welcome) this.welcome.loading = false;
  //   }
  // }

  openView() {
    this.context.webviewProvider.show();
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
    this.context.extension.globalState.update('earlyAccessEmail', undefined);

    await this.openScreen({ screen: t.Screen.Welcome });
  }

  async updateFrontend() {
    if (this.frontendUpdateBlockCounter > 0) {
      this.isFrontendDirty = true;
      return;
    }
    const store = await this.getStore();
    if (this.context.webviewProvider.isReady) {
      await this.context.webviewProvider.postMessage({ type: 'updateStore', store });
      this.isFrontendDirty = false;
    }
  }

  // updateFrontend() {
  //   assert(
  //     this.frontendUpdateBlockCounter > 0,
  //     'It does not make much sense to call updateFrontend() when frontend update is not blocked. Call updateFrontend() directly.',
  //   );
  //   this.isFrontendDirty = true;
  // }

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
    return this.context.webviewProvider.postMessage(req);
  }

  async postVideoMessage(req: t.BackendVideoRequest): Promise<t.FrontendVideoResponse> {
    return this.context.webviewProvider.postMessage(req);
  }

  // getCoverCacheUri(id: string): string {
  //   return this.context
  //     .view!.webview.asWebviewUri(vscode.Uri.file(this.context.cache.getCoverPath(id)))
  //     .toString();
  // }

  findSessionInWelcomeById(sessionId: string): Session {
    assert(this.welcome);
    const session = [this.welcome.current, ...this.welcome.recent, ...(this.welcome.featured ?? [])].find(
      s => s?.head.id === sessionId,
    );
    assert(session);
    return session;
  }

  async getSessionOfDefaultVscWorkspace(): Promise<Session | undefined> {
    try {
      const workspace = VscWorkspace.getDefaultVscWorkspace();
      if (workspace && (await Session.Core.sessionExists(workspace))) {
        return await Session.Core.fromLocal(this.context, workspace);
      }
    } catch (error) {
      console.error(error);
    }
  }

  async getRecentSessions(): Promise<Session[]> {
    const recent: Session[] = [];
    for (const history of Object.values(this.context.settings.history)) {
      try {
        const session = await Session.Core.fromLocal(this.context, history.workspace);
        if (!session || session.head.id !== history.id) continue;

        recent.push(session);
      } catch (error) {
        console.error(error);
      }
    }
    return recent;
  }

  async fetchFeaturedSessions(): Promise<Session[]> {
    try {
      const { sessionHeads } = await serverApi.send({ type: 'sessions/featured' }, this.context.user?.token);
      return Promise.all(sessionHeads.map(h => Session.Core.fromRemote(this.context, h)));
    } catch (error) {
      this.showError(error as Error);
      return [];
    }
  }

  async enrichSessions(sessions: Session[], options?: { refreshPublication?: boolean }) {
    // We shouldn't download the cover of a session that is on disk.
    // The one on disk may be newer (author may be editing it locally).

    // TODO
    console.log(
      `enriching sessions (refreshPublication: ${options?.refreshPublication ?? false}): `,
      sessions.map(s => s.head.handle).join(', '),
    );
    await this.updateFrontend();

    // await this.updateFrontend();
  }

  async likeSession(session: Session, value: boolean) {
    // TODO
    console.log(`${value ? 'liking' : 'unliking'} session: ${session.head.handle}`);
    return;

    // if (!this.context.user) throw new Error('Please join/login to like sessions.');
    // await serverApi.send({ type: 'session/like/toggle', sessionId: req.sessionId }, this.context.user.token);
    // await this.enrichSessions([session]);
  }

  async postComment(session: Session, text: string, clock?: number) {
    // TODO
    console.log(`commenting on session: ${session.head.handle}`);
    return;

    // assert(this.context.user, 'Please join/login to post comments.');
    // await serverApi.send(
    //   { type: 'session/comment/post', sessionId: this.session.head.id, text: req.text, clock: req.clock },
    //   this.context.user.token,
    // );
    // await this.enrichSessions([session]);
  }

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
        workspaceFocusTimeline: this.session.body?.focusTimeline,
        audioTracks: this.session.body?.audioTracks,
        videoTracks: this.session.body?.videoTracks,
      };
    }

    let welcome: t.WelcomeUIState | undefined;
    if (this.screen === t.Screen.Welcome) {
      assert(this.welcome);
      welcome = {
        loading: this.welcome?.loading,
        recent: this.welcome.recent.map(s => s.head),
        current: this.welcome.current?.head,
        featured: this.welcome.featured?.map(s => s.head),
        error: this.welcome.error,
        history: this.context.settings.history,
      };
    }

    return {
      earlyAccessEmail: this.context.earlyAccessEmail,
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
  [t.Screen.Welcome]: '',
  [t.Screen.Player]: 'player',
  [t.Screen.Recorder]: 'studio',
  [t.Screen.Loading]: 'loading',
};

export default CodeMic;
