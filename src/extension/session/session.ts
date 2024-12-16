import * as t from '../../lib/types.js';
import assert from '../../lib/assert.js';
import type { Context } from '../types.js';
import SessionCore from './session_core.js';
import SessionBody from './session_body.js';
import SessionRecordAndReplay from './session_record_and_replay.js';
import SessionEditor from './session_editor.js';
import _ from 'lodash';

export type LoadedSession = Session & {
  body: SessionBody;
  rr: SessionRecordAndReplay;
};

export class Session {
  static Core = SessionCore;

  context: Context;
  workspace: t.AbsPath;
  local: boolean;
  mustScan: boolean;
  // temp means that it's a new session and user is still editing workspace and handle and therefore session
  // doesn't have a data path.
  // temp is set to false right before possible vscode restart due to change of workspace when scan is requested.
  temp: boolean;
  head: t.SessionHead;
  core: SessionCore;
  editor: SessionEditor;
  body?: SessionBody;
  rr?: SessionRecordAndReplay;

  onChange?: () => any;
  onProgress?: () => any;
  onError?: (error: Error) => any;

  constructor(
    context: Context,
    workspace: t.AbsPath,
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

  private async load(options?: { clock?: number }) {
    assert(!this.isLoaded(), 'Already loaded.');
    assert(!this.mustScan, 'Must be scanned, not loaded.');
    assert(!this.temp, 'Cannot load a temp session.');

    const bodyJSON = await this.core.readBody({ download: true });
    this.body = new SessionBody(bodyJSON);
    this.rr = new SessionRecordAndReplay(this as LoadedSession);
    await this.rr.load(options);
  }

  private async scan() {
    assert(!this.isLoaded(), 'Already loaded.');
    assert(this.mustScan, 'Must be loaded, not scanned.');

    this.body = new SessionBody();
    this.rr = new SessionRecordAndReplay(this as LoadedSession);
    await this.rr.scan();
  }
}

export default Session;
