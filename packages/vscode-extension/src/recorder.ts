import { types as t, path, lib, editorTrack as et, SessionCtrl, AudioCtrl } from '@codecast/lib';
import VscEditorWorkspace from './vsc_editor_workspace.js';
import VscEditorPlayer from './vsc_editor_player.js';
import VscEditorRecorder from './vsc_editor_recorder.js';
import getMp3Duration from './get_mp3_duration.js';
import { SessionIO } from './session.js';
import * as misc from './misc.js';
import Db from './db.js';
import * as vscode from 'vscode';
import _ from 'lodash';
import assert from 'assert';
import fs from 'fs';
import { v4 as uuid } from 'uuid';
import VscWorkspace from './vsc_workspace.js';

class Recorder {
  get root(): t.AbsPath {
    return this.workspace.root;
  }

  get clock(): number {
    return this.sessionCtrl.clock;
  }

  get isRecording(): boolean {
    return this.sessionCtrl.isRunning && this.sessionCtrl.mode.recordingEditor;
  }

  get isPlaying(): boolean {
    return this.sessionCtrl.isRunning && !this.sessionCtrl.mode.recordingEditor;
  }

  isDirty: boolean = false;

  // private lastSavedClock: number;

  constructor(
    public context: vscode.ExtensionContext,
    public db: Db,
    public sessionSummary: t.SessionSummary,
    public workspace: VscEditorWorkspace,
    private sessionCtrl: SessionCtrl,
    private postAudioMessage: t.PostAudioMessageToFrontend,
    private getSessionBlobWebviewUri: (sha1: string) => t.Uri,
    private onUpdateFrontend: () => any,
  ) {
    sessionCtrl.onUpdateFrontend = this.sessionCtrlUpdateFrontendHandler.bind(this);
    sessionCtrl.onChange = this.sessionCtrlChangeHandler.bind(this);
    sessionCtrl.onError = this.sessionCtrlErrorHandler.bind(this);
    // this.lastSavedClock = sessionCtrl.clock;
  }

  /**
   * root must be already resolved.
   */
  static async fromDirAndVsc(
    context: vscode.ExtensionContext,
    db: Db,
    setup: t.Setup,
    postAudioMessage: t.PostAudioMessageToFrontend,
    getSessionBlobWebviewUri: (sha1: string) => t.Uri,
    onUpdateFrontend: () => any,
  ): Promise<Recorder> {
    assert(setup.root);
    const sessionIO = new SessionIO(db, setup.sessionSummary.id);
    const workspace = await VscEditorWorkspace.fromDirAndVsc(sessionIO, setup.root);
    const vscEditorPlayer = new VscEditorPlayer(context, workspace);
    const vscEditorRecorder = new VscEditorRecorder(context, workspace);
    const audioCtrls: AudioCtrl[] = [];

    const sessionCtrl = new SessionCtrl(setup.sessionSummary, audioCtrls, vscEditorPlayer, vscEditorRecorder);
    sessionCtrl.load();

    const recorder = new Recorder(
      context,
      db,
      setup.sessionSummary,
      workspace,
      sessionCtrl,
      postAudioMessage,
      getSessionBlobWebviewUri,
      onUpdateFrontend,
    );

    await recorder.save();
    return recorder;
  }

  /**
   * root must be already resolved.
   */
  static async populateSession(
    context: vscode.ExtensionContext,
    db: Db,
    setup: t.Setup,
    postAudioMessage: t.PostAudioMessageToFrontend,
    getSessionBlobWebviewUri: (sha1: string) => t.Uri,
    onUpdateFrontend: () => any,
  ): Promise<Recorder | undefined> {
    assert(setup.root);

    let clock = setup.sessionSummary.duration;
    if (setup.fork) {
      assert(setup.baseSessionSummary);
      assert(setup.forkClock !== undefined);
      await db.copySessionDir(setup.baseSessionSummary, setup.sessionSummary);
      clock = setup.forkClock;
    }

    const sessionIO = new SessionIO(db, setup.sessionSummary.id);
    const session = await db.readSession(setup.sessionSummary.id);
    const workspace = await VscEditorWorkspace.populateEditorTrack(setup.root, session, sessionIO, clock, clock);
    if (workspace) {
      // TODO cut all tracks or remove them completely if out of range.

      const vscEditorPlayer = new VscEditorPlayer(context, workspace);
      const vscEditorRecorder = new VscEditorRecorder(context, workspace);
      const audioCtrls = session.audioTracks.map(
        audioTrack => new AudioCtrl(audioTrack, postAudioMessage, getSessionBlobWebviewUri, sessionIO),
      );

      const sessionCtrl = new SessionCtrl(setup.sessionSummary, audioCtrls, vscEditorPlayer, vscEditorRecorder);
      sessionCtrl.load();
      sessionCtrl.seek(clock);

      const recorder = new Recorder(
        context,
        db,
        setup.sessionSummary,
        workspace,
        sessionCtrl,
        postAudioMessage,
        getSessionBlobWebviewUri,
        onUpdateFrontend,
      );

      await recorder.save();
      return recorder;
    }
  }

  /**
   * Always returns a new object; no shared state with base
   */
  static makeSessionSummary(base?: t.SessionSummary, fork?: boolean, forkClock?: number): t.SessionSummary {
    if (base) {
      return {
        ..._.cloneDeep(base),
        id: fork ? uuid() : base.id,
        title: fork ? `Fork: ${base.title}` : base.title,
        duration: forkClock ?? base.duration,
        author: {
          name: 'sean_shir',
          avatar: 'avatar1.png',
        },
        timestamp: new Date().toISOString(), // will be overwritten at the end
        forkedFrom: fork ? base.id : undefined,
      };
    } else {
      return {
        id: uuid(),
        title: '',
        description: '',
        author: {
          name: 'sean_shir',
          avatar: 'avatar1.png',
        },
        published: false,
        duration: 0,
        views: 0,
        likes: 0,
        timestamp: new Date().toISOString(), // will be overwritten at the end
        toc: [],
      };
    }
  }

  sessionCtrlUpdateFrontendHandler() {
    this.onUpdateFrontend();
  }

  sessionCtrlChangeHandler() {
    this.isDirty = true;
  }

  sessionCtrlErrorHandler(error: Error) {
    // TODO show error to user
    console.error(error);
  }

  record() {
    this.sessionCtrl.record();
    this.saveHistoryOpenClose().catch(console.error);
  }

  play() {
    this.sessionCtrl.play();
    this.saveHistoryOpenClose().catch(console.error);
  }

  pause() {
    this.sessionCtrl.pause();
  }

  seek(clock: number) {
    this.sessionCtrl.seek(clock);
  }

  dispose() {
    // this.sessionCtrl.dispose();
  }

  isSessionEmpty(): boolean {
    return this.workspace.editorTrack.events.length === 0 && this.sessionCtrl.audioCtrls.length === 0;
  }

  handleFrontendAudioEvent(e: t.FrontendAudioEvent) {
    this.sessionCtrl.handleFrontendAudioEvent(e);
  }

  updateState(changes: t.RecorderUpdate) {
    if (changes.title !== undefined) this.sessionSummary.title = changes.title;
    if (changes.description !== undefined) this.sessionSummary.description = changes.description;
    // if (changes.clock !== undefined) this.sessionSummary.duration = this.sessionCtrl.clock = changes.clock;
    if (changes.root !== undefined) throw new Error('Recorder.updateState cannot change root after initialization');

    this.isDirty = true;
  }

  /**
   * May be called without pause().
   */
  async save() {
    this.sessionSummary.timestamp = new Date().toISOString();
    const session: t.Session = {
      editorTrack: this.workspace.editorTrack.toJSON(),
      audioTracks: this.sessionCtrl.audioCtrls.map(p => p.track),
    };
    await this.db.writeSession(session, this.sessionSummary);
    await this.saveHistoryOpenClose();
    // this.lastSavedClock = this.clock;
    this.isDirty = false;
  }

  async insertAudio(uri: t.Uri, clock: number) {
    const absPath = path.getFileUriPath(uri);
    const data = await fs.promises.readFile(absPath);
    const duration = getMp3Duration(data);
    const sha1 = await misc.computeSHA1(data);
    await this.workspace.io.copyLocalFile(absPath, sha1);
    const audioTrack: t.AudioTrack = {
      id: uuid(),
      clockRange: { start: clock, end: clock + duration },
      file: { type: 'local', sha1: sha1 },
      title: path.basename(absPath, { omitExt: true }),
    };
    this.sessionCtrl.insertAudioAndLoad(
      new AudioCtrl(audioTrack, this.postAudioMessage, this.getSessionBlobWebviewUri, this.workspace.io),
    );
  }

  private async saveHistoryOpenClose() {
    this.db.mergeSessionHistory({
      id: this.sessionSummary.id,
      lastRecordedTimestamp: new Date().toISOString(),
      root: this.root,
    });
    await this.db.write();
  }
}

export default Recorder;
