import * as storage from './storage.js';
import * as serverApi from './server_api.js';
import _ from 'lodash';
import osPaths from './os_paths.js';
import * as fs from 'fs';
import * as path from 'path';

export type CacheType = 'cover' | 'avatar';

export class Cache {
  version = 0;

  get coversPath(): string {
    return path.join(osPaths.cache, 'covers');
  }

  get avatarsPath(): string {
    return path.join(osPaths.cache, 'avatars');
  }

  getCoverPath(id: string): string {
    return path.join(this.coversPath, id);
  }

  getAvatarPath(username: string): string {
    return path.join(this.avatarsPath, username);
  }

  async writeCover(sessionId: string, buffer: NodeJS.ArrayBufferView) {
    await storage.writeBinary(this.getCoverPath(sessionId), buffer);
    this.changed();
  }

  async writeAvatar(username: string, buffer: NodeJS.ArrayBufferView) {
    await storage.writeBinary(this.getAvatarPath(username), buffer);
    this.changed();
  }

  async copyCover(srcSessionDataPath: string, dstSessionId: string) {
    const src = path.join(srcSessionDataPath, 'cover');
    if (await storage.pathExists(src)) {
      const dst = this.getCoverPath(dstSessionId);
      await storage.ensureContainingDir(dst);
      await fs.promises.copyFile(src, dst);
      this.changed();
    }
  }

  async deleteCover(id: string) {
    await fs.promises.rm(this.getCoverPath(id), { force: true });
    this.changed();
  }

  private changed() {
    this.version++;
  }
}

const cache = new Cache();

export default cache;
