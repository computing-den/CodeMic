import { types as t } from '@codecast/lib';
import Db from './db.js';

export class SessionIO implements t.SessionIO {
  constructor(public db: Db, public sessionId: string) {}

  async readFile(file: t.File): Promise<Uint8Array> {
    if (file.type === 'local') {
      return this.db.readSessionBlobBySha1(this.sessionId, file.sha1);
    } else {
      throw new Error(`TODO readFile ${file.type}`);
    }
  }
}
