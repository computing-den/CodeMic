import type { Context, RecorderRestoreState, WorkspaceChangeGlobalState } from './types.js';
import * as storage from './storage.js';
import * as serverApi from './server_api.js';
import * as vscode from 'vscode';
import _ from 'lodash';
import assert from 'assert';
import * as t from '../lib/types.js';
import * as lib from '../lib/lib.js';
import * as misc from './misc.js';
import osPaths from './os_paths.js';
import * as fs from 'fs';
import * as path from 'path';
import Session from './session/session.js';

export default class Cache {
  version = 0;
  // onChange?: (version: number) => any;

  constructor() {}

  async updateCover(head: t.SessionHead) {
    try {
      if (head.hasCover) {
        await serverApi.downloadSessionCover(head.id, this.getCoverPath(head.id));
        this.changed();
      }
    } catch (error) {
      console.error(`Error downloading cover of sesstion ${head.id}`, error);
    }
  }

  async updateCoverFromLocal(id: string, sessionDataPath: string) {
    const src = path.join(sessionDataPath, 'cover');
    if (await storage.pathExists(src)) {
      const dst = this.getCoverPath(id);
      await storage.ensureContainingDir(dst);
      await fs.promises.copyFile(src, dst);
      this.changed();
    }
  }

  async deleteCover(id: string) {
    await fs.promises.rm(this.getCoverPath(id), { force: true });
    this.changed();
  }

  async updateAvatar(username: string) {
    try {
      await serverApi.downloadAvatar(username, this.getAvatarPath(username));
      this.changed();
    } catch (error) {
      console.error(`Error downloading avatar of user ${username}`, error);
    }
  }

  get coversPath(): string {
    return path.join(osPaths.cache, 'covers');
  }

  get avatarsPath(): string {
    return path.join(osPaths.cache, 'avatars_cache');
  }

  getCoverPath(id: string): string {
    return path.join(this.coversPath, id);
  }

  getAvatarPath(username: string): string {
    return path.join(this.avatarsPath, username);
  }

  private changed() {
    this.version++;
    // this.onChange?.(this.version);
  }
}
