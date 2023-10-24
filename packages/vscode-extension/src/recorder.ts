import {
  types as t,
  path,
  lib,
  editorTrack as et,
  AudioTrackPlayer,
  SessionTrackPlayer,
  SwitchTrackPlayer,
} from '@codecast/lib';
import VscEditorWorkspace from './vsc_editor_workspace.js';
import VscEditorTrackPlayer from './vsc_editor_track_player.js';
import VscEditorTrackRecorder from './vsc_editor_track_recorder.js';
import { SessionIO } from './session.js';
import * as misc from './misc.js';
import Db, { type WriteOptions } from './db.js';
import * as vscode from 'vscode';
import fs from 'fs';
import _ from 'lodash';
import assert from 'assert';
import { v4 as uuid } from 'uuid';

const PLAYER_TRACK_INDEX = 0;
const RECORDER_TRACK_INDEX = 1;

class Recorder {
  get trackPlayerSummary(): t.TrackPlayerSummary {
    return lib.getTrackPlayerSummary(this.sessionTrackPlayer);
  }

  get DEV_trackPlayerSummaries(): t.TrackPlayerSummary[] {
    return this.sessionTrackPlayer.DEV_trackPlayerSummaries;
  }

  get recorderTrackPlayer(): VscEditorTrackRecorder {
    return this.switchTrackPlayer.trackPlayers[RECORDER_TRACK_INDEX] as VscEditorTrackRecorder;
  }

  get playerTrackPlayer(): VscEditorTrackPlayer {
    return this.switchTrackPlayer.trackPlayers[PLAYER_TRACK_INDEX] as VscEditorTrackPlayer;
  }

  get root(): t.AbsPath {
    return this.recorderTrackPlayer.workspace.root;
  }

  get track(): et.EditorTrack {
    return this.recorderTrackPlayer.track;
  }

  get clock(): number {
    return this.sessionTrackPlayer.clock;
  }

  get isInRecorderMode(): boolean {
    return this.switchTrackPlayer.curIndex === RECORDER_TRACK_INDEX;
  }

  isDirty: boolean = false;

  // private lastSavedClock: number;

  constructor(
    public context: vscode.ExtensionContext,
    public db: Db,
    public sessionSummary: t.SessionSummary,
    private sessionTrackPlayer: SessionTrackPlayer,
    private switchTrackPlayer: SwitchTrackPlayer,
    private audioTrackPlayers: { [key: string]: AudioTrackPlayer },
    private postAudioMessage: t.PostAudioMessageToFrontend,
    private getSessionBlobWebviewUri: (sha1: string) => t.Uri,
    private onChange: () => any,
  ) {
    sessionTrackPlayer.onChange = this.changeHandler.bind(this);
    // this.lastSavedClock = sessionTrackPlayer.clock;
  }

  /**
   * root must be already resolved.
   */
  static async fromDirAndVsc(
    context: vscode.ExtensionContext,
    db: Db,
    setup: t.RecorderSetup,
    postAudioMessage: t.PostAudioMessageToFrontend,
    getSessionBlobWebviewUri: (sha1: string) => t.Uri,
    onChange: () => any,
  ): Promise<Recorder> {
    assert(setup.root);
    const sessionIO = new SessionIO(db, setup.sessionSummary.id);
    const workspace = await VscEditorWorkspace.fromDirAndVsc(sessionIO, setup.root);
    const vscEditorTrackPlayer = new VscEditorTrackPlayer(context, workspace);
    const vscEditorTrackRecorder = new VscEditorTrackRecorder(context, workspace);
    const switchTrackPlayer = new SwitchTrackPlayer([vscEditorTrackPlayer, vscEditorTrackRecorder], PLAYER_TRACK_INDEX);
    const sessionTrackPlayer = new SessionTrackPlayer();

    sessionTrackPlayer.addTrack(switchTrackPlayer);
    sessionTrackPlayer.load();

    const recorder = new Recorder(
      context,
      db,
      setup.sessionSummary,
      sessionTrackPlayer,
      switchTrackPlayer,
      {},
      postAudioMessage,
      getSessionBlobWebviewUri,
      onChange,
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
    setup: t.RecorderSetup,
    postAudioMessage: t.PostAudioMessageToFrontend,
    getSessionBlobWebviewUri: (sha1: string) => t.Uri,
    onChange: () => any,
  ): Promise<Recorder | undefined> {
    assert(setup.root);

    let clock = setup.sessionSummary.duration;
    if (setup.fork) {
      assert(setup.baseSessionSummary);
      assert(setup.forkClock);
      await db.copySessionDir(setup.baseSessionSummary, setup.sessionSummary);
      clock = setup.forkClock;
    }

    const sessionIO = new SessionIO(db, setup.sessionSummary.id);
    const session = await db.readSession(setup.sessionSummary.id);
    const workspace = await VscEditorWorkspace.populateEditorTrack(setup.root, session, sessionIO, clock, clock);
    if (workspace) {
      // TODO cut all tracks or remove them completely if out of range.

      const sessionTrackPlayer = new SessionTrackPlayer();
      const vscEditorTrackPlayer = new VscEditorTrackPlayer(context, workspace);
      const vscEditorTrackRecorder = new VscEditorTrackRecorder(context, workspace);
      const switchTrackPlayer = new SwitchTrackPlayer(
        [vscEditorTrackPlayer, vscEditorTrackRecorder],
        PLAYER_TRACK_INDEX,
      );
      const audioTrackPlayers: { [key: string]: AudioTrackPlayer } = {};
      for (const audioTrack of session.audioTracks) {
        const p = new AudioTrackPlayer(audioTrack, postAudioMessage, getSessionBlobWebviewUri, sessionIO);
        audioTrackPlayers[audioTrack.id] = p;
        sessionTrackPlayer.addTrack(p);
      }
      sessionTrackPlayer.addTrack(switchTrackPlayer);
      sessionTrackPlayer.load();
      sessionTrackPlayer.seek(clock);

      const recorder = new Recorder(
        context,
        db,
        setup.sessionSummary,
        sessionTrackPlayer,
        switchTrackPlayer,
        audioTrackPlayers,
        postAudioMessage,
        getSessionBlobWebviewUri,
        onChange,
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

  async changeHandler() {
    if (this.isInRecorderMode) {
      this.isDirty = true;
      this.sessionSummary.duration = this.sessionTrackPlayer.track.clockRange.end;
    }
    // update frontend
    this.onChange();
  }

  record() {
    this.switchTrackPlayer.switch(RECORDER_TRACK_INDEX);
    this.sessionTrackPlayer.start();
    this.saveHistoryOpenClose().catch(console.error);
  }

  play() {
    this.switchTrackPlayer.switch(PLAYER_TRACK_INDEX);
    this.sessionTrackPlayer.start();
    this.saveHistoryOpenClose().catch(console.error);
  }

  pause() {
    this.sessionTrackPlayer.pause();
  }

  stop() {
    this.sessionTrackPlayer.stop();
  }

  seek(clock: number) {
    this.sessionTrackPlayer.seek(clock);
  }

  dispose() {
    this.sessionTrackPlayer.dispose();
  }

  isSessionEmpty(): boolean {
    return this.track.events.length === 0 && Object.values(this.audioTrackPlayers).length === 0;
  }

  handleFrontendAudioEvent(e: t.FrontendAudioEvent) {
    const p = this.audioTrackPlayers[e.id];
    if (p) {
      p.handleAudioEvent(e);
    } else {
      console.error(`handleFrontendAudioEvent audio track player with id ${e.id} not found`);
    }
  }

  updateState(changes: t.RecorderUpdate) {
    if (changes.title !== undefined) this.sessionSummary.title = changes.title;
    if (changes.description !== undefined) this.sessionSummary.description = changes.description;
    // if (changes.clock !== undefined) this.sessionSummary.duration = this.sessionTrackPlayer.clock = changes.clock;
    if (changes.root !== undefined) throw new Error('Recorder.updateState cannot change root after initialization');

    this.isDirty = true;
  }

  /**
   * May be called without pause() or stop().
   */
  async save() {
    this.sessionSummary.timestamp = new Date().toISOString();
    const session: t.Session = {
      editorTrack: this.track.toJSON(),
      audioTracks: Object.values(this.audioTrackPlayers).map(p => p.track),
    };
    await this.db.writeSession(session, this.sessionSummary);
    await this.saveHistoryOpenClose();
    // this.lastSavedClock = this.clock;
    this.isDirty = false;
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
