import { deserializeSessionBody, serializeSessionBodyJSON } from './serialization.js';
import * as t from '../../lib/types.js';
import * as path from '../../lib/path.js';
import assert from '../../lib/assert.js';
import * as serverApi from '../server_api.js';
import * as misc from '../misc.js';
import type { Context, ReadDirOptions } from '../types.js';
import * as storage from '../storage.js';
import Session from './session.js';
import { defaultWorkspacePath } from '../paths.js';
import fs from 'fs';
import _ from 'lodash';
import archiver from 'archiver';
import unzipper from 'unzipper';
import stream from 'stream';
import { v4 as uuid } from 'uuid';

export default class SessionCore {
  constructor(public session: Session) {}

  static async fromExisting(
    context: Context,
    id: string,
    opts?: { mustScan?: boolean; workspace?: t.AbsPath },
  ): Promise<Session | undefined> {
    const head = await SessionCore.headFromExisting(context, id);
    if (head) {
      const workspace = opts?.workspace ?? SessionCore.getWorkspace(context, head);
      return new Session(context, workspace, head, { inStorage: true, mustScan: opts?.mustScan });
    }
  }

  static async fromNew(context: Context, workspace: t.AbsPath, head: t.SessionHead): Promise<Session> {
    return new Session(context, workspace, head, { mustScan: true });
  }

  static async headFromExisting(context: Context, id: string): Promise<t.SessionHead | undefined> {
    const headPath = path.abs(context.userDataPath, 'sessions', id, 'head.json');
    return storage.readJSONOptional<t.SessionHead>(headPath);
  }

  static getWorkspace(context: Context, head: t.SessionHead): t.AbsPath {
    const history = context.settings.history[head.id];
    if (history) return history.workspace;
    assert(head.handle, 'Please select a handle');
    return path.abs(defaultWorkspacePath, head.handle);
  }

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
      hasCoverPhoto: false,
    };
  }

  static async fromFork(
    context: Context,
    baseId: string,
    options?: { author?: t.UserSummary },
  ): Promise<Session | undefined> {
    const base = await SessionCore.fromExisting(context, baseId);
    if (base) {
      const head = await base.core.fork(options);
      return SessionCore.fromExisting(context, head.id);
    }
  }

  async fork(options?: { author?: t.UserSummary }): Promise<t.SessionHead> {
    await this.download({ skipIfExists: true });
    const forkHead: t.SessionHead = {
      id: uuid(),
      title: `Fork: ${this.session.head.title}`,
      handle: `fork_${this.session.head.handle}`,
      description: this.session.head.description,
      author: options?.author ?? this.session.head.author,
      duration: this.session.head.duration,
      views: 0,
      likes: 0,
      publishTimestamp: undefined,
      modificationTimestamp: this.session.head.modificationTimestamp,
      toc: this.session.head.toc,
      forkedFrom: this.session.head.id,
      hasCoverPhoto: this.session.head.hasCoverPhoto,
    };

    // Copy the entire session data, then rewrite the head.
    const forkSessionDataPath = path.abs(this.session.context.userDataPath, 'sessions', forkHead.id);
    await fs.promises.cp(this.sessionDataPath, forkSessionDataPath, { recursive: true });
    await storage.writeJSON(path.abs(forkSessionDataPath, 'head.json'), forkHead);

    return forkHead;
  }

  /**
   * Returns a sorted list of all files and directories.
   * The returned items do NOT start with "/".
   */
  async readDirRecursively(
    options: ReadDirOptions,
    rel: t.RelPath = path.CUR_DIR,
    res: [t.RelPath, fs.Stats][] = [],
  ): Promise<[t.RelPath, fs.Stats][]> {
    let filenames: t.RelPath[] = [];
    try {
      filenames = (await fs.promises.readdir(path.join(this.session.workspace, rel))) as t.RelPath[];
    } catch (error) {
      const workspaceDoesntExist = (error as NodeJS.ErrnoException).code === 'ENOENT' && rel !== path.CUR_DIR;
      if (!workspaceDoesntExist) throw error;
    }

    filenames.sort();
    for (const childname of filenames) {
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

  get sessionDataPath(): t.AbsPath {
    return path.abs(this.session.context.userDataPath, 'sessions', this.session.head.id);
  }

  resolveUri(uri: t.Uri): t.Uri {
    return path.resolveUri(this.session.workspace, uri);
  }

  async write() {
    await this.writeHead();
    if (this.session.isLoaded()) await this.writeBody();

    this.session.editor?.saved();
  }

  async writeHead() {
    assert(this.session.head); // Sometimes head.json becomes blank. Maybe this'll catch the issue?
    await storage.writeJSON(path.abs(this.sessionDataPath, 'head.json'), this.session.head);
    this.session.inStorage = true;
  }

  async writeBody() {
    assert(this.session.isLoaded(), 'writeBody: body is not yet loaded.');
    await storage.writeJSON(
      path.abs(this.sessionDataPath, 'body.json'),
      serializeSessionBodyJSON(this.session.body.toJSON()),
    );
    this.session.inStorage = true;
  }

  async writeHistory(update?: Partial<t.SessionHistory>) {
    const { id } = this.session.head;
    const { settings } = this.session.context;
    settings.history[id] ??= { id, workspace: this.session.workspace };
    if (update) Object.assign(settings.history[id], update);
    await storage.writeJSON(path.abs(this.session.context.userDataPath, 'settings.json'), settings);
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
    const compact = await storage.readJSON<t.SessionBodyCompact>(path.abs(this.sessionDataPath, 'body.json'));
    return deserializeSessionBody(compact);
  }

  async download(options?: { skipIfExists: boolean }) {
    if (options?.skipIfExists && (await misc.fileExists(path.abs(this.sessionDataPath, 'body.json')))) return;

    await serverApi.downloadSession(
      this.session.head.id,
      path.abs(this.sessionDataPath, 'body.zip'),
      this.session.context.user?.token,
    );
    // For some reason when stream.pipeline() resolves, the extracted files have not
    // yet been written. So we have to wait on out.promise().
    const out = unzipper.Extract({ path: this.sessionDataPath, verbose: true });
    await stream.promises.pipeline(fs.createReadStream(path.abs(this.sessionDataPath, 'body.zip')), out);
    await out.promise();
  }

  async createWorkspaceDir() {
    await fs.promises.mkdir(this.session.workspace, { recursive: true });
  }

  async writeFileIfNotExists(uri: t.Uri, text: string) {
    const absPath = path.getFileUriPath(this.resolveUri(uri));

    if (!(await misc.fileExists(absPath))) {
      await fs.promises.writeFile(absPath, text);
    }
  }

  async readBlob(sha1: string): Promise<Uint8Array> {
    return fs.promises.readFile(path.abs(this.sessionDataPath, 'blobs', sha1));
  }

  async writeBlob(sha1: string, data: string | NodeJS.ArrayBufferView) {
    await fs.promises.writeFile(path.abs(this.sessionDataPath, 'blobs', sha1), data, 'utf8');
  }

  async readFile(file: t.File): Promise<Uint8Array> {
    if (file.type === 'local') {
      return this.readBlob(file.sha1);
    } else {
      throw new Error(`TODO readFile ${file.type}`);
    }
  }

  async copyToBlob(src: t.AbsPath, sha1: string) {
    await fs.promises.cp(src, path.abs(this.sessionDataPath, 'blobs', sha1), { recursive: true });
  }

  async delete() {
    await fs.promises.rm(this.sessionDataPath, { force: true, recursive: true });
    delete this.session.context.settings.history[this.session.head.id];
    await storage.writeJSON(
      path.abs(this.session.context.userDataPath, 'settings.json'),
      this.session.context.settings,
    );
  }

  async package() {
    assert(await misc.fileExists(path.abs(this.sessionDataPath, 'body.json')), "Session body doesn't exist");

    return new Promise<t.AbsPath>((resolve, reject) => {
      // const packagePath = path.abs(os.tmpdir(), this.head.id + '.zip');

      const output = fs.createWriteStream(path.abs(this.sessionDataPath, 'body.zip'));
      const archive = archiver('zip', { zlib: { level: 9 } });

      // 'close' event is fired only when a file descriptor is involved
      output.on('close', () => {
        resolve(path.abs(this.sessionDataPath, 'body.zip'));
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
      if (this.session.head.hasCoverPhoto) {
        archive.file(path.abs(this.sessionDataPath, 'cover_photo'), { name: 'cover_photo' });
      }
      archive.file(path.abs(this.sessionDataPath, 'body.json'), { name: 'body.json' });
      archive.directory(path.abs(this.sessionDataPath, 'blobs'), 'blobs');
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
