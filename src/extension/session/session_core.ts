import { deserializeSessionBody, serializeSessionBodyJSON } from './serialization.js';
import config from '../config.js';
import * as lib from '../../lib/lib.js';
import * as t from '../../lib/types.js';
import assert from '../../lib/assert.js';
import * as paths from '../../lib/paths.js';
import * as serverApi from '../server_api.js';
import type { Context, Progress, ReadDirOptions } from '../types.js';
import * as storage from '../storage.js';
import osPaths from '../os_paths.js';
import Session from './session.js';
import fs from 'fs';
import _ from 'lodash';
import archiver from 'archiver';
import unzipper from 'unzipper';
import stream from 'stream';
import { v4 as uuid } from 'uuid';
import * as path from 'path';
import { URI } from 'vscode-uri';
import ignore from 'ignore';
import { scaleProgress } from '../misc.js';
import cache from '../cache.js';

const WRITE_HISTORY_CLOCK_TIMEOUT_MS = 3_000;

export default class SessionCore {
  constructor(public session: Session) {}

  static LATEST_FORMAT_VERSION = 1;

  static async readLocalHead(workspace: string): Promise<t.SessionHead | undefined> {
    return await storage.readJSONOptional<t.SessionHead>(path.join(SessionCore.getDataPath(workspace), 'head.json'));
  }

  static async readLocal(
    context: Context,
    workspace: string,
    opts?: { mustScan?: boolean },
  ): Promise<Session | undefined> {
    const head = await this.readLocalHead(workspace);
    return head && this.fromLocal(context, head, workspace, opts);
  }

  /**
   * Clones head.
   */
  static fromLocal(
    context: Context,
    head: t.SessionHead,
    workspace: string,
    opts?: { mustScan?: boolean; temp?: boolean },
  ): Session {
    head = structuredClone(head);
    return new Session(context, workspace, head, { ...opts, local: true });
  }

  /**
   * Clones head.
   */
  static fromRemote(context: Context, head: t.SessionHead): Session {
    head = structuredClone(head);
    assert(head.author, 'Session has no author');
    assert(head.handle, 'Session has no handle');
    const workspace = path.join(paths.getDefaultWorkspaceBasePath(osPaths.home), head.author, head.handle);
    return new Session(context, workspace, head);
  }

  /**
   * Clones head.
   */
  static fromListing(context: Context, listing: t.SessionListing): Session {
    if (listing.workspace) {
      return this.fromLocal(context, listing.head, listing.workspace);
    } else {
      return this.fromRemote(context, listing.head);
    }
  }

  static async sessionExists(workspace: string): Promise<boolean> {
    return storage.pathExists(SessionCore.getDataPath(workspace));
  }

  /**
   * Clones head.
   */
  static async fromNew(context: Context, workspace: string, head: t.SessionHead): Promise<Session> {
    const temp = path.join(context.userDataPath, 'new_session');
    await fs.promises.rm(temp, { recursive: true, force: true });
    await fs.promises.mkdir(temp, { recursive: true });
    return this.fromLocal(context, head, workspace, { mustScan: true, temp: true });
  }

  // static getWorkspace(context: Context, head: t.SessionHead): t.AbsPath {
  //   const history = context.settings.history[head.id];
  //   if (history) return history.workspace;
  //   assert(head.handle, 'Please select a handle');
  //   return path.abs(paths.getDefaultWorkspaceBasePath(os.homedir()), head.handle);
  // }

  static makeNewHead(author?: string): t.SessionHead {
    return {
      id: uuid(),
      handle: '',
      title: '',
      description: '',
      author,
      duration: 0,
      modificationTimestamp: new Date().toISOString(), // will be overwritten at the end
      toc: [],
      formatVersion: SessionCore.LATEST_FORMAT_VERSION,
      ignorePatterns: lib.defaultIgnorePatterns,
      hasCover: false,
    };
  }

  static getDataPath(workspace: string): string {
    return path.join(workspace, '.CodeMic');
  }

  // static async fromFork(
  //   context: Context,
  //   baseId: string,
  //   options?: { author?: t.UserSummary },
  // ): Promise<Session | undefined> {
  //   const base = await SessionCore.fromLocal(context, baseId);
  //   if (base) {
  //     const head = await base.core.fork(options);
  //     return SessionCore.fromLocal(context, head.id);
  //   }
  // }

  // async fork(options?: { author?: t.UserSummary }): Promise<t.SessionHead> {
  //   await this.download({ skipIfExists: true });
  //   const forkHead: t.SessionHead = {
  //     id: uuid(),
  //     title: `Fork: ${this.session.head.title}`,
  //     handle: `fork_${this.session.head.handle}`,
  //     description: this.session.head.description,
  //     author: options?.author ?? this.session.head.author,
  //     duration: this.session.head.duration,
  //     views: 0,
  //     likes: 0,
  //     publishTimestamp: undefined,
  //     modificationTimestamp: this.session.head.modificationTimestamp,
  //     toc: this.session.head.toc,
  //     forkedFrom: this.session.head.id,
  //     hasCover: this.session.head.hasCover,
  //   };

  //   // Copy the entire session data, then rewrite the head.
  //   const forkSessionDataPath = path.abs(this.session.context.userDataPath, 'sessions', forkHead.id);
  //   await fs.promises.cp(this.sessionDataPath, forkSessionDataPath, { recursive: true });
  //   await storage.writeJSON(path.abs(forkSessionDataPath, 'head.json'), forkHead);

  //   return forkHead;
  // }

  /**
   * Returns a sorted list of all files and directories in workspace. All returned paths are relative to workspace.
   */
  async readDirRecursively(
    options: ReadDirOptions,
    rel: string = '',
    res: [string, fs.Stats][] = [],
  ): Promise<[string, fs.Stats][]> {
    assert(this.session.workspace, 'No workspace path is set.');

    let filenames: string[] = [];
    try {
      filenames = (await fs.promises.readdir(path.join(this.session.workspace, rel))) as string[];
    } catch (error) {
      // It's ok if workspace doesn't exist. Then results are just empty.
      if ((error as NodeJS.ErrnoException).code === 'ENOENT' && !rel) {
        return res;
      }
      throw error;
    }

    filenames.sort();
    for (const childname of filenames) {
      const childRel = path.join(rel, childname);
      if (!this.shouldRecordRelPath(childRel)) continue;

      const childFull = path.join(this.session.workspace, childRel);
      const stat = await fs.promises.stat(childFull);

      if (stat.isDirectory()) {
        if (options.includeDirs) {
          res.push([childRel, stat]);
        }
        await this.readDirRecursively(options, childRel, res);
      }

      if (stat.isFile() && options.includeFiles) {
        res.push([childRel, stat]);
      }
    }
    return res;
  }

  get dataPath(): string {
    return this.session.temp ? this.tempDataPath : this.finalDataPath;
  }

  get tempDataPath(): string {
    return path.join(this.session.context.userDataPath, 'new_session');
  }

  get finalDataPath(): string {
    assert(this.session.workspace);
    return SessionCore.getDataPath(this.session.workspace);
  }

  resolveUri(uri: string): string {
    return lib.resolveWorkspaceUri(this.session.workspace, uri);
  }

  private getIgnoreInstance = _.memoize(ignorePatterns => ignore().add('.CodeMic').add(ignorePatterns));

  shouldRecordAbsPath(abs: string): boolean {
    return this.shouldRecordRelPath(path.relative(this.session.workspace, abs));
  }

  shouldRecordRelPath(rel: string): boolean {
    // Note: path.relative will return '' if abs is the same as workspace.
    return (
      !(rel === '' || rel === '..' || rel.startsWith('../') || rel.startsWith('..\\')) &&
      !this.getIgnoreInstance(this.session.head.ignorePatterns).ignores(rel)
    );
  }

  verifyAndNormalizeTemp() {
    assert(this.session.workspace, 'Please select a workspace for the session.');

    assert(path.isAbsolute(this.session.workspace), 'Please select an absolute path for workspace.');

    // Remove .. and trailing slashes.
    this.session.workspace = path.resolve(this.session.workspace);

    assert(this.session.head.handle, 'Please select a handle for the session.');
    assert(
      !/[^A-Za-z0-9_]/.test(this.session.head.handle),
      'Please select a valid handle of format A-Z a-z 0-9 _ (e.g. my_project).',
    );
  }

  /**
   * Move the session from temp to its final data path and set temp = false.
   * Call verifyAndNormalizeTemp() first.
   */
  async commitTemp() {
    if (await Session.Core.sessionExists(this.session.workspace)) {
      // Delete the old session.
      try {
        const old = await Session.Core.readLocal(this.session.context, this.session.workspace);
        if (old) await old.core.delete();
      } catch (error) {
        // If opening the session failed for any reason, force delete it.
        // This won't delete its history though.
        await fs.promises.rm(this.finalDataPath, { force: true, recursive: true });
        console.error(error);
      }
    }
    await this.write();
    await fs.promises.cp(this.tempDataPath, this.finalDataPath, { force: true, recursive: true });
    this.session.temp = false;
  }

  async write() {
    await this.writeHead();
    if (this.session.isLoaded()) await this.writeBody();

    this.session.editor.saved();

    if (config.debug) {
      console.log('XXX DEBUG Reading head again to make sure');
      try {
        await SessionCore.readLocal(this.session.context, this.session.workspace);
        console.log('XXX DEBUG head was written correctly');
      } catch (error) {
        debugger;
        console.error('XXX DEBUG head was not written correctly', error);
      }
    }
  }

  async writeHead() {
    await storage.writeJSON(path.join(this.dataPath, 'head.json'), this.session.head);
    this.session.local = true;
    console.log('Wrote session head');
  }

  async writeBody() {
    assert(this.session.isLoaded(), 'writeBody: body is not yet loaded.');
    await storage.writeJSON(
      path.join(this.dataPath, 'body.json'),
      serializeSessionBodyJSON(this.session.body.toJSON()),
    );
    this.session.local = true;
    console.log('Wrote session body');
  }

  async writeHistory(update?: Partial<t.SessionHistory>) {
    assert(!this.session.temp);
    const { id } = this.session.head;
    const { settings } = this.session.context;
    settings.history[id] ??= { id, handle: this.session.head.handle, workspace: this.session.workspace };
    if (update) Object.assign(settings.history[id], update);
    await storage.writeJSON(this.session.context.userSettingsPath, settings);
    console.log('Wrote session history (update)');
  }

  async deleteHistory() {
    const { settings, userSettingsPath } = this.session.context;
    delete settings.history[this.session.head.id];
    await storage.writeJSON(userSettingsPath, settings);
    console.log('Wrote session history (delete)');
  }

  async writeHistoryClock() {
    assert(this.session.isLoaded());
    await this.writeHistory({ lastWatchedClock: this.session.rr.clock });
  }

  writeHistoryClockThrottled = _.throttle(
    () => {
      this.writeHistoryClock().catch(console.error);
    },
    WRITE_HISTORY_CLOCK_TIMEOUT_MS,
    { leading: false },
  );

  async writeHistoryOpenClose() {
    await this.writeHistory({ lastWatchedTimestamp: new Date().toISOString() });
  }

  async writeHistoryRecording() {
    await this.writeHistory({ lastRecordedTimestamp: new Date().toISOString() });
  }

  async readBody(options?: {
    download?: boolean;
    progress?: Progress;
    abortController?: AbortController;
  }): Promise<t.SessionBodyJSON> {
    this.assertFormatVersionSupport();

    if (options?.download) {
      await this.download({ skipIfExists: true, progress: options.progress, abortController: options.abortController });
    }
    const compact = await storage.readJSON<t.SessionBodyCompact>(path.join(this.dataPath, 'body.json'));
    return deserializeSessionBody(compact);
  }

  async bodyExists() {
    return await storage.pathExists(path.join(this.dataPath, 'body.json'));
  }

  /**
   * Downloads the session zip from server. Writes the head as well as the session data and updates the cache.
   */
  async download(options?: { skipIfExists?: boolean; progress?: Progress; abortController?: AbortController }) {
    this.assertFormatVersionSupport();

    if (options?.skipIfExists && (await this.bodyExists())) {
      options?.progress?.report({ increment: 100 });
      return;
    }

    options?.progress?.report({ message: 'downloading' });
    const zipFilename = `${this.session.head.handle}_body.zip`;
    const zipFilepath = path.join(this.dataPath, zipFilename);
    await serverApi.downloadSessionBody(
      this.session.head.id,
      zipFilepath,
      this.session.context.user?.token,
      options?.progress && scaleProgress(options.progress, 0.9),
      options?.abortController,
    );

    // For some reason when stream.pipeline() resolves, the extracted files have not
    // yet been written. So we have to wait on out.promise().
    options?.progress?.report({ message: 'extracting' });
    const out = unzipper.Extract({ path: this.dataPath, verbose: true });
    await stream.promises.pipeline(fs.createReadStream(zipFilepath), out);
    await out.promise();
    await this.writeHead();
    await cache.copyCover(this.dataPath, this.session.head.id);
    this.session.local = true;
    options?.progress?.report({ increment: 10 });
  }

  async createWorkspaceDir() {
    await fs.promises.mkdir(this.session.workspace, { recursive: true });
  }

  async writeFileIfNotExists(uri: string, text: string) {
    const fsPath = URI.parse(this.resolveUri(uri)).fsPath;

    if (!(await storage.pathExists(fsPath))) {
      fs.mkdirSync(path.dirname(fsPath), { recursive: true });
      fs.writeFileSync(fsPath, text, { flush: true });
    }
  }

  async readBlob(sha1: string): Promise<Uint8Array> {
    return fs.promises.readFile(path.join(this.dataPath, 'blobs', sha1));
  }

  async writeBlob(sha1: string, data: string | NodeJS.ArrayBufferView) {
    fs.mkdirSync(path.join(this.dataPath, 'blobs'), { recursive: true });
    fs.writeFileSync(path.join(this.dataPath, 'blobs', sha1), data, { flush: true, encoding: 'utf8' });
  }

  async readFile(file: t.File): Promise<Uint8Array> {
    if (file.type === 'local') {
      return this.readBlob(file.sha1);
    } else {
      throw new Error(`TODO readFile ${file.type}`);
    }
  }

  async copyToBlob(src: string, sha1: string) {
    await fs.promises.cp(src, path.join(this.dataPath, 'blobs', sha1), { recursive: true });
  }

  async delete() {
    assert(!this.session.temp, 'Tried to delete a temp session.');
    await fs.promises.rm(this.session.workspace, { force: true, recursive: true });
    await this.deleteHistory();
  }

  async packageBody() {
    assert(await storage.pathExists(path.join(this.dataPath, 'body.json')), "Session body doesn't exist");

    const blobs = await this.getUsedBlobs();
    return new Promise<string>((resolve, reject) => {
      const zipFilename = `${this.session.head.handle}_body.zip`;
      const zipFilepath = path.join(this.dataPath, zipFilename);
      const output = fs.createWriteStream(zipFilepath);
      const archive = archiver('zip', { zlib: { level: 9 } });

      // 'close' event is fired only when a file descriptor is involved
      output.on('close', () => {
        resolve(zipFilepath);
      });

      // This event is fired when the data source is drained no matter what was the data source.
      // output.on('end',  () => {});

      archive.on('warning', error => {
        console.warn(error);
      });

      archive.on('error', error => {
        reject(error);
      });

      archive.pipe(output);
      if (this.session.head.hasCover) {
        archive.file(path.join(this.dataPath, 'cover'), { name: 'cover' });
      }
      archive.file(path.join(this.dataPath, 'body.json'), { name: 'body.json' });
      // archive.file(path.join(this.dataPath, 'head.json'), { name: 'head.json' });

      for (const blob of blobs) {
        archive.file(path.join(this.dataPath, 'blobs', blob), { name: path.posix.join('blobs', blob) });
      }

      archive.finalize();
    });
  }

  async gcBlobs() {
    const usedBlobs = await this.getUsedBlobs();

    let allBlobs: string[] = [];
    try {
      allBlobs = await fs.promises.readdir(path.join(this.dataPath, 'blobs'), { recursive: true });
    } catch (error) {
      // It's ok if blobs doesn't exist.
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }

    for (const blob of allBlobs) {
      if (!usedBlobs.has(blob)) {
        console.log('GC blobs: deleting', blob);
        await fs.promises.rm(path.join(this.dataPath, 'blobs', blob), { force: true });
      }
    }
  }

  async getUsedBlobs(): Promise<Set<string>> {
    assert(this.session.local, 'Session does not exist on disk');
    const body = this.session.body?.toJSON() ?? (await this.readBody());
    const blobs = new Set<string>();

    // Find blobs in editor tracks.
    for (const track of Object.values(body.editorTracks)) {
      for (const e of track) {
        if (e.type === 'init' && e.file.type === 'local') blobs.add(e.file.sha1);
      }
    }

    // Find blobs in audio and video tracks.
    for (const track of body.audioTracks) {
      if (track.file.type === 'local') blobs.add(track.file.sha1);
    }
    for (const track of body.videoTracks) {
      if (track.file.type === 'local') blobs.add(track.file.sha1);
    }

    return blobs;
  }

  async publish(options?: { progress?: Progress; abortController?: AbortController }): Promise<t.SessionPublication> {
    if (!this.session.context.user) throw new Error('Please join/login to publish.');

    if (this.session.head.author && this.session.head.author !== this.session.context.user.username) {
      throw new Error(`This session belongs to ${this.session.head.author}. You cannot publish it.`);
    }

    // If session's author is undefined, server will automatically set author to current user.

    options?.progress?.report({ message: 'packaging' });
    const bodyZip = await this.packageBody();

    options?.progress?.report({ message: 'uploading', increment: 50 });
    const res = await serverApi.publishSession(
      this.session.head,
      bodyZip,
      this.session.context.user?.token,
      options?.progress,
      options?.abortController,
    );
    options?.progress?.report({ increment: 45 });
    this.session.head = res.head;
    await this.write();

    return res.publication;
  }

  assertFormatVersionSupport() {
    if (this.session.head.formatVersion > SessionCore.LATEST_FORMAT_VERSION) {
      throw new Error('Please update CodeMic to load this session. It uses features not available in this version.');
    }
  }
}
