import { deserializeSessionBody, serializeSessionBodyJSON } from './serialization.js';
import * as t from '../../lib/types.js';
import assert from '../../lib/assert.js';
import * as serverApi from '../server_api.js';
import * as misc from '../misc.js';
import type { Context, ReadDirOptions } from '../types.js';
import * as storage from '../storage.js';
import Session from './session.js';
import { defaultWorkspaceBasePath } from '../paths.js';
import fs from 'fs';
import _ from 'lodash';
import archiver from 'archiver';
import unzipper from 'unzipper';
import stream from 'stream';
import { v4 as uuid } from 'uuid';
import * as path from 'path';
import { URI, Utils } from 'vscode-uri';
import { resolveWorkspaceUri } from '../../lib/lib.js';

export default class SessionCore {
  constructor(public session: Session) {}

  static async fromExisting(
    context: Context,
    workspace: string,
    opts?: { mustScan?: boolean },
  ): Promise<Session | undefined> {
    const head = await storage.readJSONOptional<t.SessionHead>(path.join(workspace, '.codemic', 'head.json'));
    return head && new Session(context, workspace, head, { local: true, mustScan: opts?.mustScan });
  }

  static async fromNew(context: Context, workspace: string, head: t.SessionHead): Promise<Session> {
    const temp = path.join(context.userDataPath, 'temp');
    await fs.promises.rm(temp, { recursive: true, force: true });
    await fs.promises.mkdir(temp, { recursive: true });
    return new Session(context, workspace, head, { mustScan: true, temp: true });
  }

  // static getWorkspace(context: Context, head: t.SessionHead): t.AbsPath {
  //   const history = context.settings.history[head.id];
  //   if (history) return history.workspace;
  //   assert(head.handle, 'Please select a handle');
  //   return path.abs(defaultWorkspaceBasePath, head.handle);
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
    };
  }

  // static async fromFork(
  //   context: Context,
  //   baseId: string,
  //   options?: { author?: t.UserSummary },
  // ): Promise<Session | undefined> {
  //   const base = await SessionCore.fromExisting(context, baseId);
  //   if (base) {
  //     const head = await base.core.fork(options);
  //     return SessionCore.fromExisting(context, head.id);
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
  //     hasCoverPhoto: this.session.head.hasCoverPhoto,
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
      if (childname === '.codemic') continue;
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

  get sessionDataPath(): string {
    return this.session.temp ? this.sessionTempDataPath : this.sessionFinalDataPath;
  }

  get sessionTempDataPath(): string {
    return path.join(this.session.context.userDataPath, 'temp');
  }

  get sessionFinalDataPath(): string {
    assert(this.session.workspace);
    return path.join(this.session.workspace, '.codemic');
  }

  resolveUri(uri: string): string {
    return resolveWorkspaceUri(this.session.workspace, uri);
  }

  /**
   * Move the session from temp to its final data path and set temp = false.
   */
  async commitTemp() {
    await fs.promises.cp(this.sessionTempDataPath, this.sessionFinalDataPath, { force: true, recursive: true });
    this.session.temp = false;
  }

  async write() {
    await this.writeHead();
    if (this.session.isLoaded()) await this.writeBody();

    this.session.editor?.saved();
  }

  async writeHead() {
    assert(this.session.head); // Sometimes head.json becomes blank. Maybe this'll catch the issue?
    await storage.writeJSON(path.join(this.sessionDataPath, 'head.json'), this.session.head);
    this.session.local = true;
  }

  async writeBody() {
    assert(this.session.isLoaded(), 'writeBody: body is not yet loaded.');
    await storage.writeJSON(
      path.join(this.sessionDataPath, 'body.json'),
      serializeSessionBodyJSON(this.session.body.toJSON()),
    );
    this.session.local = true;
  }

  async writeHistory(update?: Partial<t.SessionHistory>) {
    const { id } = this.session.head;
    const { settings } = this.session.context;
    settings.history[id] ??= { id, handle: this.session.head.handle, workspace: this.session.workspace };
    if (update) Object.assign(settings.history[id], update);
    await storage.writeJSON(this.session.context.userSettingsPath, settings);
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
    if (options?.download) await this.download({ skipIfExists: true });
    const compact = await storage.readJSON<t.SessionBodyCompact>(path.join(this.sessionDataPath, 'body.json'));
    return deserializeSessionBody(compact);
  }

  async download(options?: { skipIfExists: boolean }) {
    if (options?.skipIfExists && (await storage.fileExists(path.join(this.sessionDataPath, 'body.json')))) return;

    await serverApi.downloadSession(
      this.session.head.id,
      path.join(this.sessionDataPath, 'body.zip'),
      this.session.context.user?.token,
    );
    // For some reason when stream.pipeline() resolves, the extracted files have not
    // yet been written. So we have to wait on out.promise().
    const out = unzipper.Extract({ path: this.sessionDataPath, verbose: true });
    await stream.promises.pipeline(fs.createReadStream(path.join(this.sessionDataPath, 'body.zip')), out);
    await out.promise();
  }

  async createWorkspaceDir() {
    await fs.promises.mkdir(this.session.workspace, { recursive: true });
  }

  async writeFileIfNotExists(uri: string, text: string) {
    const fsPath = URI.parse(this.resolveUri(uri)).fsPath;

    if (!(await storage.fileExists(fsPath))) {
      await fs.promises.writeFile(fsPath, text);
    }
  }

  async readBlob(sha1: string): Promise<Uint8Array> {
    return fs.promises.readFile(path.join(this.sessionDataPath, 'blobs', sha1));
  }

  async writeBlob(sha1: string, data: string | NodeJS.ArrayBufferView) {
    await fs.promises.writeFile(path.join(this.sessionDataPath, 'blobs', sha1), data, 'utf8');
  }

  async readFile(file: t.File): Promise<Uint8Array> {
    if (file.type === 'local') {
      return this.readBlob(file.sha1);
    } else {
      throw new Error(`TODO readFile ${file.type}`);
    }
  }

  async copyToBlob(src: string, sha1: string) {
    await fs.promises.cp(src, path.join(this.sessionDataPath, 'blobs', sha1), { recursive: true });
  }

  async delete() {
    await fs.promises.rm(this.sessionDataPath, { force: true, recursive: true });
    delete this.session.context.settings.history[this.session.head.id];
    await storage.writeJSON(this.session.context.userSettingsPath, this.session.context.settings);
  }

  async package() {
    assert(await storage.fileExists(path.join(this.sessionDataPath, 'body.json')), "Session body doesn't exist");

    return new Promise<string>((resolve, reject) => {
      // const packagePath = path.abs(os.tmpdir(), this.head.id + '.zip');

      const output = fs.createWriteStream(path.join(this.sessionDataPath, 'body.zip'));
      const archive = archiver('zip', { zlib: { level: 9 } });

      // 'close' event is fired only when a file descriptor is involved
      output.on('close', () => {
        resolve(path.join(this.sessionDataPath, 'body.zip'));
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
      if (this.session.head.coverPhotoHash) {
        archive.file(path.join(this.sessionDataPath, 'cover_photo'), { name: 'cover_photo' });
      }
      archive.file(path.join(this.sessionDataPath, 'body.json'), { name: 'body.json' });
      archive.directory(path.join(this.sessionDataPath, 'blobs'), 'blobs');
      archive.finalize();
    });
  }

  async publish() {
    const zip = await this.package();
    const res = await serverApi.publishSession(this.session.head, zip, this.session.context.user?.token);
    this.session.head = res;
    await this.write();
  }
}
