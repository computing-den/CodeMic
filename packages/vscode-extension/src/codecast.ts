import Recorder from './recorder.js';
import Player from './player.js';
import VscWorkspace from './vsc_workspace.js';
import WebviewProvider from './webview_provider.js';
import Db from './db.js';
import * as serverApi from './server_api.js';
import * as vscode from 'vscode';
import _ from 'lodash';
import assert from 'assert';
import { types as t, lib } from '@codecast/lib';
import fs from 'fs';
import { SessionSummary } from '@codecast/lib/src/types.js';

class Codecast {
  screen: t.Screen = t.Screen.Welcome;
  user?: t.User;
  account?: t.AccountState;
  recorder?: Recorder;
  setup?: t.Setup;
  player?: Player;
  webview: WebviewProvider;
  featured?: SessionSummary[];
  test: any = 0;

  constructor(public context: vscode.ExtensionContext, public db: Db) {
    context.subscriptions.push(vscode.commands.registerCommand('codecast.openView', this.openView.bind(this)));
    context.subscriptions.push(
      vscode.commands.registerCommand('codecast.openWelcome', this.openWelcomeCommand.bind(this)),
    );
    context.subscriptions.push(vscode.commands.registerCommand('codecast.account', this.openAccountCommand.bind(this)));

    this.webview = new WebviewProvider(context, this.messageHandler.bind(this), this.viewOpened.bind(this));

    context.subscriptions.push(
      vscode.window.registerWebviewViewProvider(WebviewProvider.viewType, this.webview, {
        webviewOptions: { retainContextWhenHidden: true },
      }),
    );

    this.restoreStateAfterRestart().catch(console.error);

    // DEV
    // if (this.webview.bus) {
    //   this.messageHandler({ type: 'recorder/open', sessionId: 'ecc7e7e8-1f38-4a3a-91b1-774f1c91ba21' })
    //     .then(this.postUpdateStore)
    //     .catch(console.error);
    // }
  }

  static async fromContext(context: vscode.ExtensionContext): Promise<Codecast> {
    return new Codecast(context, await Db.init());
  }

  async restoreStateAfterRestart() {
    this.user = this.context.globalState.get<t.User>('user');

    const workspaceChange = VscWorkspace.getWorkspaceChangeGlobalState(this.context);
    VscWorkspace.setWorkspaceChangeGlobalState(this.context, undefined);

    console.log('restoreStateAfterRestart(): ', workspaceChange?.setup);
    if (workspaceChange) {
      const { setup, screen } = workspaceChange;
      assert(screen === t.Screen.Player || screen === t.Screen.Recorder);

      this.setup = setup;
      if (screen === t.Screen.Player) {
        this.player = await this.populatePlayer({ afterRestart: true });
      } else {
        this.recorder = await this.scanOrPopulateRecorder({ afterRestart: true });
      }

      this.setScreen(screen);
      if (this.webview.hasView()) {
        return this.postUpdateStore();
      }
    }
  }

  async viewOpened() {
    try {
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
          this.user = res.user;
          this.account.error = undefined;
          this.context.globalState.update('user', this.user);
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
          this.user = res.user;
          this.account.error = undefined;
          this.context.globalState.update('user', this.user);
          await this.openWelcome();
        } catch (error) {
          console.error(error);
          this.account.error = (error as Error).message;
        }

        return this.respondWithStore();
      }
      case 'account/logout': {
        this.user = undefined;
        this.context.globalState.update('user', undefined);
        await this.openWelcome();
        return this.respondWithStore();
      }
      case 'welcome/open': {
        await this.openWelcome();
        return this.respondWithStore();
      }
      case 'player/open': {
        if (await this.closeCurrentScreen()) {
          const sessionSummary = this.db.sessionSummaries[req.sessionId];
          assert(sessionSummary);
          const history = this.db.settings.history[sessionSummary.id];
          this.setup = {
            sessionSummary,
            root: history?.root,
            // set history in getStore() so that it's always up-to-date
          };
          this.setScreen(t.Screen.Player);
        }
        return this.respondWithStore();
      }
      case 'player/load': {
        assert(!this.player);
        this.player = await this.populatePlayer();
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
      case 'player/update': {
        if (this.player) {
          this.player.updateState(req.changes);
        } else {
          if (req.changes.root !== undefined) this.setup!.root = req.changes.root;
          // if (req.changes.clock !== undefined) throw new Error('TODO seek before player instantiation');
        }
        return this.respondWithStore();
      }
      case 'recorder/open': {
        if (await this.closeCurrentScreen()) {
          const baseSessionSummary = req.sessionId ? this.db.sessionSummaries[req.sessionId] : undefined;
          const sessionSummary = Recorder.makeSessionSummary(
            this.user && lib.userToUserSummary(this.user),
            baseSessionSummary,
            req.fork,
          );
          const history = this.getFirstHistoryItemById(sessionSummary.id, baseSessionSummary?.id);
          this.setup = {
            sessionSummary,
            baseSessionSummary,
            fork: req.fork,
            root: history?.root || VscWorkspace.getDefaultRoot(),
            isNew: !baseSessionSummary,
            isDirty: false,
            // set history in getStore() so that it's always up-to-date
          };
          this.setScreen(t.Screen.Recorder);
        }

        return this.respondWithStore();
      }
      case 'recorder/load': {
        assert(!this.recorder);
        for (const vscTextDocument of vscode.workspace.textDocuments) {
          if (vscTextDocument.isDirty) {
            vscode.window.showErrorMessage(
              'There are unsaved files in the current workspace. Please save them first and then try again.',
            );
            return { type: 'error' };
          }
        }
        this.recorder = await this.scanOrPopulateRecorder();
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
          let sessionSummary: t.SessionSummary;
          if (await this.saveRecorder({ forExit: false, ask: true, verbose: false })) {
            if (this.recorder) {
              sessionSummary = this.recorder.sessionSummary;
            } else {
              sessionSummary = this.setup!.sessionSummary;
            }
            const packagePath = await this.db.packageSession(sessionSummary.id);
            const answer = await serverApi.publishSession(sessionSummary, packagePath, this.user?.token);

            if (answer?.id !== sessionSummary.id) {
              vscode.window.showErrorMessage('Publish received unrecognized answer from server.');
            } else {
              if (this.recorder) {
                this.recorder.sessionSummary = answer;
              } else {
                this.setup!.sessionSummary = answer;
              }

              await this.db.writeSessionSummary(answer);
              // Cannot call this.saveRecorder unless we set isDirty on this.recorder or this.setup first.
              // Also, we don't want any messages to be shown from saveRecorder.
              // await this.saveRecorder({ forExit: false, ask: false, verbose: false });

              vscode.window.showInformationMessage('Published session.');
            }
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
        if (this.recorder) {
          this.recorder.updateState(req.changes);
        } else {
          assert(this.setup);
          if (req.changes.title !== undefined) this.setup.sessionSummary.title = req.changes.title;
          if (req.changes.description !== undefined) this.setup.sessionSummary.description = req.changes.description;
          if (req.changes.root !== undefined) this.setup.root = req.changes.root;
          this.setup.isDirty = true;
        }
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
        const wasRunning = this.player?.isPlaying;
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
        const wasRunning = this.player?.isPlaying;
        if (!wasRunning) return { type: 'boolean', value: true };
        this.player!.pause();

        const confirmTitle = 'Edit';
        const answer = await vscode.window.showWarningMessage(
          `Do you want to stop playing and edit the current session?`,
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
      case 'audio': {
        if (this.player) {
          this.player.handleFrontendAudioEvent(req.event);
        } else if (this.recorder) {
          this.recorder.handleFrontendAudioEvent(req.event);
        } else {
          throw new Error('Got audio event from frontend but player and recorder are not initialized.');
        }
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
    // console.log('updateViewTitle: webview.view ' + (this.webview.view ? 'is set' : 'is NOT set'));
    if (this.webview.hasView()) {
      const username = this.user?.username;
      const title = username
        ? ` ${username} / ` + SCREEN_TITLES[this.screen]
        : SCREEN_TITLES[this.screen] + ` (not logged in) `;
      this.webview.view!.title = title;
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
    await this.postUpdateStore();
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
    await this.postUpdateStore();
  }

  async scanOrPopulateRecorder(options?: { afterRestart: boolean }): Promise<Recorder | undefined> {
    assert(this.setup);
    if (!(await VscWorkspace.setUpWorkspace(this.context, this.screen, this.setup, options))) return;

    if (this.setup.baseSessionSummary) {
      return Recorder.populateSession(
        this.context,
        this.db,
        this.user,
        this.setup,
        this.postAudioMessage.bind(this),
        this.recorderChanged.bind(this),
      );
    } else {
      return Recorder.fromDirAndVsc(
        this.context,
        this.db,
        this.setup,
        this.postAudioMessage.bind(this),
        this.recorderChanged.bind(this),
      );
    }
  }

  async populatePlayer(options?: { afterRestart: boolean }): Promise<Player | undefined> {
    assert(this.setup);
    if (!(await VscWorkspace.setUpWorkspace(this.context, this.screen, this.setup, options))) return;

    return Player.populateSession(
      this.context,
      this.db,
      this.user,
      this.setup,
      this.postAudioMessage.bind(this),
      this.playerChanged.bind(this),
    );
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
      this.setup = undefined;
      return true;
    }

    return false;
  }

  /**
   * Returns true if successfull and false if cancelled.
   * In verbose mode, it'll show a message even when there are no changes to save.
   */
  async saveRecorder(options: { forExit: boolean; ask: boolean; verbose: boolean }): Promise<boolean> {
    let cancelled = false;
    let shouldSave = false;
    let isDirty: boolean;

    if (this.recorder) {
      const wasPlaying = this.recorder.isPlaying;
      const wasRecording = this.recorder.isRecording;

      // Pause the frontend while we figure out if we should save the session.
      if (wasPlaying || wasRecording) {
        this.recorder.pause();
        this.postUpdateStore();
      }

      isDirty = this.recorder.isDirty;
      if (isDirty) {
        if (options.ask) {
          [shouldSave, cancelled] = await this.askToSaveSession(options);
        } else {
          shouldSave = true;
        }
      }

      // If we want to exit recorder, stop recording and intercepting editor events.
      // Otherwise, resume recording if we were initially recording.
      if (!cancelled) {
        this.recorder.pause();
      } else if (wasRecording) {
        this.recorder.record();
        await this.postUpdateStore();
      } else if (wasPlaying) {
        this.recorder.play();
        await this.postUpdateStore();
      }

      // Save
      if (shouldSave) {
        await this.recorder.save();
      }
    } else {
      assert(this.setup);
      isDirty = Boolean(this.setup.isDirty);
      if (isDirty) {
        if (options.ask) {
          [shouldSave, cancelled] = await this.askToSaveSession(options);
        } else {
          shouldSave = true;
        }
      }

      if (shouldSave) {
        await this.db.writeSessionSummary(this.setup.sessionSummary);
        this.setup.isDirty = false;
      }
    }

    if (!isDirty && options.verbose) {
      vscode.window.showInformationMessage('Nothing to save.');
    } else if (shouldSave) {
      vscode.window.showInformationMessage('Saved session.');
    }

    return !cancelled;
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
    this.setup = undefined;
    return true;
  }

  async playerChanged() {
    await this.postUpdateStore();
  }

  async recorderChanged() {
    await this.postUpdateStore();
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

  async postUpdateStore() {
    await this.webview.postMessage({ type: 'updateStore', store: this.getStore() });
  }

  getFirstHistoryItemById(...ids: (string | undefined)[]): t.SessionHistoryItem | undefined {
    return _.compact(ids)
      .map(id => this.db.settings.history[id])
      .find(Boolean);
  }

  async postAudioMessage<Req extends t.BackendAudioRequest>(req: Req): Promise<t.FrontendResponseFor<Req>> {
    return this.webview.postMessage(req);
  }

  getSessionBlobWebviewUri(sessionId: string, sha1: string): t.Uri {
    const fileUri = vscode.Uri.file(this.db.getSessionBlobPathBySha1(sessionId, sha1));
    const webviewUri = this.webview.asWebviewUri(fileUri);
    assert(webviewUri);
    return webviewUri.toString();
  }

  getWebviewUris(sessionId: string, session: t.Session): t.WebviewUris {
    return Object.fromEntries(
      session.audioTracks.map(audioTrack => {
        assert(audioTrack.file.type === 'local');
        const uri = this.getSessionBlobWebviewUri(sessionId, audioTrack.file.sha1);
        return [audioTrack.id, uri];
      }),
    );
  }

  getStore(): t.Store {
    let recorder: t.RecorderState | undefined;
    if (this.screen === t.Screen.Recorder) {
      if (this.recorder) {
        recorder = {
          isNew: false,
          isLoaded: true,
          isRecording: this.recorder.isRecording,
          isPlaying: this.recorder.isPlaying,
          sessionSummary: this.recorder.sessionSummary,
          clock: this.recorder.clock,
          root: this.recorder.root,
          history: this.db.settings.history[this.recorder.sessionSummary.id],
          audioTracks: this.recorder.session.audioTracks,
          webviewUris: this.getWebviewUris(this.recorder.sessionSummary.id, this.recorder.session),
        };
      } else if (this.setup) {
        recorder = {
          isNew: !this.setup.baseSessionSummary,
          isLoaded: false,
          isRecording: false,
          isPlaying: false,
          sessionSummary: this.setup.sessionSummary,
          clock: this.setup.fork?.clock ?? this.setup.baseSessionSummary?.duration ?? 0,
          root: this.setup.root,
          fork: this.setup.fork,
          history: this.getFirstHistoryItemById(this.setup.sessionSummary.id, this.setup.baseSessionSummary?.id),
          audioTracks: [],
          webviewUris: {},
        };
      }
    }

    let player: t.PlayerState | undefined;
    if (this.screen === t.Screen.Player) {
      if (this.player) {
        player = {
          isLoaded: true,
          isPlaying: this.player.isPlaying,
          sessionSummary: this.player.sessionSummary,
          clock: this.player.clock,
          root: this.player.root,
          history: this.db.settings.history[this.player.sessionSummary.id],
          audioTracks: this.player.session.audioTracks,
          webviewUris: this.getWebviewUris(this.player.sessionSummary.id, this.player.session),
        };
      } else if (this.setup) {
        player = {
          isLoaded: false,
          isPlaying: false,
          sessionSummary: this.setup.sessionSummary,
          clock: 0,
          root: this.setup.root,
          history: this.db.settings.history[this.setup.sessionSummary.id],
          audioTracks: [],
          webviewUris: {},
        };
      }
    }

    let welcome: t.WelcomeState | undefined;
    if (this.screen === t.Screen.Welcome) {
      welcome = {
        workspace: Object.values(this.db.sessionSummaries),
        featured: this.featured || [],
        history: this.db.settings.history,
      };
    }

    return {
      screen: this.screen,
      user: this.user,
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

// TODO delete this and fetch from internet
const FEATURED_SESSIONS: t.SessionSummaryMap = _.keyBy(
  [
    {
      id: 'fd4659dd-150a-408b-aac3-1bc815a83be9',
      title: 'DumDB part 2',
      description: 'A small DB easy to use',
      author: {
        username: 'sean_shirazi',
        avatar: 'avatar1.png',
        email: 'example@site.com',
        joinTimestamp: '2020-01-01T14:22:35.344Z',
      },
      published: false,
      defaultRoot: '/home/sean/workspace/dumdb' as t.AbsPath,
      duration: 78,
      views: 0,
      likes: 0,
      modificationTimestamp: '2023-07-08T14:22:35.344Z',
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
        username: 'sean_shirazi',
        avatar: 'avatar2.png',
        email: 'example@site.com',
        joinTimestamp: '2020-01-01T14:22:35.344Z',
      },
      published: false,
      defaultRoot: '/home/sean/workspace/dumdb' as t.AbsPath,
      duration: 4023,
      views: 0,
      likes: 0,
      modificationTimestamp: '2023-08-08T14:22:35.344Z',
      toc: [],
    },
    {
      id: '4167cb21-e47d-478c-a741-0e3f6c69079e',
      title: 'DumDB part 1',
      description: 'A small DB easy to use',
      author: {
        username: 'sean_shirazi',
        avatar: 'https://cdn-icons-png.flaticon.com/512/924/924915.png',
        email: 'example@site.com',
        joinTimestamp: '2020-01-01T14:22:35.344Z',
      },
      published: true,
      defaultRoot: '/home/sean/workspace/dumdb' as t.AbsPath,
      duration: 62,
      views: 123,
      likes: 11,
      publishTimestamp: '2023-02-06T14:22:35.344Z',
      modificationTimestamp: '2023-06-06T14:22:35.344Z',
      toc: [],
    },
    {
      id: 'fa97abc4-d71d-4ff3-aebf-e5aadf77b3f7',
      title: 'Some other project',
      description:
        'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.',
      author: {
        username: 'jane',
        avatar: 'avatar2.png',
        email: 'example@site.com',
        joinTimestamp: '2020-01-01T14:22:35.344Z',
      },
      published: true,
      defaultRoot: '/home/sean/workspace/dumdb' as t.AbsPath,
      duration: 662,
      views: 100,
      likes: 45,
      publishTimestamp: '2023-06-06T10:22:35.344Z',
      modificationTimestamp: '2023-08-06T10:22:35.344Z',
      toc: [],
    },
  ],
  'id',
);

export default Codecast;
