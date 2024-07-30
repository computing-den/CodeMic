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
  onDisk: boolean;
  body?: t.SessionBody;
  ctrls?: SessionCtrls;

  // editorPlayer?: CombinedEditorTrackPlayer;
  // editorRecorder?: CombinedEditorTrackRecorder;
  // audioCtrls?: AudioCtrl[];

  constructor(context: Context, workspace: t.AbsPath, summary: t.SessionSummary, onDisk: boolean) {
    this.context = context;
    this.workspace = workspace;
    this.summary = summary;
    this.onDisk = onDisk;
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
    return summary && new Session(context, workspace, summary, true);
  }

  static async summaryFromExisting(context: Context, id: string): Promise<SessionSummary | undefined> {
    const summaryPath = context.dataPaths.session(id).summary;
    return storage.readJSONOptional<t.SessionSummary>(summaryPath);
  }

  static async fromNew(context: Context, summary: t.SessionSummary): Promise<Session> {
    const workspace = misc.getDefaultVscWorkspace();
    // TODO ask user to select a workspace
    assert(workspace);
    return new Session(context, workspace, summary, false);
  }

  static getWorkspace(context: Context, id: string): t.AbsPath {
    return context.settings.history[id]?.workspace ?? context.defaultWorkspacePaths.session(id).root;
  }

  // static async askForRoot(title: string): Promise<t.AbsPath | undefined> {
  //   const options = {
  //     canSelectFiles: false,
  //     canSelectFolders: true,
  //     canSelectMany: false,
  //     defaultUri: vscode.workspace.workspaceFolders?.[0]?.uri,
  //     title,
  //   };
  //   const uris = await vscode.window.showOpenDialog(options);
  //   if (uris?.length === 1) {
  //     return path.abs(uris[0].path);
  //   }
  // }

  static async setUpWorkspace(
    context: Context,
    // state: WorkspaceChangeGlobalState,
    options?: { afterRestart: boolean },
  ): Promise<Session | undefined> {
    throw new Error('TODO set up session tracks ctrl and workspace');
    // let root = state.setup.root ? path.abs(state.setup.root) : undefined;

    // if (!options?.afterRestart) {
    //   root = root || (await Session.askForRoot(`Select a workspace`));
    //   if (!root) return;

    //   const workspace = new Session(context, root);
    //   if (!(await workspace.askToCreateOrOverwriteWorkspace(Boolean(state.setup.isNew)))) return;
    //   await workspace.makeRoot();

    //   state.setup.root = root;
    //   Session.setWorkspaceChangeGlobalState(context.extension, state);
    //   await workspace.updateWorkspaceFolder();
    //   Session.setWorkspaceChangeGlobalState(context.extension, undefined);
    // }

    // if (root && Session.getDefaultVscWorkspace() === root) {
    //   return new Session(root);
    // }

    // if (root) {
    //   vscode.window.showErrorMessage(`Could not change the workspace folder to "${root}".`);
    // } else {
    //   vscode.window.showErrorMessage('No workspace folder was selected.');
    // }
  }

  static makeNewSummary(author?: t.UserSummary): t.SessionSummary {
    return {
      id: uuid(),
      title: '',
      description: '',
      author,
      published: false,
      duration: 0,
      views: 0,
      likes: 0,
      modificationTimestamp: new Date().toISOString(), // will be overwritten at the end
      toc: [],
    };
  }

  static makeForkSummary(base: t.SessionSummary, clock: number, author?: t.UserSummary): t.SessionSummary {
    return {
      ..._.cloneDeep(base),
      id: uuid(),
      title: `Fork: ${base.title}`,
      duration: clock,
      author,
      forkedFrom: base.id,
    };
  }

  static makeEditSummary(base: t.SessionSummary, author?: t.UserSummary): t.SessionSummary {
    return {
      ..._.cloneDeep(base),
      author,
    };
  }

  static makeBody(): t.SessionBody {
    return {
      editorTrack: {
        events: [],
        defaultEol: os.EOL as t.EndOfLine,
        initSnapshot: {
          worktree: {},
          textEditors: [],
        },
      },
      audioTracks: [],
    };
  }

  async load(options?: { seekClock?: number; cutClock?: number }) {
    assert(this.body);
    // this.workspace = path.abs(nodePath.resolve(rootStr));
    await fs.promises.mkdir(this.workspace, { recursive: true });

    // Initialize track controllers.
    await this.initTrackCtrls();
    assert(this.ctrls);

    // cut it to cutClock.
    if (options?.cutClock !== undefined) this.ctrls.internalEditorTrackCtrl.cut(options.cutClock);

    // seek if necessary
    let targetUris: t.Uri[] | undefined;
    if (options?.seekClock) {
      const uriSet: t.UriSet = {};
      const seekData = this.ctrls.internalEditorTrackCtrl.getSeekData(options.seekClock);
      await this.ctrls.internalEditorTrackCtrl.seek(seekData, uriSet);
      targetUris = Object.keys(uriSet);
    }

    // sync and save
    await this.syncInternalEditorTrackToVscodeAndDisk(targetUris);
    await this.saveAllRelevantVscTabs();

    this.loaded = true;
  }

  async scan() {
    this.body = Session.makeBody();
    await this.initTrackCtrls();
    assert(this.ctrls);

    this.body.editorTrack.initSnapshot = await this.makeSnapshotFromDirAndVsc();
    await this.ctrls.internalEditorTrackCtrl.restoreInitSnapshot();

    this.loaded = true;
  }

  async initTrackCtrls() {
    assert(this.body);
    assert(!this.ctrls);
    this.ctrls = {
      internalEditorTrackCtrl: await ietc.InternalEditorTrackCtrl.fromSession(this),
      audioTrackCtrls: this.body.audioTracks.map(audioTrack => new AudioTrackCtrl(this, audioTrack)),
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
    // TODO: ignore files in .gitignore and .codecastignore
    const worktree: t.Worktree = {};
    const paths = await this.readDirRecursively({ includeFiles: true });
    for (const p of paths) {
      const uri = path.workspaceUriFromRelPath(p);
      const data = await fs.promises.readFile(path.join(this.workspace, p));
      const sha1 = await misc.computeSHA1(data);
      worktree[uri] = { type: 'local', sha1 };
      await this.copyToBlob(path.join(this.workspace, p), sha1);
    }

    // Get textEditors from vscode.window.visibleTextEditors first. These have selections and visible range.
    // Then get the rest from vscode.window.tabGroups. These don't have selections and range.
    const textEditors = vscode.window.visibleTextEditors
      .filter(e => this.shouldRecordVscUri(e.document.uri))
      .map(e => this.makeTextEditorSnapshotFromVsc(e));

    const tabUris = this.getRelevantTabUris();
    for (const uri of tabUris) {
      if (!textEditors.some(e => e.uri === uri)) {
        textEditors.push(ietc.makeTextEditorSnapshot(uri));
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
    //      still a file inside but is supposed to be ignored according to .gitignore or .codecastignore
    //      I think it's best to keep the directory structure in a separate variable than ctrl.worktree
    //      worktreeFiles: {[key: Uri]: WorktreeFile} vs worktreeDirs: Uri[]
    // assert(_.values(ctrl.worktree).every(item => item.file.type !== 'dir'));
    // assert(!targetUris || targetUris.every(uri => ctrl.worktree[uri]?.file.type !== 'dir'));

    // all text editor tabs that are not in ctrl's textEditors should be closed
    for (const tabGroup of vscode.window.tabGroups.all) {
      for (const tab of tabGroup.tabs) {
        if (tab.input instanceof vscode.TabInputText && this.shouldRecordVscUri(tab.input.uri)) {
          const uri = this.uriFromVsc(tab.input.uri);
          if (!ctrl.findTextEditorByUri(uri)) {
            const vscTextDocument = await vscode.workspace.openTextDocument(tab.input.uri);
            await vscTextDocument.save();
            await vscode.window.tabGroups.close(tab);
          }
        }
      }
    }

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
        assert(path.isWorkspaceUri(targetUri), 'TODO currently, we only support workspace URIs');

        if (ctrl.doesUriExist(targetUri)) {
          const vscTextDocument = this.findVscTextDocumentByUri(targetUri);
          if (vscTextDocument) {
            const text = new TextDecoder().decode(await ctrl.getContentByUri(targetUri));
            edit.replace(vscTextDocument.uri, this.getVscTextDocumentRange(vscTextDocument), text);
          } else {
            targetUrisOutsideVsc.push(targetUri);
          }
        }
      }
      await vscode.workspace.applyEdit(edit);

      for (const targetUri of targetUrisOutsideVsc) {
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
    this.onDisk = true;
  }

  async writeBody() {
    assert(this.body, 'writeBody: body is not yet loaded.');
    await storage.writeJSON(this.sessionDataPaths.body, this.body);
    this.onDisk = true;
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

  async readBlob(sha1: string): Promise<Uint8Array> {
    return fs.promises.readFile(this.sessionDataPaths.blob(sha1));
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

  async copy(to: Session) {
    await fs.promises.cp(this.sessionDataPaths.root, to.sessionDataPaths.root, { recursive: true });
  }

  async package() {
    return new Promise((resolve, reject) => {
      // const packagePath = path.abs(os.tmpdir(), this.summary.id + '.zip');

      const output = fs.createWriteStream(this.sessionDataPaths.zip);
      const archive = archiver('zip', { zlib: { level: 9 } });

      // 'close' event is fired only when a file descriptor is involved
      output.on('close', () => {
        resolve(null);
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
    await this.package();
    const res = await serverApi.publishSession(this.summary, this.sessionDataPaths.zip, this.context.user?.token);
    assert(res?.id !== this.summary.id);
    this.summary = res;

    await this.write();
  }

  shouldRecordVscUri(vscUri: vscode.Uri): boolean {
    switch (vscUri.scheme) {
      case 'file':
        return path.isBaseOf(this.workspace, path.abs(vscUri.path));
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
    assert(path.isWorkspaceUri(uri), 'TODO only supports workspace uri');
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
        if (tab.input instanceof vscode.TabInputText) {
          if (tab.input.uri.toString() === uri) {
            if (skipConfirmation) {
              assert(tab.input.uri.scheme === 'file', 'TODO cannot skip save confirmation of non-file documents');
              const vscTextDocument = await vscode.workspace.openTextDocument(tab.input.uri);
              await vscTextDocument.save();
            }
            await vscode.window.tabGroups.close(tab);
          }
        }
      }
    }
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
        detail:
          'All files in the folder will be overwritten except for those specified in .gitignore and .codecastignore.',
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

  async makeWorkspace() {
    await fs.promises.mkdir(this.workspace, { recursive: true });
  }

  getAudioTrackWebviewUri(audioTrack: t.AudioTrack): t.Uri {
    assert(audioTrack.file.type === 'local');
    const vscUri = vscode.Uri.file(this.sessionDataPaths.blob(audioTrack.file.sha1));
    return this.context.view!.webview.asWebviewUri(vscUri).toString();
  }

  getWebviewUris(): t.WebviewUris | undefined {
    if (this.body) {
      return Object.fromEntries(this.body.audioTracks.map(t => [t.id, this.getAudioTrackWebviewUri(t)]));
    }
  }
}

export default Session;
