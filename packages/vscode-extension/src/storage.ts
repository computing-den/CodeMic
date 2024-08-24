import { types as t, path } from '@codecast/lib';
import fs from 'fs';
import _ from 'lodash';

// export class Storage {
//   private constructor(public user?: t.User) {}

//   static async create(user?: t.User): Promise<Storage> {
//     await fs.promises.mkdir(dataPaths(user?.username).sessions, { recursive: true });
//     return new Storage(user);
//   }

//   get dataPaths(): DataPaths {
//     return dataPaths(this.user?.username);
//   }

export async function readJSON<T>(p: t.AbsPath, defaultFn?: () => T): Promise<T> {
  try {
    const str = await fs.promises.readFile(p, 'utf8');
    return JSON.parse(str) as T;
  } catch (error: any) {
    if (!defaultFn || (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return defaultFn();
  }
}

export async function readJSONOptional<T>(p: t.AbsPath): Promise<T | undefined> {
  return readJSON(p, () => undefined);
}

export async function writeJSON(p: t.AbsPath, data: any) {
  await fs.promises.mkdir(path.dirname(p), { recursive: true });
  await fs.promises.writeFile(p, pretty(data), 'utf8');
}

// export class AppStorage {
//   private constructor(
//     public storage: Storage,
//     public settingsCache: FileCache<t.SessionHead>,
//     public bodyCache: FileCache<t.SessionBody | undefined>,
//   ) {}

// }

// export class SessionStorage implements t.SessionIO {
//   private constructor(
//     public storage: Storage,
//     public headCache: FileCache<t.SessionHead>,
//     public bodyCache: FileCache<t.SessionBody | undefined>,
//   ) {}

//   static async fromHeadFile(storage: Storage, id: string): Promise<SessionStorage> {
//     const sessionPaths = storage.dataPaths.session(id);
//     const headCache = await FileCache.fromFile<t.SessionHead>(storage, sessionPaths.head);
//     const bodyCache = FileCache.fromData<t.SessionBody | undefined>(storage, sessionPaths.body, undefined);
//     return new SessionStorage(storage, headCache, bodyCache);
//   }

//   static async fromHeadData(storage: Storage, sessionHead: t.SessionHead): Promise<SessionStorage> {
//     const sessionPaths = storage.dataPaths.session(sessionHead.id);
//     const headCache = FileCache.fromData<t.SessionHead>(storage, sessionPaths.head, sessionHead);
//     const bodyCache = FileCache.fromData<t.SessionBody | undefined>(storage, sessionPaths.body, undefined);
//     return new SessionStorage(storage, headCache, bodyCache);
//   }

//   static createEmptyBody(): t.SessionBody {
//     return {
//       audioTracks: [],
//       editorTrack: et.makeEmptyEditorTrackJSON(os.EOL as t.EndOfLine),
//     };
//   }

//   get sessionDataPaths(): SessionDataPaths {
//     return this.storage.dataPaths.session(this.headCache.data.id);
//   }

//   initEmptyBody() {
//     this.bodyCache.data = SessionStorage.createEmptyBody();
//   }

//   async write() {
//     await this.headCache.write();
//     if (this.bodyCache.data) await this.bodyCache.write();
//   }

//   async readBody(options?: { download: boolean }) {
//     if (options?.download) await this.download({ skipIfExists: true });
//     await this.bodyCache.read();
//   }

//   async download(options?: { skipIfExists: boolean }) {
//     if (options?.skipIfExists && (await misc.fileExists(this.bodyCache.filePath))) return;

//     await serverApi.downloadSession(this.headCache.data.id, this.sessionPaths.zip, this.storage.user?.token);
//     // For some reason when stream.pipeline() resolves, the extracted files have not
//     // yet been written. So we have to wait on out.promise().
//     const out = unzipper.Extract({ path: this.sessionPaths.root, verbose: true });
//     await stream.promises.pipeline(fs.createReadStream(this.sessionPaths.zip), out);
//     await out.promise();
//   }

//   async readBlobBySha1(sha1: string): Promise<Uint8Array> {
//     return fs.promises.readFile(this.sessionPaths.blob(sha1));
//   }

//   async readFile(file: t.File): Promise<Uint8Array> {
//     if (file.type === 'local') {
//       return this.readBlobBySha1(file.sha1);
//     } else {
//       throw new Error(`TODO readFile ${file.type}`);
//     }
//   }

//   async copyToBlob(src: t.AbsPath, sha1: string) {
//     await fs.promises.cp(src, this.sessionPaths.blob(sha1), { recursive: true });
//   }

//   // mergeSessionHistory(h: t.SessionHistory) {
//   //   this.settings.history[h.id] = { ...this.settings.history[h.id], ...h };
//   // }

//   async delete() {
//     await fs.promises.rm(this.sessionPaths.root, { force: true, recursive: true });
//   }

//   async copy(to: SessionStorage) {
//     await fs.promises.cp(this.sessionPaths.root, to.sessionPaths.root, { recursive: true });
//   }

//   async package(): Promise<t.AbsPath> {
//     return new Promise((resolve, reject) => {
//       const packagePath = path.abs(os.tmpdir(), this.headCache.data.id + '.zip');

//       const output = fs.createWriteStream(packagePath);
//       const archive = archiver('zip', { zlib: { level: 9 } });

//       // 'close' event is fired only when a file descriptor is involved
//       output.on('close', () => {
//         resolve(packagePath);
//       });

//       // This event is fired when the data source is drained no matter what was the data source.
//       // output.on('end',  () => {});

//       archive.on('warning', error => {
//         console.warn(error);
//       });

//       archive.on('error', error => {
//         reject(error);
//       });

//       archive.pipe(output);
//       archive.file(this.sessionPaths.body, { name: path.basename(this.sessionPaths.body) });
//       archive.directory(this.sessionPaths.blobs, path.basename(this.sessionPaths.blobs));
//       archive.finalize();
//     });
//   }
// }

// export class FileCache<T> {
//   constructor(public storage: Storage, public filePath: t.AbsPath, public data: T) {}

//   static async fromFile<T>(storage: Storage, filePath: t.AbsPath, defaultFn?: () => T): Promise<FileCache<T>> {
//     const data = await storage.readJSON<T>(filePath, defaultFn);
//     return new FileCache(storage, filePath, data);
//   }

//   static fromData<T>(storage: Storage, filePath: t.AbsPath, data: T) {
//     return new FileCache(storage, filePath, data);
//   }

//   async read() {
//     this.data = await this.storage.readJSON<T>(this.filePath);
//   }

//   async write() {
//     assert(this.data);
//     await this.storage.writeJSON(this.filePath, this.data);
//   }
// }

function pretty(json: any): string {
  return JSON.stringify(json, null, 2);
}
