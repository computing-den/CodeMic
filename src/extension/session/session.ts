import * as t from '../../lib/types.js';
import assert from '../../lib/assert.js';
import type { Context } from '../types.js';
import SessionCore from './session_core.js';
import SessionBody from './session_body.js';
import SessionRecordAndReplay from './session_record_and_replay.js';
import SessionEditor from './session_editor.js';
import SessionCommander from './session_commander.js';
import _ from 'lodash';
import { scaleProgress } from '../misc.js';

export type LoadedSession = Session & {
  body: SessionBody;
  rr: SessionRecordAndReplay;
  commander: SessionCommander;
};

export class Session {
  static Core = SessionCore;

  context: Context;
  workspace: string;
  local: boolean;
  mustScan: boolean;
  // temp means that it's a new session and user is still editing workspace and therefore session
  // doesn't have a final data path yet.
  // core.commitTemp() will finalize its data path, write it to disk and set temp to false. This is done
  // before possible vscode restart due to change of workspace.
  temp: boolean;
  head: t.SessionHead;
  core: SessionCore;
  editor: SessionEditor;
  body?: SessionBody;
  rr?: SessionRecordAndReplay;
  commander?: SessionCommander;

  onChange?: () => any;
  onProgress?: () => any;
  onError?: (error: Error) => any;

  constructor(
    context: Context,
    workspace: string,
    head: t.SessionHead,
    opts?: { local?: boolean; mustScan?: boolean; temp?: boolean },
  ) {
    this.context = context;
    this.workspace = workspace;
    this.head = head;
    this.local = Boolean(opts?.local);
    this.mustScan = Boolean(opts?.mustScan);
    this.temp = Boolean(opts?.temp);
    this.core = new SessionCore(this);
    this.editor = new SessionEditor(this as LoadedSession);
  }

  isLoaded(): this is LoadedSession {
    return Boolean(this.body);
  }

  async prepare(options?: { clock?: number }) {
    if (this.mustScan) {
      await this.scan();
    } else {
      await this.load(options);
    }
  }

  async download(options?: { skipIfExists?: boolean }) {
    if (options?.skipIfExists && (await this.core.bodyExists())) return;

    await this.context.withProgress(
      { title: `Downloading session ${this.head.handle}`, cancellable: true },
      async (progress, abortController) => {
        await this.core.download({ ...options, progress, abortController });
      },
    );
  }

  private async load(options?: { clock?: number }) {
    // Session may already be loaded if we hit edit inside the player.
    // This causes the video DOM in player screen to be replaced with
    // another video DOM in recorder screen. Same for the audio context.
    // That's why we must reload the media track players.
    if (this.isLoaded()) {
      this.rr.reloadMedia();
      return;
    }

    // assert(!this.isLoaded(), 'Already loaded.');
    assert(!this.mustScan, 'Must be scanned, not loaded.');
    assert(!this.temp, 'Cannot load a temp session.');

    await this.context.withProgress(
      { title: `Loading session ${this.head.handle}`, cancellable: true },
      async (progress, abortController) => {
        const bodyJSON = await this.core.readBody({
          download: true,
          progress: scaleProgress(progress, 0.8),
          abortController,
        });

        progress.report({ message: 'reading' });
        this.body = new SessionBody(bodyJSON);
        this.rr = new SessionRecordAndReplay(this as LoadedSession);
        this.commander = new SessionCommander(this as LoadedSession);

        progress.report({ message: 'loading', increment: 10 });
        await this.rr.loadWorkspace(options);

        progress.report({ message: 'done', increment: 10 });
      },
    );
  }

  private async scan() {
    assert(!this.isLoaded(), 'Already loaded.');
    assert(this.mustScan, 'Must be loaded, not scanned.');

    await this.context.withProgress(
      { title: `Scanning session ${this.head.handle}`, cancellable: false },
      async (progress, abortController) => {
        this.body = new SessionBody();
        this.rr = new SessionRecordAndReplay(this as LoadedSession);
        this.commander = new SessionCommander(this as LoadedSession);
        await this.rr.scan();
      },
    );
  }
}

export default Session;
