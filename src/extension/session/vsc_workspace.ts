import * as t from '../../lib/types.js';
import InternalTextDocument from './internal_text_document.js';
import * as lib from '../../lib/lib.js';
import { Position, Range, Selection, LineRange } from '../../lib/lib.js';
import assert from '../../lib/assert.js';
import * as misc from '../misc.js';
import * as storage from '../storage.js';
import type { Context, WorkspaceChangeGlobalState } from '../types.js';
import { LoadedSession } from './session.js';
import * as git from '../git';
import fs from 'fs';
import _ from 'lodash';
import vscode from 'vscode';
import path from 'path';
import { URI } from 'vscode-uri';
import InternalWorkspace from './internal_workspace.js';

type TabWithInputText = Omit<vscode.Tab, 'input'> & {
  readonly input: vscode.TabInputText;
};

export default class VscWorkspace {
  constructor(public session: LoadedSession, private internalWorkspace: InternalWorkspace) {}

  // static getCoverUri(session: Session): string {
  //   return session.context
  //     .view!.webview.asWebviewUri(vscode.Uri.file(path.join(session.core.sessionDataPath, 'cover')))
  //     .toString();
  // }

  static async setWorkspaceChangeGlobalState(context: Context, state?: WorkspaceChangeGlobalState) {
    await context.extension.globalState.update('workspaceChange', state);
  }
  static getWorkspaceChangeGlobalState(context: Context): WorkspaceChangeGlobalState | undefined {
    return context.extension.globalState.get<WorkspaceChangeGlobalState>('workspaceChange');
  }

  static async setUpWorkspace_MAY_RESTART_VSCODE(context: Context, state: WorkspaceChangeGlobalState) {
    // Return if workspace is already up-to-date.
    if (this.testWorkspace(state.workspace)) return;

    // TODO should this even be here?
    // Save first so that we can restore it after vscode restart.
    // if (this.screen === t.Screen.Recorder) {
    //   await session.core.write();
    // }

    // Set global state to get ready for possible restart.
    await this.setWorkspaceChangeGlobalState(context, state);

    // Change vscode's workspace folders.
    // This may cause vscode to restart and the rest of the would not run.
    {
      const disposables: vscode.Disposable[] = [];
      const done = new Promise(resolve => {
        vscode.workspace.onDidChangeWorkspaceFolders(() => resolve(undefined), undefined, disposables);
      });
      const success = vscode.workspace.updateWorkspaceFolders(0, vscode.workspace.workspaceFolders?.length ?? 0, {
        uri: vscode.Uri.file(state.workspace),
      });
      assert(success);
      await done;
      for (const d of disposables) d.dispose();
    }

    // Clear global state.
    await this.setWorkspaceChangeGlobalState(context);

    // Make sure workspace is updated properly.
    this.assertWorkspace(state.workspace);
  }

  static assertWorkspace(workspace: string) {
    workspace = lib.normalizeWindowsDriveLetter(path.resolve(workspace));
    const vscWorkspace = VscWorkspace.getDefaultVscWorkspace();
    assert(
      workspace === vscWorkspace,
      `Failed to open workspace folder. Expected ${workspace}, but current workspace folder is ${vscWorkspace}`,
    );
  }
  static testWorkspace(workspace: string): boolean {
    workspace = lib.normalizeWindowsDriveLetter(path.resolve(workspace));
    const vscWorkspace = VscWorkspace.getDefaultVscWorkspace();
    return workspace === vscWorkspace;
  }

  static async getGitAPI(): Promise<git.API> {
    const extension = vscode.extensions.getExtension('vscode.git') as vscode.Extension<git.GitExtension>;

    if (!extension) throw new Error('Git extension not found');
    const git = extension.isActive ? extension.exports : await extension.activate();
    return git.getAPI(1);
  }

  static getDefaultVscWorkspace(): string | undefined {
    // .uri can be undefined after user deletes the only folder from workspace
    // probably because it doesn't cause a vscode restart.
    const uri = vscode.workspace.workspaceFolders?.[0]?.uri;
    return uri?.scheme === 'file' ? lib.normalizeWindowsDriveLetter(path.resolve(uri.fsPath)) : undefined;
  }

  // static doesVscHaveCorrectWorkspace(workspace: string): boolean {
  //   workspace = lib.normalizeWindowsDriveLetter(path.resolve(workspace));
  //   const vscWorkspace = VscWorkspace.getDefaultVscWorkspace();
  //   console.log('doesVscHaveCorrectWorkspace: ', vscWorkspace, workspace);
  //   return Boolean(vscWorkspace === workspace);
  // }

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

  async scanDirAndVsc(): Promise<t.EditorEvent[]> {
    assert(this.session.isLoaded(), 'Session must be loaded before it can be scanned.'); // make sure session has body
    assert(this.session.mustScan, 'Session is not meant for scan.');
    assert(this.session.body.editorEvents.length === 0, 'Scanning a non-empty session.');
    const events: t.EditorEvent[] = [];

    // for (const vscTextDocument of vscode.workspace.textDocuments) {
    //   if (vscTextDocument.dirty) {
    //     throw new Error('Checkpoint.fromWorkspace: there are unsaved files in the current workspace.');
    //   }
    // }

    // Scan the workspace directory (files and dirs) and create store events.
    // TODO: ignore files in .codemicignore
    const pathsWithStats = await this.session.core.readDirRecursively({ includeFiles: true, includeDirs: true });
    for (const [p, stat] of pathsWithStats) {
      const uri = lib.workspaceUri(p);
      if (stat.isDirectory()) {
        events.push({
          type: 'fsCreate',
          id: lib.nextId(),
          uri,
          clock: 0,
          file: { type: 'dir' },
        });
      } else {
        const data = await fs.promises.readFile(path.join(this.session.workspace, p));
        const sha1 = await misc.computeSHA1(data);
        await this.session.core.copyToBlob(path.join(this.session.workspace, p), sha1);
        events.push({
          type: 'fsCreate',
          id: lib.nextId(),
          uri,
          clock: 0,
          file: { type: 'blob', sha1 },
        });
      }
    }

    // Walk through untitled text documents and create store events.
    for (const vscTextDocument of vscode.workspace.textDocuments) {
      if (vscTextDocument.uri.scheme !== 'untitled') continue;

      const uri = this.uriFromVsc(vscTextDocument.uri);

      const data = new TextEncoder().encode(vscTextDocument.getText());
      const sha1 = await misc.computeSHA1(data);
      await this.session.core.writeBlob(sha1, data);
      events.push({ type: 'fsCreate', id: lib.nextId(), uri, clock: 0, file: { type: 'blob', sha1 } });
    }

    // Walk through text documents and create openTextDocument events.
    // Ignore files outside workspace or with schemes other than untitled or file.
    // Ignore deleted files.
    for (const vscTextDocument of vscode.workspace.textDocuments) {
      // Ignore files outside workspace or with schemes other than untitled or file.
      if (!this.shouldRecordVscUri(vscTextDocument.uri)) continue;

      // If file is deleted but the text editor is still there, ignore it.
      if (vscTextDocument.uri.scheme === 'file' && !(await storage.pathExists(path.join(vscTextDocument.uri.fsPath)))) {
        continue;
      }

      events.push({
        type: 'openTextDocument',
        id: lib.nextId(),
        uri: this.uriFromVsc(vscTextDocument.uri),
        clock: 0,
        eol: VscWorkspace.eolFromVsc(vscTextDocument.eol),
        isInWorktree: false,
      });
    }

    // Walk through open tabs and create showTextEditor events.
    // Ignore anything for which we don't have an openTextDocument event.
    for (const tab of this.getTabsWithInputText()) {
      // Ignore files outside workspace or with schemes other than untitled or file.
      if (!this.shouldRecordVscUri(tab.input.uri)) continue;

      // Ignore if we don't have an openTextDocument event.
      const uri = this.uriFromVsc(tab.input.uri);
      if (!events.some(e => e.uri === uri && e.type === 'openTextDocument')) continue;

      // Create showTextEditor event.
      // vscode.window.visibleTextEditors does not include tabs that exist but are not currently open.
      // Basically, it only includes the visible panes.
      const vscTextEditor = this.findVscTextEditorByVscUri(vscode.window.visibleTextEditors, tab.input.uri);
      const selections = vscTextEditor && VscWorkspace.fromVscSelections(vscTextEditor.selections);
      const visibleRange = vscTextEditor && VscWorkspace.fromVscLineRange(vscTextEditor.visibleRanges[0]);
      const activeVscUri = vscode.window.activeTextEditor?.document.uri;
      const isActiveEditor = activeVscUri?.toString() === tab.input.uri.toString();
      events.push({
        type: 'showTextEditor',
        id: lib.nextId(),
        uri,
        clock: 0,
        preserveFocus: !isActiveEditor,
        selections,
        visibleRange,
      });
    }

    return events;
  }

  async sync(targetUris?: string[]) {
    // Vscode does not let us close a TextDocument. We can only close tabs and tab groups.

    const { internalWorkspace } = this;

    // all text editor tabs that are not in internalWorkspace's textEditors should be closed
    for (const tab of this.getTabsWithInputText()) {
      if (this.shouldRecordVscUri(tab.input.uri)) {
        if (!internalWorkspace.findTextEditorByUri(this.uriFromVsc(tab.input.uri))) {
          await this.closeVscTextEditorByVscUri(tab.input.uri, { skipConfirmation: true });
        }
      }
    }

    // Make sure workspace path exists.
    await fs.promises.mkdir(this.session.workspace, { recursive: true });

    if (targetUris) {
      // all files and directories in targetUris that are no longer in internalWorkspace's worktree should be deleted
      for (const targetUri of targetUris) {
        if (!internalWorkspace.doesUriExist(targetUri)) {
          if (URI.parse(targetUri).scheme === 'workspace') {
            await fs.promises.rm(URI.parse(this.session.core.resolveUri(targetUri)).fsPath, {
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
        const uri = lib.workspaceUri(p);
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
    //   if it's an untitled document, open it and replace its content
    //   if it has an associated text editor open in vscode, replace its content
    //   if it's a directory, mkdir
    //   else, mkdir and write to file
    // NOTE: changing documents with WorkspaceEdit without immediately saving them causes them to be
    //       opened even if they did not have an associated editor.
    {
      const targetUrisOutsideVsc: string[] = [];
      const edit = new vscode.WorkspaceEdit();
      for (const targetUri of targetUris) {
        if (!internalWorkspace.doesUriExist(targetUri)) continue;

        if (internalWorkspace.isDirUri(targetUri)) {
          targetUrisOutsideVsc.push(targetUri);
          continue;
        }

        // Handle text documents that are untitled or have an associated text editor.
        let vscTextDocument: vscode.TextDocument | undefined;
        if (URI.parse(targetUri).scheme === 'untitled') {
          vscTextDocument = await this.openUntitledVscTextDocumentByUri(targetUri);
        } else if (this.findTabInputTextByUri(targetUri)) {
          vscTextDocument = this.findVscTextDocumentByUri(targetUri);
        }

        if (vscTextDocument) {
          const text = new TextDecoder().decode(await internalWorkspace.getLiveContentByUri(targetUri));
          edit.replace(vscTextDocument.uri, this.getVscTextDocumentVscRange(vscTextDocument), text);
        } else {
          targetUrisOutsideVsc.push(targetUri);
        }
      }
      await vscode.workspace.applyEdit(edit);

      // untitled uris have been opened above and not included in targetUrisOutsideVsc.
      for (const targetUri of targetUrisOutsideVsc) {
        assert(URI.parse(targetUri).scheme === 'workspace');
        const fsPath = URI.parse(this.session.core.resolveUri(targetUri)).fsPath;
        if (internalWorkspace.isDirUri(targetUri)) {
          await fs.promises.mkdir(fsPath, { recursive: true });
        } else {
          const data = await internalWorkspace.getLiveContentByUri(targetUri);
          await storage.writeBinary(fsPath, data);
        }
      }
    }

    // open all internalWorkspace's textEditors in vscdoe
    {
      const tabUris = this.getRelevantTabUris();
      for (const textEditor of internalWorkspace.textEditors) {
        if (!tabUris.includes(textEditor.document.uri)) {
          await this.showTextDocumentByUri(textEditor.document.uri, {
            preserveFocus: true,
            selection: VscWorkspace.toVscSelection(textEditor.selections[0]),
          });
        }
      }
    }

    // show this.activeTextEditor
    if (internalWorkspace.activeTextEditor) {
      await this.showTextDocumentByUri(internalWorkspace.activeTextEditor.document.uri, {
        preserveFocus: false,
        selection: VscWorkspace.toVscSelection(internalWorkspace.activeTextEditor.selections[0]),
      });
    }
  }

  async closeVscTextEditorByVscUri(uri: vscode.Uri, options?: { skipConfirmation?: boolean }) {
    // Remember the current ative text editor to restore later.
    const activeUri = vscode.window.activeTextEditor?.document.uri;
    await vscode.commands.executeCommand('vscode.open', uri);

    assert(
      vscode.window.activeTextEditor?.document.uri.toString() === uri.toString(),
      `Failed to open editor for ${uri.toString()}`,
    );
    if (options?.skipConfirmation) {
      await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
    } else {
      await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
    }

    // Restore the previous active text editor.
    if (activeUri && activeUri.toString() !== uri.toString()) {
      await vscode.commands.executeCommand('vscode.open', activeUri);
    }
  }

  async closeVscTextEditorByUri(uri: string, options?: { skipConfirmation?: boolean }) {
    return this.closeVscTextEditorByVscUri(this.uriToVsc(uri), options);
  }

  /**
   * Use this to save without triggering any onsave events that would cause
   * the auto formatter to run for example.
   */
  async saveVscTextDocument(vscTextDocument: vscode.TextDocument) {
    await fs.promises.writeFile(vscTextDocument.uri.fsPath, vscTextDocument.getText());
    await this.revertVscTextDocument(vscTextDocument);
  }

  async revertVscTextDocument(vscTextDocument: vscode.TextDocument) {
    await vscode.commands.executeCommand('vscode.open', vscTextDocument.uri);
    await vscode.commands.executeCommand('workbench.action.files.revert');
  }

  async saveAllRelevantVscTabs() {
    const uris = this.getRelevantTabVscUris();
    for (const uri of uris) {
      if (uri.scheme === 'file') {
        const vscTextDocument = this.findVscTextDocumentByVscUri(uri);
        if (vscTextDocument) {
          await this.saveVscTextDocument(vscTextDocument);
        }
      }
    }
  }

  /**
   * Will ask for confirmation.
   */
  async closeIrrelevantVscTabs() {
    for (const tab of this.getTabsWithInputText()) {
      if (!this.shouldRecordVscUri(tab.input.uri)) {
        await this.closeVscTextEditorByVscUri(tab.input.uri);
      }
    }
  }

  /**
   * Use this instead of vscode.window.showTextDocument() because it handles opening untitled uris properly.
   */
  async showTextDocumentByVscUri(
    uri: vscode.Uri,
    options?: { preserveFocus?: boolean; selection?: vscode.Range },
  ): Promise<vscode.TextEditor> {
    const vscTextDocument = await this.openTextDocumentByVscUri(uri);
    return vscode.window.showTextDocument(vscTextDocument, {
      ...options,
      preview: false,
      viewColumn: vscode.ViewColumn.One,
    });
  }

  /**
   * Use this instead of vscode.window.showTextDocument() because it handles opening untitled uris properly.
   */
  async showTextDocumentByUri(
    uri: string,
    options?: { preserveFocus?: boolean; selection?: vscode.Range },
  ): Promise<vscode.TextEditor> {
    return this.showTextDocumentByVscUri(this.uriToVsc(uri), options);
  }

  /**
   * The problem is that when we do something like =vscode.workspace.openTextDocument('untitled:Untitled-1')= it
   * creates a document with associated resource, a document with a path that will be saved to file =./Untitled-1=
   * even if its content is empty.
   * If instead we use =await vscode.commands.executeCommand('workbench.action.files.newUntitledFile')= we get an
   * untitled file without an associated resource which will not prompt to save when the content is empty.
   * However, the URI of the new document will be picked by vscode. For example, if Untitled-1 and Untitled-3 are
   * already open, when we open a new untitled file, vscode will name it Untitled-2.
   * So, we must make sure that when opening Untitled-X, every untitled number less than X is already open
   * and then try to open a new file.
   * Another thing is that just because there is no tab currently with that name, doesn't necessarily mean that
   * there is no document open with that name.
   */
  private async openUntitledVscTextDocumentByVscUri(uri: vscode.Uri): Promise<vscode.TextDocument> {
    if (!/^Untitled-\d+$/.test(uri.path)) {
      console.error(
        `openUntitledVscTextDocumentByVscUri: untitled URI with invalid path: ${uri.path}. Opening as file...`,
      );
      return await vscode.workspace.openTextDocument(uri);
    }

    // Gather all the untitled names.
    const untitledNames: string[] = vscode.workspace.textDocuments.map(d => d.uri.path);

    // console.log('XXX untitled names: ', untitledNames.join(', '));
    // Open every untitled name up to target name.
    for (let i = 1; i < 100; i++) {
      let name = `Untitled-${i}`;
      if (!untitledNames.includes(name)) {
        await vscode.commands.executeCommand('workbench.action.files.newUntitledFile');
      }
      if (uri.path === name) break;
    }

    // Now its text document should be open.
    const textDocument = this.findVscTextDocumentByVscUri(uri);
    assert(textDocument, `openVscUntitledUri failed to open untitled file named ${uri.path}`);
    return textDocument;
  }

  private async openUntitledVscTextDocumentByUri(uri: string): Promise<vscode.TextDocument | undefined> {
    return this.openUntitledVscTextDocumentByVscUri(this.uriToVsc(uri));
  }

  /**
   * Use this instead of vscode.workspace.openTextDocument() because it handled
   * untitled documents properly.
   */
  async openTextDocumentByVscUri(uri: vscode.Uri): Promise<vscode.TextDocument> {
    if (uri.scheme === 'untitled') {
      return this.openUntitledVscTextDocumentByVscUri(uri);
    } else if (uri.scheme === 'file') {
      return vscode.workspace.openTextDocument(uri);
    } else {
      throw new Error(`Cannot open text document with scheme ${uri.scheme}`);
    }
  }

  async openTextDocumentByUri(uri: string): Promise<vscode.TextDocument> {
    return this.openTextDocumentByVscUri(this.uriToVsc(uri));
  }

  shouldRecordVscUri(vscUri: vscode.Uri): boolean {
    switch (vscUri.scheme) {
      case 'file':
        return this.session.core.shouldRecordAbsPath(vscUri.fsPath);
      case 'untitled':
        return true;
      default:
        return false;
    }
  }

  getVscTextDocumentRange(document: vscode.TextDocument): Range {
    return VscWorkspace.fromVscRange(document.validateRange(new vscode.Range(0, 0, document.lineCount, 0)));
  }

  getVscTextDocumentVscRange(document: vscode.TextDocument): vscode.Range {
    return document.validateRange(new vscode.Range(0, 0, document.lineCount, 0));
  }

  uriFromVsc(vscUri: vscode.Uri): string {
    switch (vscUri.scheme) {
      case 'file':
        return lib.workspaceUriFrom(this.session.workspace, vscUri.fsPath);
      case 'untitled':
        return URI.from({ scheme: 'untitled', path: vscUri.path }).toString();
      default:
        throw new Error(`uriFromVsc: unknown scheme: ${vscUri.scheme}`);
    }
  }

  uriToVsc(uri: string): vscode.Uri {
    return vscode.Uri.parse(this.session.core.resolveUri(uri));
  }

  // findVscTextDocumentByAbsPath(p: t.AbsPath): vscode.TextDocument | undefined {
  //   return vscode.workspace.textDocuments.find(d => d.uri.scheme === 'file' && d.uri.path === p);
  // }

  findTabInputTextByUri(uri: string): TabWithInputText | undefined {
    return this.findTabInputTextByVscUri(this.uriToVsc(uri));
  }

  findTabInputTextByVscUri(uri: vscode.Uri): TabWithInputText | undefined {
    return this.getTabsWithInputText().find(tab => tab.input.uri.toString() === uri.toString());
  }

  findVscTextDocumentByUri(uri: string): vscode.TextDocument | undefined {
    return this.findVscTextDocumentByVscUri(this.uriToVsc(uri));
  }

  findVscTextDocumentByVscUri(uri: vscode.Uri): vscode.TextDocument | undefined {
    const uriStr = uri.toString();
    return vscode.workspace.textDocuments.find(d => d.uri.toString() === uriStr);
  }

  findVscTextEditorByUri(textEditors: readonly vscode.TextEditor[], uri: string): vscode.TextEditor | undefined {
    return this.findVscTextEditorByVscUri(textEditors, this.uriToVsc(uri));
  }

  findVscTextEditorByVscUri(textEditors: readonly vscode.TextEditor[], uri: vscode.Uri): vscode.TextEditor | undefined {
    const uriStr = uri.toString();
    return textEditors.find(x => x.document.uri.toString() === uriStr);
  }

  textDocumentFromVsc(vscTextDocument: vscode.TextDocument, uri: string): InternalTextDocument {
    return new InternalTextDocument(
      uri,
      _.times(vscTextDocument.lineCount, i => vscTextDocument.lineAt(i).text),
      VscWorkspace.eolFromVsc(vscTextDocument.eol),
    );
  }

  // async closeVscTabInputText(tab: vscode.Tab, skipConfirmation: boolean = false) {
  //   assert(tab.input instanceof vscode.TabInputText);

  //   if (skipConfirmation) {
  //     const vscTextDocument = await this.openTextDocumentByVscUri(tab.input.uri);
  //     // console.log('XXX ', vscTextDocument.uri.toString(), 'isDirty: ', vscTextDocument.isDirty);
  //     if (tab.input.uri.scheme === 'untitled') {
  //       // Sometimes isDirty is false for untitled document even though it should be true.
  //       // So, don't check isDirty for untitled.
  //       // For untitled scheme, empty it first, then can close without confirmation.
  //       const edit = new vscode.WorkspaceEdit();
  //       edit.replace(vscTextDocument.uri, VscWorkspace.toVscRange(this.getVscTextDocumentRange(vscTextDocument)), '');
  //       await vscode.workspace.applyEdit(edit);
  //     } else if (tab.input.uri.scheme === 'file' && vscTextDocument.isDirty) {
  //       // .save() returns false if document was not dirty
  //       // Sometimes .save() fails and returns false. No idea why.
  //       for (let i = 0; i < 5; i++) {
  //         if (await vscTextDocument.save()) break;
  //         console.error('closeVscTabInputText Failed to save:', tab.input.uri.toString());
  //         await lib.timeout(100 * i + 100);
  //       }
  //     }
  //   }

  //   // Sometimes when save() fails the first time, closing the tab throws this error:
  //   // Error: Tab close: Invalid tab not found!
  //   // Maybe it automatically closes it? I don't know.
  //   const newTab = this.findTabInputTextByVscUri(tab.input.uri);
  //   if (newTab) {
  //     // console.log('XXX trying to close', tab.input.uri.toString());
  //     await vscode.window.tabGroups.close(newTab);
  //     // console.log('XXX closed', tab.input.uri.toString());
  //   }
  // }

  // makeTextEditorSnapshotFromVsc(vscTextEditor: vscode.TextEditor): t.TextEditor {
  //   return ih.makeTextEditorSnapshot(
  //     this.uriFromVsc(vscTextEditor.document.uri),
  //     this.selectionsFromVsc(vscTextEditor.selections),
  //     this.rangeFromVsc(vscTextEditor.visibleRanges[0]),
  //   );
  // }

  getRelevantTabUris(): string[] {
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
        detail: 'All files in the folder will be overwritten except for those specified in the ignore file.',
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

  // getTrackFileUri(trackFile: t.RangedTrackFile): string {
  //   assert(trackFile.file.type === 'local');
  //   const vscUri = vscode.Uri.file(path.join(this.session.core.sessionDataPath, 'blobs', trackFile.file.sha1));
  //   return this.session.context.view!.webview.asWebviewUri(vscUri).toString();
  // }

  // getBlobsUriMap(): t.UriMap | undefined {
  //   if (this.session.isLoaded()) {
  //     return Object.fromEntries(
  //       _.concat(
  //         this.session.body.audioTracks.map(t => [t.id, this.getTrackFileUri(t)]),
  //         this.session.body.videoTracks.map(t => [t.id, this.getTrackFileUri(t)]),
  //       ),
  //     );
  //   }
  // }
}
