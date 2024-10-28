import ContentChange from '../content_change.js';
import * as t from '../../lib/types.js';
import * as path from '../../lib/path.js';
import InternalTextDocument from './internal_text_document.js';
import * as lib from '../../lib/lib.js';
import assert from '../../lib/assert.js';
import * as serverApi from '../server_api.js';
import type { SessionDataPaths } from '../paths.js';
import * as misc from '../misc.js';
import type { Context, ReadDirOptions } from '../types.js';
import * as storage from '../storage.js';
import SessionRuntime from './session_runtime.js';
import fs from 'fs';
import _ from 'lodash';
import archiver from 'archiver';
import unzipper from 'unzipper';
import stream from 'stream';
import os from 'os';
import vscode, { Range, Selection, Position } from 'vscode';
import { v4 as uuid } from 'uuid';

export class Session implements t.Session {
  context: Context;
  workspace: t.AbsPath;
  head: t.SessionHead;
  loaded = false;
  inStorage: boolean;
  body?: t.SessionBody;
  runtime?: SessionRuntime;

  constructor(context: Context, workspace: t.AbsPath, head: t.SessionHead, inStorage: boolean) {
    this.context = context;
    this.workspace = workspace;
    this.head = head;
    this.inStorage = inStorage;
  }

  get sessionDataPaths(): SessionDataPaths {
    return this.context.dataPaths.session(this.head.id);
  }

  get clock(): number | undefined {
    return this.runtime?.clock;
  }

  get running(): boolean {
    return Boolean(this.runtime?.running);
  }

  get recording(): boolean {
    return Boolean(this.running && this.runtime?.mode.recordingEditor);
  }

  get playing(): boolean {
    return Boolean(this.running && !this.runtime?.mode.recordingEditor);
  }

  static async fromExisting(context: Context, id: string): Promise<Session | undefined> {
    const workspace = Session.getWorkspace(context, id);
    const head = await Session.headFromExisting(context, id);
    return head && new Session(context, workspace, head, true);
  }

  static async headFromExisting(context: Context, id: string): Promise<t.SessionHead | undefined> {
    const headPath = context.dataPaths.session(id).head;
    return storage.readJSONOptional<t.SessionHead>(headPath);
  }

  static async fromNew(context: Context, workspace: t.AbsPath, head: t.SessionHead): Promise<Session> {
    return new Session(context, workspace, head, false);
  }

  static getWorkspace(context: Context, id: string): t.AbsPath {
    return context.settings.history[id]?.workspace ?? context.defaultWorkspacePaths.session(id).root;
  }

  static getCoverPhotoWebviewUri(context: Context, id: string): t.Uri {
    return context.view!.webview.asWebviewUri(vscode.Uri.file(context.dataPaths.session(id).coverPhoto)).toString();
  }

  static makeNewHead(author?: t.UserSummary): t.SessionHead {
    return {
      id: uuid(),
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
    const base = await Session.fromExisting(context, baseId);
    if (base) {
      const head = await base.fork(options);
      return Session.fromExisting(context, head.id);
    }
  }

  // static makeEditHead(base: t.SessionHead, author?: t.UserSummary): t.SessionHead {
  //   return {
  //     ..._.cloneDeep(base),
  //     author,
  //   };
  // }

  static makeBody(): t.SessionBody {
    return {
      editorTrack: {
        events: [],
        defaultEol: os.EOL as t.EndOfLine,
        initSnapshot: {
          worktree: {},
          textEditors: [],
        },
        focusTimeline: {
          documents: [],
          lines: [],
        },
      },
      audioTracks: [],
      videoTracks: [],
    };
  }

  async load(options?: { seekClock?: number; cutClock?: number }) {
    assert(!this.loaded);

    // Read or download body.
    await this.readBody({ download: true });

    // Create workspace directory..
    await fs.promises.mkdir(this.workspace, { recursive: true });

    // Initialize track controllers.
    await this.initRuntime();
    assert(this.runtime);

    // Make sure cut and seek clocks are valid.
    if (options?.cutClock && options?.seekClock) {
      assert(options.cutClock >= options.seekClock);
    }

    // Cut to cutClock.
    if (options?.cutClock !== undefined) {
      // We don't need to cut audio because playback ends when it reaches session's duration.
      this.runtime.internalWorkspace.cut(options.cutClock);
      // for (const c of this.runtime.audioTrackCtrls) c.cut(options.cutClock);
      this.head.duration = options.cutClock;
    }

    // Seek to seekClock.
    let targetUris: t.Uri[] | undefined;
    if (options?.seekClock) {
      const uriSet: t.UriSet = {};
      const seekData = this.runtime.internalWorkspace.getSeekData(options.seekClock);
      await this.runtime.internalWorkspace.seek(seekData, uriSet);
      targetUris = Object.keys(uriSet);
    }

    // Sync and save.
    await this.syncInternalWorkspaceToVscodeAndDisk(targetUris);
    await this.saveAllRelevantVscTabs();

    // Close irrelevant tabs.
    await this.closeIrrelevantVscTabs();

    // Loaded.
    this.loaded = true;
  }

  async scan() {
    assert(!this.loaded);

    this.body = Session.makeBody();
    await this.initRuntime();
    assert(this.runtime);

    // Make sure workspace path exists.
    await fs.promises.mkdir(this.workspace, { recursive: true });

    this.body.editorTrack.initSnapshot = await this.makeSnapshotFromDirAndVsc();
    await this.runtime.internalWorkspace.restoreInitSnapshot();

    this.loaded = true;
  }

  async fork(options?: { author?: t.UserSummary }): Promise<t.SessionHead> {
    await this.download({ skipIfExists: true });
    const forkHead: t.SessionHead = {
      id: uuid(),
      title: `Fork: ${this.head.title}`,
      description: this.head.description,
      author: options?.author ?? this.head.author,
      duration: this.head.duration,
      views: 0,
      likes: 0,
      publishTimestamp: undefined,
      modificationTimestamp: this.head.modificationTimestamp,
      toc: this.head.toc,
      forkedFrom: this.head.id,
      hasCoverPhoto: this.head.hasCoverPhoto,
    };

    // Copy the entire session data, then rewrite the head.
    const forkSessionDataPaths = this.context.dataPaths.session(forkHead.id);
    await fs.promises.cp(this.sessionDataPaths.root, forkSessionDataPaths.root, { recursive: true });
    await storage.writeJSON(forkSessionDataPaths.head, forkHead);

    return forkHead;
  }

  async initRuntime() {
    assert(this.body);
    assert(!this.runtime);
    this.runtime = await SessionRuntime.fromSession(this);
  }

  async makeSnapshotFromDirAndVsc(): Promise<t.InternalEditorTrackSnapshot> {
    // for (const vscTextDocument of vscode.workspace.textDocuments) {
    //   if (vscTextDocument.dirty) {
    //     throw new Error('Checkpoint.fromWorkspace: there are unsaved files in the current workspace.');
    //   }
    // }

    // Create the worktree and copy files to session directory.
    // TODO: ignore files in .codemicignore
    const worktree: t.Worktree = {};
    const paths = await this.readDirRecursively({ includeFiles: true });
    for (const p of paths) {
      const uri = path.workspaceUriFromRelPath(p);
      const data = await fs.promises.readFile(path.join(this.workspace, p));
      const sha1 = await misc.computeSHA1(data);
      worktree[uri] = { type: 'local', sha1 };
      await this.copyToBlob(path.join(this.workspace, p), sha1);
    }

    // Walk through the relevant tabs and take snapshots of the text editors.
    // For untitled tabs, we will also create a blob and put it into the worktree.
    // We ignore those text editors whose files have been deleted on disk.
    const textEditors: t.TextEditor[] = [];
    for (const vscUri of this.getRelevantTabVscUris()) {
      const uri = this.uriFromVsc(vscUri);

      if (vscUri.scheme === 'untitled') {
        const vscTextDocument = this.findVscTextDocumentByVscUri(vscUri);
        if (!vscTextDocument) continue;

        const data = new TextEncoder().encode(vscTextDocument.getText());
        const sha1 = await misc.computeSHA1(data);
        worktree[uri] = { type: 'local', sha1 };
        await this.writeBlob(sha1, data);
        textEditors.push({ uri, selections: [new Selection(0, 0, 0, 0)], visibleRange: new Range(0, 0, 1, 0) });
      } else if (vscUri.scheme === 'file') {
        if (!(await misc.fileExists(path.abs(vscUri.path)))) {
          // File is deleted but the text editor is still there. Ignore it.
          continue;
        }

        // We can only set selection and visible range if we have the vscTextEditor
        const vscTextEditor = this.findVscTextEditorByVscUri(vscode.window.visibleTextEditors, vscUri);
        if (vscTextEditor) {
          textEditors.push({
            uri: this.uriFromVsc(vscTextEditor.document.uri),
            selections: vscTextEditor.selections,
            visibleRange: vscTextEditor.visibleRanges[0],
          });
        } else {
          textEditors.push({
            uri,
            selections: [new Selection(0, 0, 0, 0)],
            visibleRange: new Range(0, 0, 1, 0),
          });
        }
      }
    }

    // Get the active text editor.
    const activeTextEditorVscUri = vscode.window.activeTextEditor?.document.uri;
    let activeTextEditorUri;
    if (activeTextEditorVscUri && this.shouldRecordVscUri(activeTextEditorVscUri)) {
      activeTextEditorUri = this.uriFromVsc(activeTextEditorVscUri);
    }

    return { worktree, textEditors, activeTextEditorUri };
  }

  /**
   * Returns a sorted list of all files.
   * The returned items do NOT start with "/".
   */
  async readDirRecursively(
    options: ReadDirOptions,
    rel: t.RelPath = path.CUR_DIR,
    res: t.RelPath[] = [],
  ): Promise<t.RelPath[]> {
    let filenames: t.RelPath[] = [];
    try {
      filenames = (await fs.promises.readdir(path.join(this.workspace, rel))) as t.RelPath[];
    } catch (error) {
      const workspaceDoesntExist = (error as NodeJS.ErrnoException).code === 'ENOENT' && rel !== path.CUR_DIR;
      if (!workspaceDoesntExist) throw error;
    }

    filenames.sort();
    for (const childname of filenames) {
      const childRel = path.join(rel, childname);
      const childFull = path.join(this.workspace, childRel);
      const stat = await fs.promises.stat(childFull);

      if (stat.isDirectory()) {
        await this.readDirRecursively(options, childRel, res);
      }

      if ((stat.isDirectory() && options.includeDirs) || (stat.isFile() && options.includeFiles)) {
        res.push(childRel);
      }
    }
    return res;
  }

  async syncInternalWorkspaceToVscodeAndDisk(targetUris?: t.Uri[]) {
    // Vscode does not let us close a TextDocument. We can only close tabs and tab groups.
    const ctrl = this.runtime?.internalWorkspace;
    assert(ctrl);

    // TODO having both directories and files in targetUris and ctrl.worktree can make things
    //      a bit confusing. Especially when it comes to deleting directories when there's
    //      still a file inside but is supposed to be ignored according to .codemicignore
    //      I think it's best to keep the directory structure in a separate variable than ctrl.worktree
    //      worktreeFiles: {[key: Uri]: WorktreeFile} vs worktreeDirs: Uri[]
    // assert(_.values(ctrl.worktree).every(item => item.file.type !== 'dir'));
    // assert(!targetUris || targetUris.every(uri => ctrl.worktree[uri]?.file.type !== 'dir'));

    // all text editor tabs that are not in ctrl's textEditors should be closed
    for (const tabGroup of vscode.window.tabGroups.all) {
      for (const tab of tabGroup.tabs) {
        if (tab.input instanceof vscode.TabInputText && this.shouldRecordVscUri(tab.input.uri)) {
          const uri = this.uriFromVsc(tab.input.uri);
          if (!ctrl.findTextEditorByUri(uri)) await this.closeVscTabInputText(tab, true);
        }
      }
    }

    // Make sure workspace path exists.
    await fs.promises.mkdir(this.workspace, { recursive: true });

    if (targetUris) {
      // all files in targetUris that are no longer in ctrl's worktree should be deleted
      for (const targetUri of targetUris) {
        if (!ctrl.doesUriExist(targetUri)) {
          if (path.isWorkspaceUri(targetUri)) {
            await fs.promises.rm(path.getFileUriPath(this.resolveUri(targetUri)), { force: true });
          }
        }
      }
    } else {
      // all files in workspace that are not in ctrl's worktree should be deleted
      const workspaceFiles = await this.readDirRecursively({ includeFiles: true });
      for (const file of workspaceFiles) {
        const uri = path.workspaceUriFromRelPath(file);
        if (!ctrl.doesUriExist(uri)) {
          await fs.promises.rm(path.join(this.workspace, file), { force: true });
        }
      }

      // set targetUris to all known uris in ctrl
      targetUris = ctrl.getWorktreeUris();
    }

    // for now, just delete empty directories
    {
      const dirs = await this.readDirRecursively({ includeDirs: true });
      const workspaceUriPaths = ctrl.getWorktreeUris().filter(path.isWorkspaceUri).map(path.getWorkspaceUriPath);
      for (const dir of dirs) {
        const dirIsEmpty = !workspaceUriPaths.some(p => path.isBaseOf(dir, p));
        if (dirIsEmpty) await fs.promises.rm(path.join(this.workspace, dir), { force: true, recursive: true });
      }
    }

    // for each targetUri
    //   if it doesn't exist in ctrl.worktree, it's already been deleted above, so ignore it
    //   if there's a text editor open in vscode, replace its content
    //   else, mkdir and write to file
    // NOTE: changing documents with WorkspaceEdit without immediately savig them causes them to be
    //       opened even if they did not have an associated editor.
    {
      const targetUrisOutsideVsc: t.Uri[] = [];
      const edit = new vscode.WorkspaceEdit();
      for (const targetUri of targetUris) {
        if (!ctrl.doesUriExist(targetUri)) continue;

        let vscTextDocument: vscode.TextDocument | undefined;
        if (path.isUntitledUri(targetUri)) {
          vscTextDocument = await vscode.workspace.openTextDocument(targetUri);
        } else if (this.findTabInputTextByUri(targetUri)) {
          vscTextDocument = this.findVscTextDocumentByUri(targetUri);
        }

        if (vscTextDocument) {
          const text = new TextDecoder().decode(await ctrl.getContentByUri(targetUri));
          edit.replace(vscTextDocument.uri, this.getVscTextDocumentRange(vscTextDocument), text);
        } else {
          targetUrisOutsideVsc.push(targetUri);
        }
      }
      await vscode.workspace.applyEdit(edit);

      // untitled uris have been opened above and not included in targetUrisOutsideVsc.
      for (const targetUri of targetUrisOutsideVsc) {
        assert(path.isWorkspaceUri(targetUri));
        const data = await ctrl.getContentByUri(targetUri);
        const absPath = path.getFileUriPath(this.resolveUri(targetUri));
        await fs.promises.mkdir(path.dirname(absPath), { recursive: true });
        await fs.promises.writeFile(absPath, data);
      }
    }

    // open all ctrl's textEditors in vscdoe
    {
      const tabUris = this.getRelevantTabUris();
      for (const textEditor of ctrl.textEditors) {
        if (!tabUris.includes(textEditor.document.uri)) {
          const vscUri = this.uriToVsc(textEditor.document.uri);
          await vscode.window.showTextDocument(vscUri, {
            preview: false,
            preserveFocus: true,
            selection: textEditor.selections[0],
            viewColumn: vscode.ViewColumn.One,
          });
        }
      }
    }

    // show this.activeTextEditor
    if (ctrl.activeTextEditor) {
      const vscUri = this.uriToVsc(ctrl.activeTextEditor.document.uri);
      await vscode.window.showTextDocument(vscUri, {
        preview: false,
        preserveFocus: false,
        selection: ctrl.activeTextEditor.selections[0],
        viewColumn: vscode.ViewColumn.One,
      });
    }
  }

  async saveAllRelevantVscTabs() {
    const uris = this.getRelevantTabVscUris();
    for (const uri of uris) {
      const vscTextDocument = this.findVscTextDocumentByVscUri(uri);
      await vscTextDocument?.save();
    }
  }

  /**
   * Will ask for confirmation.
   */
  async closeIrrelevantVscTabs() {
    for (const tabGroup of vscode.window.tabGroups.all) {
      for (const tab of tabGroup.tabs) {
        if (tab.input instanceof vscode.TabInputText && !this.shouldRecordVscUri(tab.input.uri)) {
          await this.closeVscTabInputText(tab);
        }
      }
    }
  }

  async write() {
    await this.writeHead();
    if (this.body) await this.writeBody();
  }

  async writeHead() {
    await storage.writeJSON(this.sessionDataPaths.head, this.head);
    this.inStorage = true;
  }

  async writeBody() {
    assert(this.body, 'writeBody: body is not yet loaded.');
    await storage.writeJSON(this.sessionDataPaths.body, this.body);
    this.inStorage = true;
  }

  async writeHistory(update?: (history: t.SessionHistory) => t.SessionHistory) {
    const { id } = this.head;
    const { settings } = this.context;
    if (update) {
      settings.history[id] = update(settings.history[id] ?? { id, workspace: this.workspace });
    }
    await storage.writeJSON(this.context.dataPaths.settings, settings);
  }

  async readBody(options?: { download: boolean }) {
    if (options?.download) await this.download({ skipIfExists: true });
    const json = await storage.readJSON<t.SessionBody>(this.sessionDataPaths.body);

    this.body = {
      audioTracks: json.audioTracks,
      videoTracks: json.videoTracks,
      editorTrack: {
        defaultEol: json.editorTrack.defaultEol,
        focusTimeline: json.editorTrack.focusTimeline,
        initSnapshot: {
          worktree: json.editorTrack.initSnapshot.worktree,
          activeTextEditorUri: json.editorTrack.initSnapshot.activeTextEditorUri,
          textEditors: json.editorTrack.initSnapshot.textEditors.map(x => ({
            selections: x.selections.map(
              s => new Selection(s.anchor.line, s.anchor.character, s.active.line, s.active.character),
            ),
            uri: x.uri,
            visibleRange: new Range(x.visibleRange.start, x.visibleRange.end),
          })),
        },
        events: json.editorTrack.events.map(e => {
          switch (e.type) {
            case 'textChange':
              return {
                ...e,
                contentChanges: e.contentChanges.map(
                  cc => new ContentChange(cc.text, new Range(cc.range.start, cc.range.end)),
                ),
                revContentChanges: e.revContentChanges.map(
                  cc => new ContentChange(cc.text, new Range(cc.range.start, cc.range.end)),
                ),
              };
            case 'openTextDocument':
            case 'closeTextDocument':
              return e;
            case 'showTextEditor':
              return {
                ...e,
                selections: e.selections.map(
                  s => new Selection(s.anchor.line, s.anchor.character, s.active.line, s.active.character),
                ),
                visibleRange: new Range(e.visibleRange.start, e.visibleRange.end),
                revSelections:
                  e.revSelections &&
                  e.revSelections.map(
                    s => new Selection(s.anchor.line, s.anchor.character, s.active.line, s.active.character),
                  ),
                revVisibleRange: e.revVisibleRange && new Range(e.revVisibleRange.start, e.revVisibleRange.end),
              };
            case 'closeTextEditor':
              return {
                ...e,
                revSelections:
                  e.revSelections &&
                  e.revSelections.map(
                    s => new Selection(s.anchor.line, s.anchor.character, s.active.line, s.active.character),
                  ),
                revVisibleRange: e.revVisibleRange && new Range(e.revVisibleRange.start, e.revVisibleRange.end),
              };
            case 'select':
              return {
                ...e,
                selections: e.selections.map(
                  s => new Selection(s.anchor.line, s.anchor.character, s.active.line, s.active.character),
                ),
                visibleRange: new Range(e.visibleRange.start, e.visibleRange.end),
                revSelections:
                  e.revSelections &&
                  e.revSelections.map(
                    s => new Selection(s.anchor.line, s.anchor.character, s.active.line, s.active.character),
                  ),
                revVisibleRange: e.revVisibleRange && new Range(e.revVisibleRange.start, e.revVisibleRange.end),
              };
            case 'scroll':
              return {
                ...e,
                visibleRange: new Range(e.visibleRange.start, e.visibleRange.end),
                revVisibleRange: e.revVisibleRange && new Range(e.revVisibleRange.start, e.revVisibleRange.end),
              };
            case 'save':
              return e;
          }
        }),
      },
    };
  }

  async download(options?: { skipIfExists: boolean }) {
    if (options?.skipIfExists && (await misc.fileExists(this.sessionDataPaths.body))) return;

    await serverApi.downloadSession(this.head.id, this.sessionDataPaths.zip, this.context.user?.token);
    // For some reason when stream.pipeline() resolves, the extracted files have not
    // yet been written. So we have to wait on out.promise().
    const out = unzipper.Extract({ path: this.sessionDataPaths.root, verbose: true });
    await stream.promises.pipeline(fs.createReadStream(this.sessionDataPaths.zip), out);
    await out.promise();
  }

  async writeFileIfNotExists(uri: t.Uri, text: string) {
    const absPath = path.getFileUriPath(this.resolveUri(uri));

    if (!(await misc.fileExists(absPath))) {
      await fs.promises.writeFile(absPath, text);
    }
  }

  async readBlob(sha1: string): Promise<Uint8Array> {
    return fs.promises.readFile(this.sessionDataPaths.blob(sha1));
  }

  async writeBlob(sha1: string, data: string | NodeJS.ArrayBufferView) {
    await fs.promises.writeFile(this.sessionDataPaths.blob(sha1), data, 'utf8');
  }

  async readFile(file: t.File): Promise<Uint8Array> {
    if (file.type === 'local') {
      return this.readBlob(file.sha1);
    } else {
      throw new Error(`TODO readFile ${file.type}`);
    }
  }

  async copyToBlob(src: t.AbsPath, sha1: string) {
    await fs.promises.cp(src, this.sessionDataPaths.blob(sha1), { recursive: true });
  }

  async delete() {
    await fs.promises.rm(this.sessionDataPaths.root, { force: true, recursive: true });
    delete this.context.settings.history[this.head.id];
    await storage.writeJSON(this.context.dataPaths.settings, this.context.settings);
  }

  async package() {
    assert(await misc.fileExists(this.sessionDataPaths.body), "Session body doesn't exist");

    return new Promise<t.AbsPath>((resolve, reject) => {
      // const packagePath = path.abs(os.tmpdir(), this.head.id + '.zip');

      const output = fs.createWriteStream(this.sessionDataPaths.zip);
      const archive = archiver('zip', { zlib: { level: 9 } });

      // 'close' event is fired only when a file descriptor is involved
      output.on('close', () => {
        resolve(this.sessionDataPaths.zip);
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
      if (this.head.hasCoverPhoto) {
        archive.file(this.sessionDataPaths.coverPhoto, { name: path.basename(this.sessionDataPaths.coverPhoto) });
      }
      archive.file(this.sessionDataPaths.body, { name: path.basename(this.sessionDataPaths.body) });
      archive.directory(this.sessionDataPaths.blobs, path.basename(this.sessionDataPaths.blobs));
      archive.finalize();
    });
  }

  async publish() {
    const zip = await this.package();
    const res = await serverApi.publishSession(this.head, zip, this.context.user?.token);
    this.head = res;
    await this.write();
  }

  shouldRecordVscUri(vscUri: vscode.Uri): boolean {
    switch (vscUri.scheme) {
      case 'file':
        return path.isBaseOf(this.workspace, path.abs(vscUri.path));
      case 'untitled':
        return true;
      default:
        return false;
    }
  }

  getVscTextDocumentRange(document: vscode.TextDocument): Range {
    return document.validateRange(new Range(0, 0, document.lineCount, 0));
  }

  uriFromVsc(vscUri: vscode.Uri): t.Uri {
    switch (vscUri.scheme) {
      case 'file':
        return path.workspaceUriFromAbsPath(this.workspace, path.abs(vscUri.path));
      case 'untitled':
        return path.untitledUriFromName(vscUri.path);
      default:
        throw new Error(`uriFromVsc: unknown scheme: ${vscUri.scheme}`);
    }
  }

  uriToVsc(uri: t.Uri): vscode.Uri {
    return vscode.Uri.parse(this.resolveUri(uri));
  }

  resolveUri(uri: t.Uri): t.Uri {
    return path.resolveUri(this.workspace, uri);
  }

  eolFromVsc(eol: vscode.EndOfLine): t.EndOfLine {
    return eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
  }

  // findVscTextDocumentByAbsPath(p: t.AbsPath): vscode.TextDocument | undefined {
  //   return vscode.workspace.textDocuments.find(d => d.uri.scheme === 'file' && d.uri.path === p);
  // }

  findTabInputTextByUri(uri: t.Uri): vscode.Tab | undefined {
    return this.findTabInputTextByVscUri(this.uriToVsc(uri));
  }

  findTabInputTextByVscUri(uri: vscode.Uri): vscode.Tab | undefined {
    for (const tabGroup of vscode.window.tabGroups.all) {
      for (const tab of tabGroup.tabs) {
        if (tab.input instanceof vscode.TabInputText && tab.input.uri.toString() === uri.toString()) {
          return tab;
        }
      }
    }
  }

  findVscTextDocumentByUri(uri: t.Uri): vscode.TextDocument | undefined {
    return this.findVscTextDocumentByVscUri(this.uriToVsc(uri));
  }

  findVscTextDocumentByVscUri(uri: vscode.Uri): vscode.TextDocument | undefined {
    const uriStr = uri.toString();
    return vscode.workspace.textDocuments.find(d => d.uri.toString() === uriStr);
  }

  findVscTextEditorByUri(textEditors: readonly vscode.TextEditor[], uri: t.Uri): vscode.TextEditor | undefined {
    return this.findVscTextEditorByVscUri(textEditors, this.uriToVsc(uri));
  }

  findVscTextEditorByVscUri(textEditors: readonly vscode.TextEditor[], uri: vscode.Uri): vscode.TextEditor | undefined {
    const uriStr = uri.toString();
    return textEditors.find(x => x.document.uri.toString() === uriStr);
  }

  textDocumentFromVsc(vscTextDocument: vscode.TextDocument, uri: t.Uri): InternalTextDocument {
    return new InternalTextDocument(
      uri,
      _.times(vscTextDocument.lineCount, i => vscTextDocument.lineAt(i).text),
      this.eolFromVsc(vscTextDocument.eol),
    );
  }

  async closeVscTextEditorByUri(uri: t.Uri, skipConfirmation: boolean = false) {
    uri = this.resolveUri(uri);
    for (const tabGroup of vscode.window.tabGroups.all) {
      for (const tab of tabGroup.tabs) {
        if (tab.input instanceof vscode.TabInputText && tab.input.uri.toString() === uri) {
          this.closeVscTabInputText(tab, skipConfirmation);
        }
      }
    }
  }

  async closeVscTabInputText(tab: vscode.Tab, skipConfirmation: boolean = false) {
    assert(tab.input instanceof vscode.TabInputText);

    if (skipConfirmation) {
      const vscTextDocument = await vscode.workspace.openTextDocument(tab.input.uri);
      // .save() returns false if document was not dirty
      if (vscTextDocument.isDirty) {
        if (tab.input.uri.scheme === 'untitled') {
          // for untitled scheme, empty it first, then can close without confirmation
          const edit = new vscode.WorkspaceEdit();
          edit.replace(vscTextDocument.uri, this.getVscTextDocumentRange(vscTextDocument), '');
          await vscode.workspace.applyEdit(edit);
          // TODO We're gonna skip closing it for now. We must use unnamed untitled document
          // to prevent vscode from showing the confirmation dialog when the content is empty.
          // See the TODOs in notes.
          return;
        } else if (tab.input.uri.scheme === 'file') {
          // Sometimes .save() fails and returns false. No idea why.
          for (let i = 0; i < 5; i++) {
            if (await vscTextDocument.save()) break;
            console.error('closeVscTabInputText Failed to save:', tab.input.uri.toString());
            await lib.timeout(100 * i + 100);
          }
        }
      }
    }

    // Sometimes when save() fails the first time, closing the tab throws this error:
    // Error: Tab close: Invalid tab not found!
    // Maybe it automatically closes it? I don't know.
    const newTab = this.findTabInputTextByVscUri(tab.input.uri);
    if (newTab) await vscode.window.tabGroups.close(newTab);
  }

  // makeTextEditorSnapshotFromVsc(vscTextEditor: vscode.TextEditor): t.TextEditor {
  //   return ih.makeTextEditorSnapshot(
  //     this.uriFromVsc(vscTextEditor.document.uri),
  //     this.selectionsFromVsc(vscTextEditor.selections),
  //     this.rangeFromVsc(vscTextEditor.visibleRanges[0]),
  //   );
  // }

  getRelevantTabUris(): t.Uri[] {
    return this.getRelevantTabVscUris().map(this.uriFromVsc.bind(this));
  }

  getRelevantTabVscUris(): vscode.Uri[] {
    const uris: vscode.Uri[] = [];
    for (const tabGroup of vscode.window.tabGroups.all) {
      for (const tab of tabGroup.tabs) {
        if (tab.input instanceof vscode.TabInputText && this.shouldRecordVscUri(tab.input.uri)) {
          uris.push(tab.input.uri);
        }
      }
    }
    return uris;
  }

  async askToOverwriteWorkspace(): Promise<boolean> {
    const overwriteTitle = 'Overwrite';
    const answer = await vscode.window.showWarningMessage(
      `"${this.workspace}" is not empty. Do you want to overwrite it?`,
      {
        modal: true,
        detail: 'All files in the folder will be overwritten except for those specified in .codemicignore.',
      },
      { title: overwriteTitle },
      { title: 'Cancel', isCloseAffordance: true },
    );
    return answer?.title === overwriteTitle;
  }

  async askAndCreateWorkspace(): Promise<boolean> {
    const createPathTitle = 'Create path';
    const answer = await vscode.window.showWarningMessage(
      `"${this.workspace}" does not exist. Do you want to create it?`,
      { modal: true },
      { title: createPathTitle },
      { title: 'Cancel', isCloseAffordance: true },
    );
    return answer?.title === createPathTitle;
  }

  async askToCreateOrOverwriteWorkspace(scanning: boolean): Promise<boolean> {
    // user confirmations and workspace directory creation
    try {
      const files = await fs.promises.readdir(this.workspace);
      return files.length === 0 || scanning || (await this.askToOverwriteWorkspace());
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        // workspace doesn't exist. Ask user if they want to create it.
        return this.askAndCreateWorkspace();
      } else if (code === 'ENOTDIR') {
        // Exists, but it's not a directory
        vscode.window.showErrorMessage(`"${this.workspace}" exists but is not a folder.`);
      }
      return false;
    }
  }

  async updateWorkspaceFolder(): Promise<boolean> {
    // const history = this.db.settings.history[this.playerSetup.head.id];
    if (misc.getDefaultVscWorkspace() === this.workspace) return true;

    // return vscode.workspace.updateWorkspaceFolders(0, vscode.workspace.workspaceFolders?.length ?? 0, {
    //   uri: vscode.Uri.file(this.workspace),
    //   name: sessionTitle,
    // });
    const disposables: vscode.Disposable[] = [];
    const done = new Promise(resolve => {
      vscode.workspace.onDidChangeWorkspaceFolders(() => resolve(undefined), undefined, disposables);
    });

    const success = vscode.workspace.updateWorkspaceFolders(0, vscode.workspace.workspaceFolders?.length ?? 0, {
      uri: vscode.Uri.file(this.workspace),
      // name: sessionTitle,
    });

    await done;
    for (const d of disposables) d.dispose();

    return success;
  }

  // async makeWorkspace() {
  //   await fs.promises.mkdir(this.workspace, { recursive: true });
  // }

  getTrackFileWebviewUri(trackFile: t.RangedTrackFile): t.Uri {
    assert(trackFile.file.type === 'local');
    const vscUri = vscode.Uri.file(this.sessionDataPaths.blob(trackFile.file.sha1));
    return this.context.view!.webview.asWebviewUri(vscUri).toString();
  }

  getCoverPhotoWebviewUri(): string {
    if (this.inStorage) {
      return Session.getCoverPhotoWebviewUri(this.context, this.head.id);
    } else {
      return serverApi.getSessionCoverPhotoURLString(this.head.id);
    }
  }

  getBlobsWebviewUris(): t.WebviewUris | undefined {
    if (this.body) {
      return Object.fromEntries(
        _.concat(
          this.body.audioTracks.map(t => [t.id, this.getTrackFileWebviewUri(t)]),
          this.body.videoTracks.map(t => [t.id, this.getTrackFileWebviewUri(t)]),
        ),
      );
    }
  }
}

export default Session;
