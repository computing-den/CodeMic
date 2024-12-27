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

  async updateCoverPhoto(head: t.SessionHead) {
    try {
      const p = this.getCoverPhotoPath(head.id);
      if (await storage.pathExists(p)) {
        if (!head.coverPhotoHash) {
          await fs.promises.rm(p, { force: true });
          this.changed();
          return;
        }

        const buffer = await fs.promises.readFile(p);
        const hash = await misc.computeSHA1(buffer);
        if (hash === head.coverPhotoHash) return;
      }

      if (head.coverPhotoHash) {
        await serverApi.downloadSessionCoverPhoto(head.id, p);
        this.changed();
      }
    } catch (error) {
      console.error(`Error downloading cover photo of sesstion ${head.id}`, error);
    }
  }

  async updateCoverPhotoFromLocal(id: string, sessionDataPath: string) {
    const src = path.join(sessionDataPath, 'cover_photo');
    if (await storage.pathExists(src)) {
      const dst = this.getCoverPhotoPath(id);
      await storage.ensureContainingDir(dst);
      await fs.promises.copyFile(src, dst);
      this.changed();
    }
  }

  async deleteCoverPhoto(id: string) {
    await fs.promises.rm(this.getCoverPhotoPath(id), { force: true });
    this.changed();
  }

  async updateAvatar(username: string) {
    try {
      const p = this.getAvatarPath(username);
      await serverApi.downloadAvatar(username, p);
      this.changed();
    } catch (error) {
      console.error(`Error downloading avatar of user ${username}`, error);
    }
  }

  get coverPhotosPath(): string {
    return path.join(osPaths.cache, 'cover_photos_cache');
  }

  get avatarsPath(): string {
    return path.join(osPaths.cache, 'avatars_cache');
  }

  getCoverPhotoPath(id: string): string {
    return path.join(this.coverPhotosPath, id);
  }

  getAvatarPath(username: string): string {
    return path.join(this.avatarsPath, username);
  }

  private changed() {
    this.version++;
    // this.onChange?.(this.version);
  }
}
