import { types as t, path, internalEditorTrackCtrl as ietc, lib, assert } from '@codecast/lib';
import * as serverApi from '../server_api.js';
import type { SessionDataPaths } from '../paths.js';
import * as misc from '../misc.js';
import type { Context, ReadDirOptions, SessionCtrls } from '../types.js';
import * as storage from '../storage.js';
import SessionTracksCtrl from './session_tracks_ctrl.js';
import CombinedEditorTrackPlayer from './combined_editor_track_player.js';
import CombinedEditorTrackRecorder from './combined_editor_track_recorder.js';
import AudioTrackCtrl from './audio_track_ctrl.js';
import VideoTrackCtrl from './video_track_ctrl.js';
import VscEditorEventStepper from './vsc_editor_event_stepper.js';
import fs from 'fs';
import _ from 'lodash';
import archiver from 'archiver';
import unzipper from 'unzipper';
import stream from 'stream';
import os from 'os';
import * as vscode from 'vscode';
import { v4 as uuid } from 'uuid';
import { SessionSummary } from '@codecast/lib/src/types.js';

export class Session implements t.Session {
  context: Context;
  workspace: t.AbsPath;
  summary: t.SessionSummary;
  loaded = false;
  body?: t.SessionBody;
  ctrls?: SessionCtrls;

  // editorPlayer?: CombinedEditorTrackPlayer;
  // editorRecorder?: CombinedEditorTrackRecorder;
  // audioCtrls?: AudioCtrl[];

  constructor(context: Context, workspace: t.AbsPath, summary: t.SessionSummary) {
    this.context = context;
    this.workspace = workspace;
    this.summary = summary;
  }

  get sessionDataPaths(): SessionDataPaths {
    return this.context.dataPaths.session(this.summary.id);
  }

  get clock(): number | undefined {
    return this.ctrls?.sessionTracksCtrl.clock;
  }

  get running(): boolean {
    return Boolean(this.ctrls?.sessionTracksCtrl.running);
  }

  get recording(): boolean {
    return Boolean(this.running && this.ctrls?.sessionTracksCtrl.mode.recordingEditor);
  }

  get playing(): boolean {
    return Boolean(this.running && !this.ctrls?.sessionTracksCtrl.mode.recordingEditor);
  }

  static async fromExisting(context: Context, id: string): Promise<Session | undefined> {
    const workspace = Session.getWorkspace(context, id);
    const summary = await Session.summaryFromExisting(context, id);
    return summary && new Session(context, workspace, summary);
  }

  static async summaryFromExisting(context: Context, id: string): Promise<SessionSummary | undefined> {
    const summaryPath = context.dataPaths.session(id).summary;
    return storage.readJSONOptional<t.SessionSummary>(summaryPath);
  }

  static async fromNew(context: Context, workspace: t.AbsPath, summary: t.SessionSummary): Promise<Session> {
    return new Session(context, workspace, summary);
  }

  static getWorkspace(context: Context, id: string): t.AbsPath {
    return context.settings.history[id]?.workspace ?? context.defaultWorkspacePaths.session(id).root;
  }

  static makeNewSummary(author?: t.UserSummary): t.SessionSummary {
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
    };
  }

  static async fromFork(
    context: Context,
    baseId: string,
    options?: { author?: t.UserSummary },
  ): Promise<Session | undefined> {
    const base = await Session.fromExisting(context, baseId);
    if (base) {
      const summary = await base.fork(options);
      return Session.fromExisting(context, summary.id);
    }
  }

  // static makeEditSummary(base: t.SessionSummary, author?: t.UserSummary): t.SessionSummary {
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
    await this.initTrackCtrls();
    assert(this.ctrls);

    // Make sure cut and seek clocks are valid.
    if (options?.cutClock && options?.seekClock) {
      assert(options.cutClock >= options.seekClock);
    }

    // Cut to cutClock.
    if (options?.cutClock !== undefined) {
      // We don't need to cut audio because playback ends when it reaches session's duration.
      this.ctrls.internalEditorTrackCtrl.cut(options.cutClock);
      // for (const c of this.ctrls.audioTrackCtrls) c.cut(options.cutClock);
      this.summary.duration = options.cutClock;
    }

    // Seek to seekClock.
    let targetUris: t.Uri[] | undefined;
    if (options?.seekClock) {
      const uriSet: t.UriSet = {};
      const seekData = this.ctrls.internalEditorTrackCtrl.getSeekData(options.seekClock);
      await this.ctrls.internalEditorTrackCtrl.seek(seekData, uriSet);
      targetUris = Object.keys(uriSet);
    }

    // Sync and save.
    await this.syncInternalEditorTrackToVscodeAndDisk(targetUris);
    await this.saveAllRelevantVscTabs();

    // Loaded.
    this.loaded = true;
  }

  async scan() {
    assert(!this.loaded);

    this.body = Session.makeBody();
    await this.initTrackCtrls();
    assert(this.ctrls);

    // Make sure workspace path exists.
    await fs.promises.mkdir(this.workspace, { recursive: true });

    this.body.editorTrack.initSnapshot = await this.makeSnapshotFromDirAndVsc();
    await this.ctrls.internalEditorTrackCtrl.restoreInitSnapshot();

    this.loaded = true;
  }

  async fork(options?: { author?: t.UserSummary }): Promise<t.SessionSummary> {
    await this.download({ skipIfExists: true });
    const forkSummary: t.SessionSummary = {
      id: uuid(),
      title: `Fork: ${this.summary.title}`,
      description: this.summary.description,
      author: options?.author ?? this.summary.author,
      duration: this.summary.duration,
      views: 0,
      likes: 0,
      publishTimestamp: undefined,
      modificationTimestamp: this.summary.modificationTimestamp,
      toc: this.summary.toc,
      forkedFrom: this.summary.id,
    };

    // Copy the entire session data, then rewrite the summary.
    const forkSessionDataPaths = this.context.dataPaths.session(forkSummary.id);
    await fs.promises.cp(this.sessionDataPaths.root, forkSessionDataPaths.root, { recursive: true });
    await storage.writeJSON(forkSessionDataPaths.summary, forkSummary);

    return forkSummary;
  }

  async initTrackCtrls() {
    assert(this.body);
    assert(!this.ctrls);
    this.ctrls = {
      internalEditorTrackCtrl: await ietc.InternalEditorTrackCtrl.fromSession(this),
      audioTrackCtrls: this.body.audioTracks.map(audioTrack => new AudioTrackCtrl(this, audioTrack)),
      videoTrackCtrl: new VideoTrackCtrl(this),
      // videoTrackCtrl: new VideoTrackCtrl(this),
      combinedEditorTrackPlayer: new CombinedEditorTrackPlayer(this),
      combinedEditorTrackRecorder: new CombinedEditorTrackRecorder(this),
      vscEditorEventStepper: new VscEditorEventStepper(this),
      sessionTracksCtrl: new SessionTracksCtrl(this),
    };
    this.ctrls.sessionTracksCtrl.init();
  }

  async makeSnapshotFromDirAndVsc(): Promise<t.InternalEditorTrackSnapshot> {
    // for (const vscTextDocument of vscode.workspace.textDocuments) {
    //   if (vscTextDocument.dirty) {
    //     throw new Error('Checkpoint.fromWorkspace: there are unsaved files in the current workspace.');
    //   }
    // }

    // Create the worktree and copy files to session directory.
    // TODO: ignore files in .codecastignore
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
        textEditors.push(ietc.makeTextEditorSnapshot(uri));
      } else if (vscUri.scheme === 'file') {
        if (!(await misc.fileExists(path.abs(vscUri.path)))) {
          // File is deleted but the text editor is still there. Ignore it.
          continue;
        }

        // We can only set selection and visible range if we have the vscTextEditor
        const vscTextEditor = this.findVscTextEditorByVscUri(vscode.window.visibleTextEditors, vscUri);
        if (vscTextEditor) {
          textEditors.push(this.makeTextEditorSnapshotFromVsc(vscTextEditor));
        } else {
          textEditors.push(ietc.makeTextEditorSnapshot(uri));
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

  async syncInternalEditorTrackToVscodeAndDisk(targetUris?: t.Uri[]) {
    // Vscode does not let us close a TextDocument. We can only close tabs and tab groups.
    const ctrl = this.ctrls?.internalEditorTrackCtrl;
    assert(ctrl);

    // TODO having both directories and files in targetUris and ctrl.worktree can make things
    //      a bit confusing. Especially when it comes to deleting directories when there's
    //      still a file inside but is supposed to be ignored according to .codecastignore
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
    //   if there's a textDocument open in vscode, replace its content
    //   else, mkdir and write to file
    {
      const targetUrisOutsideVsc: t.Uri[] = [];
      const edit = new vscode.WorkspaceEdit();
      for (const targetUri of targetUris) {
        if (!ctrl.doesUriExist(targetUri)) continue;

        let vscTextDocument: vscode.TextDocument | undefined;
        if (path.isUntitledUri(targetUri)) {
          vscTextDocument = await vscode.workspace.openTextDocument(targetUri);
        } else {
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
            selection: this.selectionToVsc(textEditor.selections[0]),
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
        selection: this.selectionToVsc(ctrl.activeTextEditor.selections[0]),
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

  async write() {
    await this.writeSummary();
    if (this.body) await this.writeBody();
  }

  async writeSummary() {
    await storage.writeJSON(this.sessionDataPaths.summary, this.summary);
  }

  async writeBody() {
    assert(this.body, 'writeBody: body is not yet loaded.');
    await storage.writeJSON(this.sessionDataPaths.body, this.body);
  }

  async writeHistory(update?: (history: t.SessionHistory) => t.SessionHistory) {
    const { id } = this.summary;
    const { settings } = this.context;
    if (update) {
      settings.history[id] = update(settings.history[id] ?? { id, workspace: this.workspace });
    }
    await storage.writeJSON(this.context.dataPaths.settings, settings);
  }

  async readBody(options?: { download: boolean }) {
    if (options?.download) await this.download({ skipIfExists: true });
    this.body = await storage.readJSON<t.SessionBody>(this.sessionDataPaths.body);
  }

  async download(options?: { skipIfExists: boolean }) {
    if (options?.skipIfExists && (await misc.fileExists(this.sessionDataPaths.body))) return;

    await serverApi.downloadSession(this.summary.id, this.sessionDataPaths.zip, this.context.user?.token);
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
    delete this.context.settings.history[this.summary.id];
    await storage.writeJSON(this.context.dataPaths.settings, this.context.settings);
  }

  async package() {
    assert(await misc.fileExists(this.sessionDataPaths.body), "Session body doesn't exist");

    return new Promise<t.AbsPath>((resolve, reject) => {
      // const packagePath = path.abs(os.tmpdir(), this.summary.id + '.zip');

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
      archive.file(this.sessionDataPaths.body, { name: path.basename(this.sessionDataPaths.body) });
      archive.directory(this.sessionDataPaths.blobs, path.basename(this.sessionDataPaths.blobs));
      archive.finalize();
    });
  }

  async publish() {
    const zip = await this.package();
    const res = await serverApi.publishSession(this.summary, zip, this.context.user?.token);
    this.summary = res;
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

  selectionsFromVsc(selections: readonly vscode.Selection[]): t.Selection[] {
    return selections.map(s => this.selectionFromVsc(s));
  }

  selectionFromVsc(selection: vscode.Selection): t.Selection {
    return ietc.makeSelection(this.positionFromVsc(selection.anchor), this.positionFromVsc(selection.active));
  }

  rangeFromVsc(range: vscode.Range): t.Range {
    return ietc.makeRange(this.positionFromVsc(range.start), this.positionFromVsc(range.end));
  }

  positionFromVsc(position: vscode.Position): t.Position {
    return ietc.makePosition(position.line, position.character);
  }

  selectionsToVsc(selections: t.Selection[]): vscode.Selection[] {
    return selections.map(s => this.selectionToVsc(s));
  }

  selectionToVsc(selection: t.Selection): vscode.Selection {
    return new vscode.Selection(this.positionToVsc(selection.anchor), this.positionToVsc(selection.active));
  }

  rangeToVsc(range: t.Range): vscode.Range {
    return new vscode.Range(this.positionToVsc(range.start), this.positionToVsc(range.end));
  }

  positionToVsc(position: t.Position): vscode.Position {
    return new vscode.Position(position.line, position.character);
  }

  contentChangesFromVsc(contentChanges: readonly vscode.TextDocumentContentChangeEvent[]): t.ContentChange[] {
    return contentChanges.map(cc => this.contentChangeFromVsc(cc));
  }

  contentChangeFromVsc(contentChange: vscode.TextDocumentContentChangeEvent): t.ContentChange {
    return ietc.makeContentChange(contentChange.text, this.rangeFromVsc(contentChange.range));
  }

  getVscTextDocumentRange(document: vscode.TextDocument): vscode.Range {
    return document.validateRange(new vscode.Range(0, 0, document.lineCount, 0));
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

  textDocumentFromVsc(vscTextDocument: vscode.TextDocument, uri: t.Uri): ietc.TextDocument {
    return new ietc.TextDocument(
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
        await vscTextDocument.save();
      }
    }
    await vscode.window.tabGroups.close(tab);
  }

  makeTextEditorSnapshotFromVsc(vscTextEditor: vscode.TextEditor): t.TextEditor {
    return ietc.makeTextEditorSnapshot(
      this.uriFromVsc(vscTextEditor.document.uri),
      this.selectionsFromVsc(vscTextEditor.selections),
      this.rangeFromVsc(vscTextEditor.visibleRanges[0]),
    );
  }

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
        detail: 'All files in the folder will be overwritten except for those specified in .codecastignore.',
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
    // const history = this.db.settings.history[this.playerSetup.summary.id];
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

  getWebviewUris(): t.WebviewUris | undefined {
    if (this.body) {
      return Object.fromEntries(
        _.concat(this.body.audioTracks, this.body.videoTracks).map(t => [t.id, this.getTrackFileWebviewUri(t)]),
      );
    }
  }
}

export default Session;
