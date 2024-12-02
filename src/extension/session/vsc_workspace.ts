import * as t from '../../lib/types.js';
import * as path from '../../lib/path.js';
import InternalTextDocument from './internal_text_document.js';
import * as lib from '../../lib/lib.js';
import { Position, Range, Selection, LineRange } from '../../lib/lib.js';
import assert from '../../lib/assert.js';
import * as misc from '../misc.js';
import type { Context } from '../types.js';
import { LoadedSession } from './session.js';
import * as serverApi from '../server_api.js';
import * as git from '../git';
import fs from 'fs';
import _ from 'lodash';
import vscode from 'vscode';

type TabWithInputText = Omit<vscode.Tab, 'input'> & {
  readonly input: vscode.TabInputText;
};

export default class VscWorkspace {
  constructor(public session: LoadedSession) {}

  static getCoverPhotoWebviewUri(context: Context, id: string): t.Uri {
    return context
      .view!.webview.asWebviewUri(vscode.Uri.file(path.abs(context.userDataPath, 'sessions', id, 'cover_photo')))
      .toString();
  }

  static async getGitAPI(): Promise<git.API> {
    const extension = vscode.extensions.getExtension('vscode.git') as vscode.Extension<git.GitExtension>;

    if (!extension) throw new Error('Git extension not found');
    const git = extension.isActive ? extension.exports : await extension.activate();
    return git.getAPI(1);
  }

  static getDefaultVscWorkspace(): t.AbsPath | undefined {
    // .uri can be undefined after user deletes the only folder from workspace
    // probably because it doesn't cause a vscode restart.
    const uri = vscode.workspace.workspaceFolders?.[0]?.uri;
    return uri?.scheme === 'file' ? path.abs(uri.path) : undefined;
  }

  static toVscPosition(position: Position): vscode.Position {
    return new vscode.Position(position.line, position.character);
  }

  static fromVscPosition(vscodePosition: vscode.Position): Position {
    return new Position(vscodePosition.line, vscodePosition.character);
  }

  static toVscRange(range: Range): vscode.Range {
    return new vscode.Range(VscWorkspace.toVscPosition(range.start), VscWorkspace.toVscPosition(range.end));
  }

  static fromVscRange(vscRange: vscode.Range): Range {
    return new Range(VscWorkspace.fromVscPosition(vscRange.start), VscWorkspace.fromVscPosition(vscRange.end));
  }

  static fromVscLineRange(vscRange: vscode.Range): LineRange {
    return new LineRange(vscRange.start.line, vscRange.end.line);
  }

  static toVscSelection(selection: Selection): vscode.Selection {
    return new vscode.Selection(
      VscWorkspace.toVscPosition(selection.anchor),
      VscWorkspace.toVscPosition(selection.active),
    );
  }

  static fromVscSelection(vscSelection: vscode.Selection): Selection {
    return new Selection(
      VscWorkspace.fromVscPosition(vscSelection.anchor),
      VscWorkspace.fromVscPosition(vscSelection.active),
    );
  }

  static toVscSelections(selections: Selection[]): readonly vscode.Selection[] {
    return selections.map(VscWorkspace.toVscSelection);
  }

  static fromVscSelections(vscSelections: readonly vscode.Selection[]): Selection[] {
    return vscSelections.map(VscWorkspace.fromVscSelection);
  }

  static eolFromVsc(eol: vscode.EndOfLine): t.EndOfLine {
    return eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
  }

  async scanDirAndVsc(): Promise<t.EditorEventWithUri[]> {
    assert(this.session.isLoaded(), 'Session must be loaded before it can be scanned.'); // make sure session has body
    assert(this.session.mustScan, 'Session is not meant for scan.');
    assert(this.session.body.eventContainer.isEmpty(), 'Scanning a non-empty session.');
    const events: t.EditorEventWithUri[] = [];

    // for (const vscTextDocument of vscode.workspace.textDocuments) {
    //   if (vscTextDocument.dirty) {
    //     throw new Error('Checkpoint.fromWorkspace: there are unsaved files in the current workspace.');
    //   }
    // }

    // Scan the workspace directory (files and dirs) and create init events.
    // TODO: ignore files in .codemicignore
    const pathsWithStats = await this.session.core.readDirRecursively({ includeFiles: true, includeDirs: true });
    for (const [p, stat] of pathsWithStats) {
      const uri = path.workspaceUriFromRelPath(p);
      if (stat.isDirectory()) {
        events.push({ uri, event: { type: 'init', clock: 0, file: { type: 'dir' } } });
      } else {
        const data = await fs.promises.readFile(path.join(this.session.workspace, p));
        const sha1 = await misc.computeSHA1(data);
        await this.session.core.copyToBlob(path.join(this.session.workspace, p), sha1);
        events.push({ uri, event: { type: 'init', clock: 0, file: { type: 'local', sha1 } } });
      }
    }

    // Walk through untitled text documents and create init events.
    for (const vscTextDocument of vscode.workspace.textDocuments) {
      if (vscTextDocument.uri.scheme !== 'untitled') continue;

      const uri = this.uriFromVsc(vscTextDocument.uri);

      const data = new TextEncoder().encode(vscTextDocument.getText());
      const sha1 = await misc.computeSHA1(data);
      await this.session.core.writeBlob(sha1, data);
      events.push({ uri, event: { type: 'init', clock: 0, file: { type: 'local', sha1 } } });
    }

    // Walk through text documents and create openTextDocument events.
    // Ignore files outside workspace or with schemes other than untitled or file.
    // Ignore deleted files.
    for (const vscTextDocument of vscode.workspace.textDocuments) {
      // Ignore files outside workspace or with schemes other than untitled or file.
      if (!this.shouldRecordVscUri(vscTextDocument.uri)) continue;

      // If file is deleted but the text editor is still there, ignore it.
      if (vscTextDocument.uri.scheme === 'file' && !(await misc.fileExists(path.abs(vscTextDocument.uri.path)))) {
        continue;
      }

      events.push({
        uri: this.uriFromVsc(vscTextDocument.uri),
        event: {
          type: 'openTextDocument',
          clock: 0,
          eol: VscWorkspace.eolFromVsc(vscTextDocument.eol),
          isInWorktree: false,
        },
      });
    }

    // Walk through open tabs and create showTextEditor events.
    // Ignore anything for which we don't have an openTextDocument event.
    for (const tab of this.getTabsWithInputText()) {
      // Ignore files outside workspace or with schemes other than untitled or file.
      if (!this.shouldRecordVscUri(tab.input.uri)) continue;

      // Ignore if we don't have an openTextDocument event.
      const uri = this.uriFromVsc(tab.input.uri);
      if (!events.some(e => e.uri === uri && e.event.type === 'openTextDocument')) continue;

      // Create showTextEditor event.
      // vscode.window.visibleTextEditors does not include tabs that exist but are not currently open.
      // Basically, it only includes the visible panes.
      const vscTextEditor = this.findVscTextEditorByVscUri(vscode.window.visibleTextEditors, tab.input.uri);
      const selections = vscTextEditor && VscWorkspace.fromVscSelections(vscTextEditor.selections);
      const visibleRange = vscTextEditor && VscWorkspace.fromVscLineRange(vscTextEditor.visibleRanges[0]);
      const activeVscUri = vscode.window.activeTextEditor?.document.uri;
      const isActiveEditor = activeVscUri?.toString() === tab.input.uri.toString();
      events.push({
        uri,
        event: {
          type: 'showTextEditor',
          clock: 0,
          preserveFocus: !isActiveEditor,
          selections,
          visibleRange,
        },
      });
    }

    return events;
  }

  async sync(targetUris?: t.Uri[]) {
    // Vscode does not let us close a TextDocument. We can only close tabs and tab groups.

    const { internalWorkspace } = this.session.rr;

    // all text editor tabs that are not in internalWorkspace's textEditors should be closed
    for (const tab of this.getTabsWithInputText()) {
      if (this.shouldRecordVscUri(tab.input.uri)) {
        if (!internalWorkspace.findTextEditorByUri(this.uriFromVsc(tab.input.uri))) {
          await this.closeVscTabInputText(tab, true);
        }
      }
    }

    // Make sure workspace path exists.
    await fs.promises.mkdir(this.session.workspace, { recursive: true });

    if (targetUris) {
      // all files and directories in targetUris that are no longer in internalWorkspace's worktree should be deleted
      for (const targetUri of targetUris) {
        if (!internalWorkspace.doesUriExist(targetUri)) {
          if (path.isWorkspaceUri(targetUri)) {
            await fs.promises.rm(path.getFileUriPath(this.session.core.resolveUri(targetUri)), {
              force: true,
              recursive: true,
            });
          }
        }
      }
    } else {
      // all files in workspace that are not in internalWorkspace's worktree should be deleted
      const workspacePathsWithStats = await this.session.core.readDirRecursively({
        includeFiles: true,
        includeDirs: true,
      });
      for (const [p] of workspacePathsWithStats) {
        const uri = path.workspaceUriFromRelPath(p);
        if (!internalWorkspace.doesUriExist(uri)) {
          await fs.promises.rm(path.join(this.session.workspace, p), { force: true, recursive: true });
        }
      }

      // set targetUris to all known uris in internalWorkspace
      targetUris = internalWorkspace.getWorktreeUris();
    }

    // // for now, just delete empty directories
    // {
    //   const dirs = await this.readDirRecursively({ includeDirs: true });
    //   const workspaceUriPaths = internalWorkspace.getWorktreeUris().filter(path.isWorkspaceUri).map(path.getWorkspaceUriPath);
    //   for (const dir of dirs) {
    //     const dirIsEmpty = !workspaceUriPaths.some(p => path.isBaseOf(dir, p));
    //     if (dirIsEmpty) await fs.promises.rm(path.join(this.workspace, dir), { force: true, recursive: true });
    //   }
    // }

    // for each targetUri
    //   if it doesn't exist in internalWorkspace.worktree, it's already been deleted above, so ignore it
    //   if there's a text editor open in vscode, replace its content
    //   if it's a directory, mkdir
    //   else, mkdir and write to file
    // NOTE: changing documents with WorkspaceEdit without immediately saving them causes them to be
    //       opened even if they did not have an associated editor.
    {
      const targetUrisOutsideVsc: t.Uri[] = [];
      const edit = new vscode.WorkspaceEdit();
      for (const targetUri of targetUris) {
        if (!internalWorkspace.doesUriExist(targetUri)) continue;

        if (internalWorkspace.isDirUri(targetUri)) {
          targetUrisOutsideVsc.push(targetUri);
          continue;
        }

        // Handle text documents that have an associated text editor or have untitled schema
        let vscTextDocument: vscode.TextDocument | undefined;
        if (path.isUntitledUri(targetUri)) {
          vscTextDocument = await this.openVscUntitledByName(path.getUntitledUriName(targetUri));
        } else if (this.findTabInputTextByUri(targetUri)) {
          vscTextDocument = this.findVscTextDocumentByUri(targetUri);
        }

        if (vscTextDocument) {
          const text = new TextDecoder().decode(await internalWorkspace.getContentByUri(targetUri));
          edit.replace(
            vscTextDocument.uri,
            VscWorkspace.toVscRange(this.getVscTextDocumentRange(vscTextDocument)),
            text,
          );
        } else {
          targetUrisOutsideVsc.push(targetUri);
        }
      }
      await vscode.workspace.applyEdit(edit);

      // untitled uris have been opened above and not included in targetUrisOutsideVsc.
      for (const targetUri of targetUrisOutsideVsc) {
        assert(path.isWorkspaceUri(targetUri));
        const absPath = path.getFileUriPath(this.session.core.resolveUri(targetUri));
        if (internalWorkspace.isDirUri(targetUri)) {
          await fs.promises.mkdir(absPath, { recursive: true });
        } else {
          const data = await internalWorkspace.getContentByUri(targetUri);
          await fs.promises.mkdir(path.dirname(absPath), { recursive: true });
          await fs.promises.writeFile(absPath, data);
        }
      }
    }

    // open all internalWorkspace's textEditors in vscdoe
    {
      const tabUris = this.getRelevantTabUris();
      for (const textEditor of internalWorkspace.textEditors) {
        if (!tabUris.includes(textEditor.document.uri)) {
          const vscUri = this.uriToVsc(textEditor.document.uri);
          await vscode.window.showTextDocument(vscUri, {
            preview: false,
            preserveFocus: true,
            selection: VscWorkspace.toVscSelection(textEditor.selections[0]),
            viewColumn: vscode.ViewColumn.One,
          });
        }
      }
    }

    // show this.activeTextEditor
    if (internalWorkspace.activeTextEditor) {
      const vscUri = this.uriToVsc(internalWorkspace.activeTextEditor.document.uri);
      await vscode.window.showTextDocument(vscUri, {
        preview: false,
        preserveFocus: false,
        selection: VscWorkspace.toVscSelection(internalWorkspace.activeTextEditor.selections[0]),
        viewColumn: vscode.ViewColumn.One,
      });
    }
  }

  async saveAllRelevantVscTabs() {
    const uris = this.getRelevantTabVscUris();
    for (const uri of uris) {
      if (uri.scheme === 'file') {
        const vscTextDocument = this.findVscTextDocumentByVscUri(uri);
        await vscTextDocument?.save();
      }
    }
  }

  /**
   * Will ask for confirmation.
   */
  async closeIrrelevantVscTabs() {
    for (const tab of this.getTabsWithInputText()) {
      if (!this.shouldRecordVscUri(tab.input.uri)) {
        await this.closeVscTabInputText(tab);
      }
    }
  }

  async openVscUntitledByName(untitledName: string): Promise<vscode.TextDocument> {
    // The problem is that when we do something like =vscode.workspace.openTextDocument('untitled:Untitled-1')= it
    // creates a document with associated resource, a document with a path that will be saved to file =./Untitled-1=
    // even if its content is empty.
    // If instead we use =await vscode.commands.executeCommand('workbench.action.files.newUntitledFile')= we get an
    // untitled file without an associated resource which will not prompt to save when the content is empty.
    // However, the URI of the new document will be picked by vscode. For example, if Untitled-1 and Untitled-3 are
    // already open, when we open a new untitled file, vscode will name it Untitled-2.
    // So, we must make sure that when opening Untitled-X, every untitled number less than X is already open
    // and then try to open a new file.
    // Another thing is that just because there is no tab currently with that name, doesn't necessarily mean that
    // there is no document open with that name.

    // Gather all the untitled names.

    const untitledNames: string[] = vscode.workspace.textDocuments.map(d => d.uri.path);

    // console.log('XXX untitled names: ', untitledNames.join(', '));
    // Open every untitled name up to target name.
    for (let i = 1; i < 100; i++) {
      let name = `Untitled-${i}`;
      if (!untitledNames.includes(name)) {
        await vscode.commands.executeCommand('workbench.action.files.newUntitledFile');
      }
      if (untitledName === name) break;
    }

    // Now its text document should be open.
    const textDocument = this.findVscTextDocumentByVscUri(vscode.Uri.from({ scheme: 'untitled', path: untitledName }));
    assert(textDocument, `openVscUntitledUri failed to open untitled file named ${untitledName}`);
    return textDocument;
  }

  shouldRecordVscUri(vscUri: vscode.Uri): boolean {
    switch (vscUri.scheme) {
      case 'file':
        return path.isBaseOf(this.session.workspace, path.abs(vscUri.path));
      case 'untitled':
        return true;
      default:
        return false;
    }
  }

  getVscTextDocumentRange(document: vscode.TextDocument): Range {
    return VscWorkspace.fromVscRange(document.validateRange(new vscode.Range(0, 0, document.lineCount, 0)));
  }

  uriFromVsc(vscUri: vscode.Uri): t.Uri {
    switch (vscUri.scheme) {
      case 'file':
        return path.workspaceUriFromAbsPath(this.session.workspace, path.abs(vscUri.path));
      case 'untitled':
        return path.untitledUriFromName(vscUri.path);
      default:
        throw new Error(`uriFromVsc: unknown scheme: ${vscUri.scheme}`);
    }
  }

  uriToVsc(uri: t.Uri): vscode.Uri {
    return vscode.Uri.parse(this.session.core.resolveUri(uri));
  }

  // findVscTextDocumentByAbsPath(p: t.AbsPath): vscode.TextDocument | undefined {
  //   return vscode.workspace.textDocuments.find(d => d.uri.scheme === 'file' && d.uri.path === p);
  // }

  findTabInputTextByUri(uri: t.Uri): TabWithInputText | undefined {
    return this.findTabInputTextByVscUri(this.uriToVsc(uri));
  }

  findTabInputTextByVscUri(uri: vscode.Uri): TabWithInputText | undefined {
    return this.getTabsWithInputText().find(tab => tab.input.uri.toString() === uri.toString());
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
      VscWorkspace.eolFromVsc(vscTextDocument.eol),
    );
  }

  async closeVscTextEditorByUri(uri: t.Uri, skipConfirmation: boolean = false) {
    uri = this.session.core.resolveUri(uri);
    for (const tab of this.getTabsWithInputText()) {
      if (tab.input.uri.toString() === uri) {
        this.closeVscTabInputText(tab, skipConfirmation);
      }
    }
  }

  async closeVscTabInputText(tab: vscode.Tab, skipConfirmation: boolean = false) {
    assert(tab.input instanceof vscode.TabInputText);

    if (skipConfirmation) {
      const vscTextDocument = await vscode.workspace.openTextDocument(tab.input.uri);
      // console.log('XXX ', vscTextDocument.uri.toString(), 'isDirty: ', vscTextDocument.isDirty);
      if (tab.input.uri.scheme === 'untitled') {
        // Sometimes isDirty is false for untitled document even though it should be true.
        // So, don't check isDirty for untitled.
        // For untitled scheme, empty it first, then can close without confirmation.
        const edit = new vscode.WorkspaceEdit();
        edit.replace(vscTextDocument.uri, VscWorkspace.toVscRange(this.getVscTextDocumentRange(vscTextDocument)), '');
        await vscode.workspace.applyEdit(edit);
      } else if (tab.input.uri.scheme === 'file' && vscTextDocument.isDirty) {
        // .save() returns false if document was not dirty
        // Sometimes .save() fails and returns false. No idea why.
        for (let i = 0; i < 5; i++) {
          if (await vscTextDocument.save()) break;
          console.error('closeVscTabInputText Failed to save:', tab.input.uri.toString());
          await lib.timeout(100 * i + 100);
        }
      }
    }

    // Sometimes when save() fails the first time, closing the tab throws this error:
    // Error: Tab close: Invalid tab not found!
    // Maybe it automatically closes it? I don't know.
    const newTab = this.findTabInputTextByVscUri(tab.input.uri);
    if (newTab) {
      // console.log('XXX trying to close', tab.input.uri.toString());
      await vscode.window.tabGroups.close(newTab);
      // console.log('XXX closed', tab.input.uri.toString());
    }
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
    return this.getTabsWithInputText()
      .map(tab => tab.input.uri)
      .filter(uri => this.shouldRecordVscUri(uri));
  }

  getTabsWithInputText(): TabWithInputText[] {
    const res: TabWithInputText[] = [];
    for (const tabGroup of vscode.window.tabGroups.all) {
      for (const tab of tabGroup.tabs) {
        if (tab.input instanceof vscode.TabInputText) {
          res.push(tab as TabWithInputText);
        }
      }
    }
    return res;
  }

  async askToOverwriteWorkspace(): Promise<boolean> {
    const overwriteTitle = 'Overwrite';
    const answer = await vscode.window.showWarningMessage(
      `"${this.session.workspace}" is not empty. Do you want to overwrite it?`,
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
      `"${this.session.workspace}" does not exist. Do you want to create it?`,
      { modal: true },
      { title: createPathTitle },
      { title: 'Cancel', isCloseAffordance: true },
    );
    return answer?.title === createPathTitle;
  }

  async askToCreateOrOverwriteWorkspace(scanning: boolean): Promise<boolean> {
    // user confirmations and workspace directory creation
    try {
      const files = await fs.promises.readdir(this.session.workspace);
      return files.length === 0 || scanning || (await this.askToOverwriteWorkspace());
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        // workspace doesn't exist. Ask user if they want to create it.
        return this.askAndCreateWorkspace();
      } else if (code === 'ENOTDIR') {
        // Exists, but it's not a directory
        vscode.window.showErrorMessage(`"${this.session.workspace}" exists but is not a folder.`);
      }
      return false;
    }
  }

  async updateWorkspaceFolder(): Promise<boolean> {
    // const history = this.db.settings.history[this.playerSetup.head.id];
    if (VscWorkspace.getDefaultVscWorkspace() === this.session.workspace) return true;

    // return vscode.workspace.updateWorkspaceFolders(0, vscode.workspace.workspaceFolders?.length ?? 0, {
    //   uri: vscode.Uri.file(this.workspace),
    //   name: sessionTitle,
    // });
    const disposables: vscode.Disposable[] = [];
    const done = new Promise(resolve => {
      vscode.workspace.onDidChangeWorkspaceFolders(() => resolve(undefined), undefined, disposables);
    });

    const success = vscode.workspace.updateWorkspaceFolders(0, vscode.workspace.workspaceFolders?.length ?? 0, {
      uri: vscode.Uri.file(this.session.workspace),
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
    const vscUri = vscode.Uri.file(path.abs(this.session.core.sessionDataPath, 'blobs', trackFile.file.sha1));
    return this.session.context.view!.webview.asWebviewUri(vscUri).toString();
  }

  getCoverPhotoWebviewUri(): string {
    if (this.session.inStorage) {
      return VscWorkspace.getCoverPhotoWebviewUri(this.session.context, this.session.head.id);
    } else {
      return serverApi.getSessionCoverPhotoURLString(this.session.head.id);
    }
  }

  getBlobsWebviewUris(): t.WebviewUris | undefined {
    if (this.session.isLoaded()) {
      return Object.fromEntries(
        _.concat(
          this.session.body.audioTracks.map(t => [t.id, this.getTrackFileWebviewUri(t)]),
          this.session.body.videoTracks.map(t => [t.id, this.getTrackFileWebviewUri(t)]),
        ),
      );
    }
  }
}
