import './config.js'; // Init config
import WebviewProvider from './webview_provider.js';
import Session from './session/session.js';
import * as storage from './storage.js';
import * as serverApi from './server_api.js';
import type { Context } from './types.js';
import osPaths from './os_paths.js';
import * as vscode from 'vscode';
import _ from 'lodash';
import * as t from '../lib/types.js';
import * as lib from '../lib/lib.js';
import * as paths from '../lib/paths.js';
import VscWorkspace from './session/vsc_workspace.js';
import path from 'path';
import cache from './cache.js';
import assert from '../lib/assert.js';

type OpenScreenParams =
  | { screen: t.Screen.Loading }
  | { screen: t.Screen.Account; join?: boolean }
  | { screen: t.Screen.Player; session: Session; load: boolean }
  | { screen: t.Screen.Recorder; session: Session; clock?: number }
  | { screen: t.Screen.Welcome };

class CodeMic {
  context: Context;
  screen: t.Screen = t.Screen.Loading;
  session?: Session;
  account?: t.AccountState;
  recorder?: { tabId: t.RecorderUITabId };
  welcome?: {
    sessions: t.SessionListing[];
    loadingFeatured: boolean;
    error?: string;
  };
  searchQuery = '';
  userMetadata?: t.UserMetadata;

  // With the publications in a global map, we don't have to worry about which
  // part of the app mutates session head and if it contains the latest
  // publication or not. We always have the latest publication.
  publications = new Map<string, t.SessionPublication>();

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
            cancellationToken.onCancellationRequested(() => controller.abort());
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
      vscode.commands.registerCommand('codemic.refreshHome', this.refreshWelcomeScreen.bind(this)),
    );
    this.context.extension.subscriptions.push(
      vscode.commands.registerCommand('codemic.account', () => this.openScreen({ screen: t.Screen.Account })),
    );
    this.context.extension.subscriptions.push(
      vscode.commands.registerCommand('codemic.reportIssue', () => this.reportIssue()),
    );
    this.context.extension.subscriptions.push(
      vscode.commands.registerCommand('codemic.pause', async () => {
        await this.session?.rr?.pause();
        await this.updateFrontend();
      }),
    );
    this.context.extension.subscriptions.push(
      vscode.commands.registerCommand('codemic.play', async () => {
        await this.session?.rr?.enqueuePlay();
        if (this.session?.rr?.inPlayerMode) {
          await this.session.core.writeHistoryOpenClose();
        }
      }),
    );
    this.context.extension.subscriptions.push(
      vscode.commands.registerCommand('codemic.record', async () => {
        await this.session?.rr?.enqueueRecord();
      }),
    );

    // Set up URI handler.
    this.context.extension.subscriptions.push(
      vscode.window.registerUriHandler({ handleUri: this.handleUri.bind(this) }),
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
    if (await this.restoreStateAfterRestart()) {
      // We're done. It restores and prepares session, opens the right screen, and even restores userMetadata.
    } else {
      // There was no restart state to restore (or restore failed).

      // Update userMetadata without waiting.
      this.updateUserMetadata().catch(console.error);

      // Open welcome.
      await this.openScreen({ screen: t.Screen.Welcome });
    }
  }

  /**
   * Will not reject.
   * Returns true if there was state to restore and it was restored properly.
   */
  async restoreStateAfterRestart() {
    try {
      const workspaceChange = VscWorkspace.getWorkspaceChangeGlobalState(this.context);
      if (!workspaceChange) return false;

      console.log('restoreStateAfterRestart(): ', workspaceChange);
      await VscWorkspace.setWorkspaceChangeGlobalState(this.context);

      let { screen, recorder, workspace, userMetadata, searchQuery } = workspaceChange;

      // Make sure vscode has the right workspace folder.
      VscWorkspace.testWorkspace(workspace);

      // Restore user and search.
      this.userMetadata = userMetadata;
      this.searchQuery = searchQuery;

      // Open session.
      const session = await Session.Core.readLocal(this.context, workspace, { mustScan: recorder?.mustScan });
      assert(session, 'Failed to read sesion after setting workspace folder');

      // Open screen. This will also load the session.
      if (screen === t.Screen.Player) {
        await this.openScreen({ screen, session, load: true });
      } else if (screen === t.Screen.Recorder) {
        await this.openScreen({ screen, session, clock: recorder!.clock });
      }

      return true;
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
      // this.context.postAudioMessage = this.postAudioMessage.bind(this);
      // this.context.postVideoMessage = this.postVideoMessage.bind(this);
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

  async handleUri(uri: vscode.Uri) {
    try {
      const segments = uri.path.split('/');
      segments.shift(); // Get rid of empty ''.
      if (segments[0] === 's' && segments.length === 3) {
        const [_s, sessionAuthor, sessionHandle] = segments;

        const { head, publication } = await serverApi.send(
          { type: 'session/head_and_publication', sessionAuthor, sessionHandle },
          this.context.user?.token,
        );
        this.publications.set(head.id, publication);

        const session = Session.Core.fromRemote(this.context, head);
        await session.core.writeHistoryOpenClose();
        await this.openScreen({ screen: t.Screen.Player, session, load: false });
      } else {
        throw new Error(`Unrecognizable URI path: ${uri.path}`);
      }
    } catch (error) {
      this.showError(error as Error);
    }
  }

  async handleMessage(req: t.FrontendRequest): Promise<t.BackendResponse> {
    try {
      return await this.handleMessageInner(req);
    } catch (error) {
      this.showError(error as Error);
      throw error;
    }
  }
  async handleMessageInner(req: t.FrontendRequest): Promise<t.BackendResponse> {
    // console.log('extension received: ', req);
    const ok = { type: 'ok' } as t.OKResponse;

    switch (req.type) {
      case 'webviewLoaded': {
        await this.updateFrontend();
        return ok;
      }
      case 'account/open': {
        await this.openScreen({ screen: t.Screen.Account, join: req.join });
        await this.updateFrontend();
        return ok;
      }
      case 'account/update': {
        assert(this.account);
        this.account = { ...this.account, ...req.changes };
        await this.updateFrontend();
        return ok;
      }
      case 'account/join': {
        assert(this.account);

        let user: t.User | undefined;
        try {
          user = (await serverApi.send({ type: 'user/join', credentials: this.account.credentials })).user;
        } catch (error) {
          console.error(error);
          this.account.error = (error as Error).message;
        }

        // Don't put the following in the try-catch above because
        // we want the errors to be handled and shown separately.
        if (user) {
          await this.changeUser(user);
        }

        await this.updateFrontend();
        return ok;
      }
      case 'account/login': {
        assert(this.account);
        this.account.join = false;

        let user: t.User | undefined;
        try {
          user = (await serverApi.send({ type: 'user/login', credentials: this.account.credentials })).user;
        } catch (error) {
          console.error(error);
          if (this.account) this.account.error = (error as Error).message;
        }

        // Don't put the following in the try-catch above because
        // we want the errors to be handled and shown separately.
        if (user) {
          await this.changeUser(user);
        }

        await this.updateFrontend();
        return ok;
      }
      case 'account/logout': {
        await this.changeUser();
        await this.updateFrontend();
        return ok;
      }
      case 'welcome/open': {
        await this.openScreen({ screen: t.Screen.Welcome });
        await this.updateFrontend();
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

        await this.updateFrontend();
        return ok;
      }
      case 'welcome/openSessionInPlayer': {
        const listing = this.welcome?.sessions.find(s => s.head.id === req.sessionId);
        assert(listing);
        const session = Session.Core.fromListing(this.context, listing);
        await this.openScreen({ screen: t.Screen.Player, session, load: false });

        // await this.updateFrontend();
        return ok;
      }
      case 'welcome/openSessionInRecorder': {
        const listing = this.welcome?.sessions.find(s => s.head.id === req.sessionId);
        assert(listing);
        const session = Session.Core.fromListing(this.context, listing);
        if (!listing.local) await session.download({ skipIfExists: true });
        await this.openScreen({ screen: t.Screen.Recorder, session });

        // await this.updateFrontend();
        return ok;
      }
      case 'welcome/openNewSessionInRecorder': {
        // For new sessions, user will manually call recorder/load which will call setUpWorkspace.
        const head = Session.Core.makeNewHead(this.context.user?.username);
        const workspace =
          VscWorkspace.getDefaultVscWorkspace() ??
          path.join(
            paths.getDefaultWorkspaceBasePath(osPaths.home),
            this.context.user?.username ?? lib.ANONYM_USERNAME,
            'new_session',
          );

        if (workspace) {
          head.handle = path.basename(workspace);
        }

        const session = await Session.Core.fromNew(this.context, workspace, head);
        await this.openScreen({ screen: t.Screen.Recorder, session });

        // await this.updateFrontend();
        return ok;
      }
      case 'welcome/openWorkspace': {
        const uris = await vscode.window.showOpenDialog({
          canSelectFiles: false,
          canSelectFolders: true,
          canSelectMany: false,
          title: 'Open a directory with a .CodeMic session',
        });

        const workspace = uris?.[0]?.fsPath;
        if (!workspace) return ok;

        await VscWorkspace.setUpWorkspace_MAY_RESTART_VSCODE(this.context, {
          screen: t.Screen.Welcome,
          workspace,
          searchQuery: this.searchQuery,
          userMetadata: this.userMetadata,
        });

        return ok;
      }
      case 'welcome/deleteSession': {
        assert(this.welcome);
        const listing = this.welcome?.sessions.find(s => s.head.id === req.sessionId);
        assert(listing);
        const session = Session.Core.fromListing(this.context, listing);

        const cancel = 'Cancel';
        const deleteHistory = 'Delete history';
        const deleteAll = 'Delete history & data';
        const answer = await vscode.window.showWarningMessage(
          `Are you sure you want to delete session ${session.head.handle}?`,
          { modal: true, detail: `${session.workspace} will be deleted.` },
          { title: cancel, isCloseAffordance: true },
          { title: deleteHistory },
          { title: deleteAll },
        );

        if (answer?.title === deleteHistory) {
          await session.core.deleteHistory();
        }
        if (answer?.title === deleteAll) {
          await session.core.deleteWorkspace();
          await session.core.deleteHistory();
        }

        if (answer?.title === deleteHistory || answer?.title === deleteAll) {
          this.welcome.sessions = this.welcome.sessions.filter(s => s.head.id !== req.sessionId);
        }
        await this.updateFrontend();
        return ok;
      }
      case 'welcome/likeSession': {
        const listing = this.welcome?.sessions.find(s => s.head.id === req.sessionId);
        assert(listing);
        await this.likeSession(listing.head.id, req.value);

        await this.updateFrontend();
        return ok;
      }

      case 'welcome/search': {
        this.searchQuery = req.searchQuery;

        await this.updateFrontend();
        return ok;
      }

      case 'player/openInRecorder': {
        assert(this.session);
        this.session.core.assertFormatVersionSupport();
        let cancel = false;
        if (this.session.rr?.playing) {
          await this.session.rr.pause();

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
          if (cancel) await this.session.rr.enqueuePlay();
        }

        if (!cancel) {
          if (!this.session.local) await this.session.download({ skipIfExists: true });
          await this.openScreen({ screen: t.Screen.Recorder, session: this.session, clock: this.session.rr?.clock });
        }

        await this.updateFrontend();
        return ok;
      }
      case 'player/load': {
        assert(this.session);
        this.session.core.assertFormatVersionSupport();
        await this.session.download({ skipIfExists: true });

        // Write history. Do it before setUpWorkspace because that may cause vscode restart.
        await this.session.core.writeHistoryOpenClose();

        // This might trigger a vscode restart in which case nothing after this line will run.
        // After restart, this.restoreStateAfterRestart() will be called and it will recreate
        // the session, call session.prepare(), and set the screen.
        await VscWorkspace.setUpWorkspace_MAY_RESTART_VSCODE(this.context, {
          screen: t.Screen.Player,
          workspace: this.session.workspace,
          searchQuery: this.searchQuery,
          userMetadata: this.userMetadata,
        });

        await this.session.prepare({ clock: req.clock });
        this.enrichSessions([this.session.head.id]).catch(console.error);
        await this.updateFrontend();
        return ok;
      }
      case 'player/play': {
        assert(this.session?.isLoaded());
        await this.session.rr.enqueuePlay();
        await this.session.core.writeHistoryOpenClose();
        await this.updateFrontend();
        return ok;
      }
      case 'player/pause': {
        assert(this.session?.isLoaded());
        await this.session.rr.pause();
        await this.updateFrontend();
        return ok;
      }
      case 'player/seek': {
        assert(this.session?.isLoaded());
        this.session.rr.enqueueSeek(req.clock);
        await this.updateFrontend();
        return ok;
      }
      case 'player/comment': {
        assert(this.session);
        await this.postComment(this.session, req.text, req.clock);
        await this.updateFrontend();
        return ok;
      }
      case 'player/likeSession': {
        assert(this.session);
        await this.likeSession(this.session.head.id, req.value);

        await this.updateFrontend();
        return ok;
      }
      case 'player/syncWorkspace': {
        assert(this.session?.isLoaded());
        await this.session.rr.enqueueSync();
        await this.updateFrontend();
        return ok;
      }
      case 'player/setPlaybackRate': {
        assert(this.session?.isLoaded());
        this.session.rr.setPlaybackRate(req.rate);
        await this.updateFrontend();
        return ok;
      }
      case 'recorder/openTab': {
        assert(this.session);
        assert(this.recorder);
        assert(req.tabId !== 'editor-view' || this.session.isLoaded());
        this.recorder.tabId = req.tabId;
        await this.updateFrontend();
        return ok;
      }
      case 'recorder/load': {
        assert(this.session);
        assert(this.recorder);
        assert(this.session.temp);
        if (await this.loadRecorder(this.session, { skipConfirmation: req.skipConfirmation })) {
          this.recorder.tabId = 'editor-view';
        }
        await this.updateFrontend();
        return ok;
      }
      case 'recorder/record': {
        assert(this.session?.isLoaded());
        await this.session.rr.enqueueRecord();
        await this.updateFrontend();
        return ok;
      }
      case 'recorder/play': {
        assert(this.session?.isLoaded());
        await this.session.rr.enqueuePlay();
        await this.updateFrontend();
        return ok;
      }
      case 'recorder/pause': {
        assert(this.session?.isLoaded());
        await this.session.rr.pause();
        await this.updateFrontend();
        return ok;
      }
      case 'recorder/seek': {
        assert(this.session?.isLoaded());
        await this.session.rr.enqueueSeek(req.clock, req.useStepper);
        await this.updateFrontend();
        return ok;
      }
      case 'recorder/syncWorkspace': {
        assert(this.session?.isLoaded());
        await this.session.rr.enqueueSync(req.clock);
        await this.updateFrontend();
        return ok;
      }
      case 'recorder/setPlaybackRate': {
        assert(this.session?.isLoaded());
        this.session.rr.setPlaybackRate(req.rate);
        await this.updateFrontend();
        return ok;
      }
      // case 'recorder/save': {
      //   assert(this.session?.isLoaded());
      //   await this.session.editor.write({ pause: true });
      //   await this.updateFrontend();
      //   return ok;
      // }
      case 'recorder/publish': {
        try {
          assert(this.session?.isLoaded());
          await this.session.rr.pause();
          await this.context.withProgress(
            { title: `Publishing session ${this.session.head.handle}`, cancellable: true },
            async (progress, abortController) => {
              assert(this.session?.isLoaded());
              const publication = await this.session.core.publish({ progress, abortController });
              this.publications.set(this.session.head.id, publication);
              vscode.window.showInformationMessage('Published session.');
            },
          );
        } catch (error) {
          this.showError(error as Error);
        }
        await this.updateFrontend();
        return ok;
      }
      case 'getStore': {
        return { type: 'store', store: this.getStore() };
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
      case 'showMessage': {
        if (req.messageType === 'warning') {
          await vscode.window.showWarningMessage(req.message);
        } else if (req.messageType === 'information') {
          await vscode.window.showInformationMessage(req.message);
        } else if (req.messageType === 'error') {
          await vscode.window.showErrorMessage(req.message);
        }

        return ok;
      }
      case 'copySessionLink': {
        // TODO warn if not published yet
        if (!req.sessionHandle) {
          await vscode.window.showErrorMessage('Please enter a valid handle for the session first');
          return ok;
        }
        const author = req.sessionAuthor || this.context.user?.username;
        if (!author) {
          await vscode.window.showErrorMessage('Please log in first');
          return ok;
        }

        const uri = vscode.Uri.parse(`${vscode.env.uriScheme}://computingden.codemic/s/${author}/${req.sessionHandle}`);
        await vscode.env.clipboard.writeText(uri.toString());

        if (this.publications.get(req.sessionId)) {
          await vscode.window.showInformationMessage('Copied session link to clipboard');
        } else {
          await vscode.window.showInformationMessage('Copied session link to clipboard (session is not published yet)');
        }

        return ok;
      }
      case 'recorder/undo': {
        assert(this.session?.isLoaded());
        const change = this.session.editor.undo();
        if (change) await this.session.rr.enqueueSyncAfterSessionChange(change);
        await this.updateFrontend();
        return ok;
      }
      case 'recorder/redo': {
        assert(this.session?.isLoaded());
        const change = this.session.editor.redo();
        if (change) await this.session.rr.enqueueSyncAfterSessionChange(change);
        await this.updateFrontend();
        return ok;
      }
      case 'recorder/setSelection': {
        assert(this.session?.isLoaded());
        this.session.editor.setSelection(req.selection);
        await this.updateFrontend();
        return ok;
      }
      case 'recorder/extendSelection': {
        assert(this.session?.isLoaded());
        this.session.editor.extendSelection(req.clock);
        await this.updateFrontend();
        return ok;
      }
      case 'recorder/updateDetails': {
        assert(this.session);
        this.session.editor.updateDetails(req.changes);
        await this.updateFrontend();
        return ok;
      }
      case 'recorder/insertAudio': {
        assert(this.session?.isLoaded());
        const change = await this.session.editor.insertAudioTrack(req.uri, req.clock);
        await this.session.rr.enqueueSyncAfterSessionChange(change);
        await this.updateFrontend();
        return ok;
      }
      case 'recorder/deleteAudio': {
        assert(this.session?.isLoaded());
        const change = this.session.editor.deleteAudioTrack(req.id);
        await this.session.rr.enqueueSyncAfterSessionChange(change);
        await this.updateFrontend();
        return ok;
      }
      case 'recorder/updateAudio': {
        assert(this.session?.isLoaded());
        const change = this.session.editor.updateAudioTrack(req.update);
        if (change) await this.session.rr.enqueueSyncAfterSessionChange(change);
        await this.updateFrontend();
        return ok;
      }
      case 'recorder/insertVideo': {
        assert(this.session?.isLoaded());
        const change = await this.session.editor.insertVideoTrack(req.uri, req.clock);
        await this.session.rr.enqueueSyncAfterSessionChange(change);
        await this.updateFrontend();
        return ok;
      }
      case 'recorder/deleteVideo': {
        assert(this.session?.isLoaded());
        const change = this.session.editor.deleteVideoTrack(req.id);
        await this.session.rr.enqueueSyncAfterSessionChange(change);
        await this.updateFrontend();
        return ok;
      }
      case 'recorder/updateVideo': {
        assert(this.session?.isLoaded());
        const change = this.session.editor.updateVideoTrack(req.update);
        if (change) await this.session.rr.enqueueSyncAfterSessionChange(change);
        await this.updateFrontend();
        return ok;
      }
      case 'recorder/insertImage': {
        assert(this.session?.isLoaded());
        const change = await this.session.editor.insertImageTrack(req.uri, req.clock);
        await this.session.rr.enqueueSyncAfterSessionChange(change);
        await this.updateFrontend();
        return ok;
      }
      case 'recorder/deleteImage': {
        assert(this.session?.isLoaded());
        const change = this.session.editor.deleteImageTrack(req.id);
        await this.session.rr.enqueueSyncAfterSessionChange(change);
        await this.updateFrontend();
        return ok;
      }
      case 'recorder/updateImage': {
        assert(this.session?.isLoaded());
        const change = this.session.editor.updateImageTrack(req.update);
        if (change) await this.session.rr.enqueueSyncAfterSessionChange(change);
        await this.updateFrontend();
        return ok;
      }
      case 'recorder/setCover': {
        assert(this.session);
        await this.session.editor.setCover(req.uri);
        await this.updateFrontend();
        return ok;
      }
      case 'recorder/deleteCover': {
        assert(this.session?.isLoaded());
        await this.session.editor.deleteCover();
        await this.updateFrontend();
        return ok;
      }
      case 'recorder/changeSpeed': {
        assert(this.session?.isLoaded());
        const change = this.session.editor.changeSpeed(req.range, req.factor, req.adjustMediaTracks);
        await this.session.rr.enqueueSyncAfterSessionChange(change);
        await this.updateFrontend();
        return ok;
      }
      case 'recorder/merge': {
        assert(this.session?.isLoaded());
        const change = this.session.editor.merge(req.range, req.adjustMediaTracks);
        await this.session.rr.enqueueSyncAfterSessionChange(change);
        await this.updateFrontend();
        return ok;
      }
      case 'recorder/insertGap': {
        assert(this.session?.isLoaded());
        const change = this.session.editor.insertGap(req.clock, req.dur, req.adjustMediaTracks);
        await this.session.rr.enqueueSyncAfterSessionChange(change);
        await this.updateFrontend();
        return ok;
      }
      case 'recorder/insertChapter': {
        assert(this.session?.isLoaded());
        const change = this.session.editor.insertChapter(req.clock, req.title);
        await this.session.rr.enqueueSyncAfterSessionChange(change);
        await this.updateFrontend();
        return ok;
      }
      case 'recorder/updateChapter': {
        assert(this.session?.isLoaded());
        const change = this.session.editor.updateChapter(req.index, req.update);
        await this.session.rr.enqueueSyncAfterSessionChange(change);
        await this.updateFrontend();
        return ok;
      }
      case 'recorder/deleteChapter': {
        assert(this.session?.isLoaded());
        const change = this.session.editor.deleteChapter(req.index);
        await this.session.rr.enqueueSyncAfterSessionChange(change);
        await this.updateFrontend();
        return ok;
      }
      case 'recorder/crop': {
        assert(this.session?.isLoaded());
        const change = this.session.editor.crop(req.clock, req.adjustMediaTracks);
        await this.session.rr.enqueueSyncAfterSessionChange(change);
        await this.updateFrontend();
        return ok;
      }
      case 'recorder/makeClip': {
        await this.context.withProgress(
          { title: `Making a clip`, cancellable: true },
          async (progress, abortController) => {
            assert(this.session?.isLoaded());
            const changes = await this.session.editor.makeClip(progress, abortController);
            if (changes) {
              for (const change of changes) await this.session.rr.enqueueSyncAfterSessionChange(change);
            }
            await this.updateFrontend();
          },
        );

        return ok;
      }
      case 'recorder/forkSession': {
        assert(this.session?.isLoaded());

        if (await storage.pathExists(req.workspace)) {
          const cancel = 'Cancel';
          const overwrite = 'Overwrite';
          const answer = await vscode.window.showWarningMessage(
            `Are you sure you want to overwrite ${req.workspace}?`,
            { modal: true, detail: 'Existing data will be deleted' },
            { title: cancel, isCloseAffordance: true },
            { title: overwrite },
          );

          if (answer?.title !== overwrite) return ok;
        }

        await this.stopRecorderWriteAndCleanUp();

        const forkHead = await this.session.core.fork({
          handle: req.handle,
          workspace: req.workspace,
          author: this.context.user?.username,
        });
        const session = Session.Core.fromLocal(this.context, forkHead, req.workspace);
        await cache.copyCover(Session.Core.getDataPath(req.workspace), session.head.id);
        await this.openScreen({ screen: t.Screen.Recorder, session });

        return ok;
      }

      case 'recorder/mergeVideoAudioTracks': {
        await this.context.withProgress(
          { title: `Merging video/audio tracks`, cancellable: true },
          async (progress, abortController) => {
            assert(this.session?.isLoaded());
            const change = await this.session.editor.mergeVideoAudioTracks(progress, abortController, req.deleteOld);
            if (change) await this.session.rr.enqueueSyncAfterSessionChange(change);
            await this.updateFrontend();
          },
        );

        return ok;
      }
      case 'recorder/makeTest': {
        assert(this.session?.isLoaded());
        await this.session.rr.makeTest();
        vscode.window.showInformationMessage('Made test.');
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
      // case 'video': {
      //   assert(this.session?.isLoaded());
      //   this.session.rr.handleFrontendVideoEvent(req.event);
      //   return ok;
      // }
      case 'readyToLoadMedia': {
        assert(this.session?.isLoaded());
        this.session.rr.enqueueSyncMedia();
        return ok;
      }
      case 'media/error': {
        this.showError(new Error(`Error for ${req.mediaType} track: ${req.error}`));
        return ok;
      }
      default: {
        lib.unreachable(req);
      }
    }
  }

  async loadRecorder(session: Session, opts?: { clock?: number; skipConfirmation?: boolean }): Promise<boolean> {
    // NOTE: Do not attempt to download the session here.
    //       After a vscode restart, the session is no longer temp
    //       but it doesn't yet have a body either until scan is done.
    //       Calling download with skipIfExists will not actually skip
    //       because it sees that body doesn't exist.

    session.core.assertFormatVersionSupport();

    // Confirm and commit temp session.
    if (session.temp) {
      session.core.verifyAndNormalizeTemp();

      if (!opts?.skipConfirmation) {
        if (await Session.Core.sessionExists(session.workspace)) {
          const confirmTitle = 'Overwrite';
          const answer = await vscode.window.showWarningMessage(
            `A session already exists at ${session.workspace}. Do you want to overwrite it?`,
            { modal: true },
            { title: 'Cancel', isCloseAffordance: true },
            { title: confirmTitle },
          );
          if (answer?.title !== confirmTitle) return false;
        } else {
          const confirmTitle = 'Continue';
          const answer = await vscode.window.showWarningMessage(
            `Contents of ${session.workspace} will be overwritten during recording and playback.`,
            { modal: true },
            { title: 'Cancel', isCloseAffordance: true },
            { title: confirmTitle },
          );
          if (answer?.title !== confirmTitle) return false;
        }
      }

      // Commit the temp session. Copies the temp session to its final destination based on workspace and handle.
      await session.core.commitTemp();
    } else {
      // Write session before attempting to set up workspace which may trigger a vscode restart.
      // await session.core.write();
    }

    // Write history. Do it before setUpWorkspace because that may trigger a vscode restart.
    await session.core.writeHistoryRecording();

    // This might trigger a vscode restart in which case nothing after this line will run.
    // After restart, this.restoreStateAfterRestart() will be called and it will recreate
    // the session, call session.prepare(), and set the screen.
    await VscWorkspace.setUpWorkspace_MAY_RESTART_VSCODE(this.context, {
      screen: t.Screen.Recorder,
      workspace: session.workspace,
      searchQuery: this.searchQuery,
      recorder: { mustScan: session.mustScan, clock: opts?.clock },
      userMetadata: this.userMetadata,
    });

    await session.prepare({ clock: opts?.clock });
    return true;
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
      this.session!.core.writeHistoryClockThrottled();
    }
    await this.updateFrontend();
  }

  async handleSessionChange() {
    await this.updateFrontend();
    if (this.session && !this.session.temp) {
      this.session.editor.writeThrottled();
    }
  }

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
        this.setScreen(t.Screen.Player);
        if (params.load) {
          await params.session.prepare();
        }
        this.enrichSessions([params.session.head.id]).catch(console.error);
        await this.updateFrontend();
        break;
      }
      case t.Screen.Recorder: {
        if (params.session.temp || (await this.loadRecorder(params.session, { clock: params.clock }))) {
          if (params.session.temp) {
            this.recorder = { tabId: 'details-view' };
          } else {
            this.recorder = { tabId: 'editor-view' };
            this.enrichSessions([params.session.head.id]).catch(console.error);
          }

          this.setSession(params.session);
          this.setScreen(t.Screen.Recorder);
          await this.updateFrontend();
        }
        break;
      }
      case t.Screen.Welcome: {
        const current = await this.getSessionListingOfDefaultVscWorkspace();
        const recent = await this.getRecentSessionListings(4);
        this.welcome = {
          sessions: _.compact([current, ...recent]),
          loadingFeatured: true,
        };

        // Update caches.
        await this.updateCachesOfLocalSessionListings(this.welcome.sessions);

        // Do not block the welcome screen while enriching current and recent sessions.
        this.enrichSessions(this.welcome.sessions.map(s => s.head.id)).catch(console.error);

        // Do not block the welcome screen while fetching featured sessions.
        this.updateFeaturedSessionListings().catch(console.error);

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
        await this.session?.rr?.dispose();
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

        await this.stopRecorderWriteAndCleanUp();
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

  async stopRecorderWriteAndCleanUp() {
    assert(this.session);
    await this.session.rr?.dispose();
    this.session.editor.finishEditing();
    if (!this.session.temp) {
      await this.session.editor.write({ ifDirty: true });
      await this.session.core.gcBlobs();
    }
  }

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

    // import anonymous user's activities.
    if (!this.context.user && !_.isEmpty(this.context.settings.history)) {
      settings.history = { ...this.context.settings.history, ...settings.history };
      await storage.writeJSON(userSettingsPath, settings);
    }

    this.session = undefined;
    this.context.user = user;
    this.context.userDataPath = userDataPath;
    this.context.userSettingsPath = userSettingsPath;
    this.context.settings = settings;
    this.context.extension.globalState.update('user', user);
    this.context.extension.globalState.update('earlyAccessEmail', undefined);

    await this.openScreen({ screen: t.Screen.Welcome });
  }

  /**
   * Throttled to 60 FPS.
   */
  updateFrontend = lib.throttleTrailingAsync(async () => {
    if (this.context.webviewProvider.isReady) {
      await this.context.webviewProvider.postMessage({ type: 'updateStore', store: this.getStore() });
    }
  }, 1000 / 60);

  showError(error: Error) {
    vscode.window.showErrorMessage(error.message);
  }

  async getSessionListingOfDefaultVscWorkspace(): Promise<t.SessionListing | undefined> {
    try {
      const workspace = VscWorkspace.getDefaultVscWorkspace();
      if (workspace && (await Session.Core.sessionExists(workspace))) {
        const head = await Session.Core.readLocalHead(workspace);
        return head && { head, workspace, group: 'current', local: true };
      }
    } catch (error) {
      console.error(error);
    }
  }

  async getRecentSessionListings(limit: number): Promise<t.SessionListing[]> {
    function getTimestamp(history: t.SessionHistory) {
      return (history && lib.getSessionHistoryItemLastOpenTimestamp(history)) || '';
    }
    const orderedHistory = _.orderBy(Object.values(this.context.settings.history), getTimestamp, 'desc');

    const recent: t.SessionListing[] = [];
    for (const history of orderedHistory) {
      try {
        if (recent.length === limit) break;

        const head = await Session.Core.readLocalHead(history.workspace);
        if (head?.id === history.id) {
          recent.push({ head, workspace: history.workspace, group: 'recent', local: true });
        }
      } catch (error) {
        console.error(error);
      }
    }

    return recent;
  }

  async updateFeaturedSessionListings() {
    try {
      const { heads, publications } = await serverApi.send({ type: 'sessions/featured' }, this.context.user?.token);

      // Update this.publications.
      for (const [id, publication] of Object.entries(publications)) this.publications.set(id, publication);

      // Insert into welcome sessions.
      if (this.welcome) {
        this.welcome.sessions = this.welcome.sessions.filter(s => s.group !== 'remote');
        this.welcome.sessions.push(
          ...heads.map(head => ({ head, group: 'remote', local: false }) satisfies t.SessionListing),
        );
      }
    } catch (error) {
      console.error(error);
      this.showError(error as Error);
    } finally {
      if (this.welcome) this.welcome.loadingFeatured = false;
      this.updateFrontend().catch(console.error);
    }
  }

  async refreshWelcomeScreen() {
    await this.openScreen({ screen: t.Screen.Welcome });
  }

  async updateCachesOfLocalSessionListings(listings: t.SessionListing[]) {
    for (const listing of listings) {
      if (listing.workspace) {
        await cache.copyCover(Session.Core.getDataPath(listing.workspace), listing.head.id);
      }
    }
  }

  async updateUserMetadata() {
    if (!this.context.user) return;
    const res = await serverApi.send({ type: 'user/metadata' }, this.context.user.token);
    this.userMetadata = res.metadata;
    await this.updateFrontend();
  }

  /**
   * Downloads publications.
   */
  async enrichSessions(sessionIds: string[]) {
    const res = await serverApi.send({ type: 'sessions/publications', sessionIds });
    for (const [id, publication] of Object.entries(res.publications)) this.publications.set(id, publication);

    await this.updateFrontend();
  }

  async likeSession(sessionId: string, value: boolean) {
    assert(this.context.user, 'Please login to like sessions.');

    // Optimistic update. Do not wait.
    this.userMetadata ??= createEmptyUserMetadata();
    if (value) {
      this.userMetadata.likes.push(sessionId);
    } else {
      this.userMetadata.likes = this.userMetadata.likes.filter(x => x !== sessionId);
    }
    serverApi
      .send({ type: 'session/like/post', sessionId, value }, this.context.user.token)
      .then(() => this.enrichSessions([sessionId]))
      .catch((error: Error) => this.showError(error));
  }

  async postComment(session: Session, text: string, clock?: number) {
    assert(this.context.user, 'Please login to post comments.');
    await serverApi.send(
      { type: 'session/comment/post', sessionId: session.head.id, text, clock },
      this.context.user.token,
    );
    await this.enrichSessions([session.head.id]);
  }

  async reportIssue() {
    const url = vscode.Uri.parse('https://github.com/computing-den/CodeMic/issues');
    await vscode.env.openExternal(url);
  }

  getStore(): t.Store {
    let session: t.SessionUIState | undefined;
    if (this.session) {
      session = {
        local: this.session.local,
        temp: this.session.temp,
        mustScan: this.session.mustScan,
        loaded: this.session.isLoaded(),
        playing: this.session.rr?.playing ?? false,
        recording: this.session.rr?.recording ?? false,
        head: this.session.head,
        clock: this.session.rr?.clock ?? 0,
        playbackRate: this.session.rr?.playbackRate ?? 1,
        workspace: this.session.workspace,
        dataPath: this.session.core.dataPath,
        workspaceFocusTimeline: this.session.body?.focusTimeline,
        audioTracks: this.session.body?.audioTracks,
        videoTracks: this.session.body?.videoTracks,
        imageTracks: this.session.body?.imageTracks,
        history: this.context.settings.history[this.session.head.id],
        publication: this.publications.get(this.session.head.id),
      };
    }

    let welcome: t.WelcomeUIState | undefined;
    if (this.screen === t.Screen.Welcome) {
      assert(this.welcome);
      let sessions: t.SessionUIListing[] = this.welcome.sessions.map(s => ({
        ...s,
        history: this.context.settings.history[s.head.id],
        publication: this.publications.get(s.head.id),
      }));
      sessions = lib.searchSessions(sessions, this.searchQuery);
      welcome = {
        searchQuery: this.searchQuery,
        sessions,
        loadingFeatured: this.welcome.loadingFeatured,
        error: this.welcome.error,
      };
    }

    let recorder: t.RecorderUIState | undefined;
    if (this.recorder) {
      assert(this.session);
      recorder = {
        ...this.recorder,
        canUndo: this.session.editor.canUndo,
        canRedo: this.session.editor.canRedo,
        selection: this.session.editor.selection,
      };
    }

    return {
      earlyAccessEmail: this.context.earlyAccessEmail,
      screen: this.screen,
      user: this.context.user && { ...this.context.user, metadata: this.userMetadata },
      account: this.account,
      welcome,
      recorder,
      player: {},
      session,
      cache: {
        avatarsPath: cache.avatarsPath,
        coversPath: cache.coversPath,
        version: cache.version,
      },
      dev: {},
    };
  }
}

function createEmptyUserMetadata(): t.UserMetadata {
  return {
    likes: [],
  };
}

const SCREEN_TITLES = {
  [t.Screen.Account]: 'account',
  [t.Screen.Welcome]: '',
  [t.Screen.Player]: 'player',
  [t.Screen.Recorder]: 'studio',
  [t.Screen.Loading]: 'loading',
};

export default CodeMic;
