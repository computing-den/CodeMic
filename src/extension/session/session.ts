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
  inStorage: boolean;
  mustScan: boolean;
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
    opts?: { inStorage?: boolean; mustScan?: boolean },
  ) {
    this.context = context;
    this.workspace = workspace;
    this.head = head;
    this.inStorage = Boolean(opts?.inStorage);
    this.mustScan = Boolean(opts?.mustScan);
    this.core = new SessionCore(this);
    this.editor = new SessionEditor(this as LoadedSession);
  }

  isLoaded(): this is LoadedSession {
    return Boolean(this.body);
  }

  async prepare(options?: { seekClock?: number; cutClock?: number }) {
    if (this.mustScan) {
      await this.scan();
    } else {
      await this.load(options);
    }
  }

  private async load(options?: { seekClock?: number; cutClock?: number }) {
    assert(!this.isLoaded(), 'Already loaded.');
    assert(!this.mustScan, 'Must be scanned, not loaded.');

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
