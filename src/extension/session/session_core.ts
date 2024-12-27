import { deserializeSessionBody, serializeSessionBodyJSON } from './serialization.js';
import * as lib from '../../lib/lib.js';
import * as t from '../../lib/types.js';
import assert from '../../lib/assert.js';
import * as paths from '../../lib/paths.js';
import * as serverApi from '../server_api.js';
import type { Context, ReadDirOptions } from '../types.js';
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

export default class SessionCore {
  constructor(public session: Session) {}

  static LATEST_FORMAT_VERSION = 1;

  static async fromLocal(
    context: Context,
    workspace: string,
    opts?: { mustScan?: boolean },
  ): Promise<Session | undefined> {
    const head = await storage.readJSONOptional<t.SessionHead>(path.join(workspace, '.CodeMic', 'head.json'));
    if (head) {
      return new Session(context, workspace, head, { local: true, mustScan: opts?.mustScan });
    }
  }

  static async fromRemote(context: Context, head: t.SessionHead): Promise<Session> {
    assert(head.author?.username, 'Session has no author');
    assert(head.handle, 'Session has no handle');
    const workspace = path.join(paths.getDefaultWorkspaceBasePath(osPaths.home), head.author.username, head.handle);
    return new Session(context, workspace, head);
  }

  static async sessionExists(workspace: string): Promise<boolean> {
    return storage.pathExists(path.join(workspace, '.CodeMic'));
  }

  static async fromNew(context: Context, workspace: string, head: t.SessionHead): Promise<Session> {
    const temp = path.join(context.userDataPath, 'new_session');
    await fs.promises.rm(temp, { recursive: true, force: true });
    await fs.promises.mkdir(temp, { recursive: true });
    return new Session(context, workspace, head, { mustScan: true, temp: true });
  }

  // static getWorkspace(context: Context, head: t.SessionHead): t.AbsPath {
  //   const history = context.settings.history[head.id];
  //   if (history) return history.workspace;
  //   assert(head.handle, 'Please select a handle');
  //   return path.abs(paths.getDefaultWorkspaceBasePath(os.homedir()), head.handle);
  // }

  static makeNewHead(author?: t.UserSummary): t.SessionHead {
    return {
      id: uuid(),
      handle: '',
      title: '',
      description: '',
      author,
      duration: 0,
      views: 0,
      likes: 0,
      modificationTimestamp: new Date().toISOString(), // will be overwritten at the end
      toc: [],
      formatVersion: SessionCore.LATEST_FORMAT_VERSION,
    };
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
      // TODO ignore file
      if (childname === '.CodeMic') continue;
      if (childname === '.git') continue;

      const childRel = path.join(rel, childname);
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
    return path.join(this.session.workspace, '.CodeMic');
  }

  resolveUri(uri: string): string {
    return lib.resolveWorkspaceUri(this.session.workspace, uri);
  }

  /**
   * Move the session from temp to its final data path and set temp = false.
   */
  async commitTemp() {
    if (await Session.Core.sessionExists(this.session.workspace)) {
      const old = await Session.Core.fromLocal(this.session.context, this.session.workspace);
      if (old) await old.core.delete();
    }
    await fs.promises.cp(this.tempDataPath, this.finalDataPath, { force: true, recursive: true });
    this.session.temp = false;
  }

  async write() {
    await this.writeHead();
    if (this.session.isLoaded()) await this.writeBody();

    this.session.editor.saved();
  }

  async writeHead() {
    assert(this.session.head); // Sometimes head.json becomes blank. Maybe this'll catch the issue?
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
    const { id } = this.session.head;
    const { settings } = this.session.context;
    settings.history[id] ??= { id, handle: this.session.head.handle, workspace: this.session.workspace };
    if (update) Object.assign(settings.history[id], update);
    await storage.writeJSON(this.session.context.userSettingsPath, settings);
    console.log('Wrote session history');
  }

  async writeHistoryClock(options?: { ifDirtyForLong?: boolean }) {
    // TODO support options.ifDirtyForLong
    assert(this.session.isLoaded());
    await this.writeHistory({ lastWatchedClock: this.session.rr.clock });
  }

  async writeHistoryOpenClose() {
    await this.writeHistory({ lastWatchedTimestamp: new Date().toISOString() });
  }

  async writeHistoryRecording() {
    await this.writeHistory({ lastRecordedTimestamp: new Date().toISOString() });
  }

  async readBody(options?: { download: boolean }): Promise<t.SessionBodyJSON> {
    this.assertFormatVersionSupport();

    if (options?.download) await this.download({ skipIfExists: true });
    const compact = await storage.readJSON<t.SessionBodyCompact>(path.join(this.dataPath, 'body.json'));
    return deserializeSessionBody(compact);
  }

  async download(options?: { skipIfExists: boolean }) {
    this.assertFormatVersionSupport();

    if (options?.skipIfExists && (await storage.pathExists(path.join(this.dataPath, 'body.json')))) return;

    await serverApi.downloadSession(
      this.session.head.id,
      path.join(this.dataPath, 'body.zip'),
      this.session.context.user?.token,
    );
    // For some reason when stream.pipeline() resolves, the extracted files have not
    // yet been written. So we have to wait on out.promise().
    const out = unzipper.Extract({ path: this.dataPath, verbose: true });
    await stream.promises.pipeline(fs.createReadStream(path.join(this.dataPath, 'body.zip')), out);
    await out.promise();
  }

  async createWorkspaceDir() {
    await fs.promises.mkdir(this.session.workspace, { recursive: true });
  }

  async writeFileIfNotExists(uri: string, text: string) {
    const fsPath = URI.parse(this.resolveUri(uri)).fsPath;

    if (!(await storage.pathExists(fsPath))) {
      await fs.promises.writeFile(fsPath, text);
    }
  }

  async readBlob(sha1: string): Promise<Uint8Array> {
    return fs.promises.readFile(path.join(this.dataPath, 'blobs', sha1));
  }

  async writeBlob(sha1: string, data: string | NodeJS.ArrayBufferView) {
    await fs.promises.writeFile(path.join(this.dataPath, 'blobs', sha1), data, 'utf8');
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
    await fs.promises.rm(this.dataPath, { force: true, recursive: true });
    delete this.session.context.settings.history[this.session.head.id];
    await storage.writeJSON(this.session.context.userSettingsPath, this.session.context.settings);
  }

  async package() {
    assert(await storage.pathExists(path.join(this.dataPath, 'body.json')), "Session body doesn't exist");

    return new Promise<string>((resolve, reject) => {
      // const packagePath = path.abs(os.tmpdir(), this.head.id + '.zip');

      const output = fs.createWriteStream(path.join(this.dataPath, 'body.zip'));
      const archive = archiver('zip', { zlib: { level: 9 } });

      // 'close' event is fired only when a file descriptor is involved
      output.on('close', () => {
        resolve(path.join(this.dataPath, 'body.zip'));
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
      archive.directory(path.join(this.dataPath, 'blobs'), 'blobs');
      archive.finalize();
    });
  }

  async publish() {
    const zip = await this.package();
    const res = await serverApi.publishSession(this.session.head, zip, this.session.context.user?.token);
    this.session.head = res;
    await this.write();
  }

  assertFormatVersionSupport() {
    if (this.session.head.formatVersion > SessionCore.LATEST_FORMAT_VERSION) {
      throw new Error('You need a more recent version of CodeMic to load this session. Please update CodeMic.');
    }
  }
}
