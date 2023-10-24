import { types as t } from '@codecast/lib';
import Db from './db.js';

export class SessionIO implements t.SessionIO {
  constructor(public db: Db, public sessionId: string) {}

  async init() {
    // nothing
  }

  async readFile(file: t.File): Promise<Uint8Array> {
    if (file.type === 'local') {
      return this.db.readSessionBlobBySha1(this.sessionId, file.sha1);
    } else {
      throw new Error(`TODO readFile ${file.type}`);
    }
  }

  async copyLocalFile(src: t.AbsPath, sha1: string) {
    await this.db.copyAsSessionBlob(this.sessionId, src, sha1);
  }
}
