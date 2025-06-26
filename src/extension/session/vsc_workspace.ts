import * as t from '../../lib/types.js';
import InternalTextDocument from './internal_text_document.js';
import * as lib from '../../lib/lib.js';
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
import InternalWorkspace, { LiveWorktree } from './internal_workspace.js';
import { serializeTestMeta } from './serialization.js';

type TabWithInputText = Omit<vscode.Tab, 'input'> & {
  readonly input: vscode.TabInputText;
};

const PROJECT_PATH = path.resolve(__dirname, '..'); // relative to dist

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

  static toVscPosition(position: t.Position): vscode.Position {
    return new vscode.Position(position.line, position.character);
  }

  static fromVscPosition(vscodePosition: vscode.Position): t.Position {
    return { line: vscodePosition.line, character: vscodePosition.character };
  }

  static toVscRange(range: t.Range): vscode.Range {
    return new vscode.Range(VscWorkspace.toVscPosition(range.start), VscWorkspace.toVscPosition(range.end));
  }

  static fromVscRange(vscRange: vscode.Range): t.Range {
    return { start: VscWorkspace.fromVscPosition(vscRange.start), end: VscWorkspace.fromVscPosition(vscRange.end) };
  }

  static fromVscLineRange(vscRange: vscode.Range): t.LineRange {
    return { start: vscRange.start.line, end: vscRange.end.line };
  }

  static toVscSelection(selection: t.Selection): vscode.Selection {
    return new vscode.Selection(
      VscWorkspace.toVscPosition(selection.anchor),
      VscWorkspace.toVscPosition(selection.active),
    );
  }

  static fromVscSelection(vscSelection: vscode.Selection): t.Selection {
    return {
      anchor: VscWorkspace.fromVscPosition(vscSelection.anchor),
      active: VscWorkspace.fromVscPosition(vscSelection.active),
    };
  }

  static toVscSelections(selections: t.Selection[]): readonly vscode.Selection[] {
    return selections.map(VscWorkspace.toVscSelection);
  }

  static fromVscSelections(vscSelections: readonly vscode.Selection[]): t.Selection[] {
    return vscSelections.map(VscWorkspace.fromVscSelection);
  }

  static eolFromVsc(eol: vscode.EndOfLine): t.EndOfLine {
    return eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
  }

  private get worktree(): LiveWorktree {
    return this.internalWorkspace.worktree;
  }

  async scanDirAndVsc(): Promise<t.EditorEvent[]> {
    assert(this.session.isLoaded(), 'Session must be loaded before it can be scanned.'); // make sure session has body
    assert(this.session.mustScan, 'Session is not meant for scan.');
    assert(this.session.body.editorEvents.length === 0, 'Scanning a non-empty session.');
    const events: t.EditorEvent[] = [];
    await this.rehydrateRelevantTextDocuments();

    // Scan the workspace directory (files and dirs) and create fsCreate events.
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

    // // Walk through untitled text documents and create fsCreate events.
    // for (const vscTextDocument of vscode.workspace.textDocuments) {
    //   if (vscTextDocument.uri.scheme !== 'untitled') continue;

    //   const uri = this.uriFromVsc(vscTextDocument.uri);

    //   // const data = new TextEncoder().encode(vscTextDocument.getText());
    //   // const sha1 = await misc.computeSHA1(data);
    //   // await this.session.core.writeBlob(sha1, data);
    //   events.push({ type: 'fsCreate', id: lib.nextId(), uri, clock: 0, file: { type: 'empty' } });
    // }

    // Walk through text documents and create openTextDocument events.
    // If document is dirty, insert text change event as well.
    // Ignore files outside workspace or with schemes other than untitled or file.
    // Ignore deleted files.
    for (const vscTextDocument of vscode.workspace.textDocuments) {
      if (!this.shouldRecordVscUri(vscTextDocument.uri)) continue;

      // If file is deleted but the text editor is still there, ignore it.
      if (vscTextDocument.uri.scheme === 'file' && !(await storage.pathExists(path.join(vscTextDocument.uri.fsPath)))) {
        continue;
      }

      const uri = this.uriFromVsc(vscTextDocument.uri);

      events.push({
        type: 'openTextDocument',
        id: lib.nextId(),
        uri,
        clock: 0,
        eol: VscWorkspace.eolFromVsc(vscTextDocument.eol),
        languageId: vscTextDocument.languageId,
      });

      if (this.isVscTextDocumentDirty(vscTextDocument)) {
        // Calculate revContentChanges for the textChange event.
        let revText: string;
        switch (vscTextDocument.uri.scheme) {
          case 'untitled':
            revText = '';
            break;
          case 'file':
            revText = await fs.promises.readFile(vscTextDocument.uri.fsPath, 'utf8');
            break;
          default:
            throw new Error(`uriFromVsc: unknown scheme: ${vscTextDocument.uri}`);
        }
        const eol = VscWorkspace.eolFromVsc(vscTextDocument.eol);
        const internalTextDocument = InternalTextDocument.fromText(uri, revText, eol, vscTextDocument.languageId);
        const irContentChanges: t.ContentChange[] = [
          { range: internalTextDocument.getRange(), text: vscTextDocument.getText() },
        ];
        const irRevContentChanges = internalTextDocument.applyContentChanges(irContentChanges, true);

        events.push({
          type: 'textChange',
          id: lib.nextId(),
          uri,
          clock: 0,
          contentChanges: irContentChanges,
          revContentChanges: irRevContentChanges,
          updateSelection: false,
        });
      }
    }

    // Walk through open tabs and create showTextEditor events.
    // Ignore anything for which we don't have an openTextDocument event.
    const originalActiveTextEditor = vscode.window.activeTextEditor;
    for (const vscUri of this.getRelevantTabVscUris()) {
      const uri = this.uriFromVsc(vscUri);

      // Ignore if we don't have an openTextDocument event.
      // This should't really happen.
      if (!events.some(e => e.uri === uri && e.type === 'openTextDocument')) continue;

      // Create showTextEditor event.
      // vscode.window.visibleTextEditors only includes the visible panes. So, we have to open the text editor
      // first and then we can read its selections and visible ranges.
      const vscTextEditor = await this.showTextDocumentByVscUri(vscUri);
      const selections = VscWorkspace.fromVscSelections(vscTextEditor.selections);
      const visibleRange = VscWorkspace.fromVscLineRange(vscTextEditor.visibleRanges[0]);
      events.push({
        type: 'showTextEditor',
        id: lib.nextId(),
        uri,
        clock: 0,
        selections,
        visibleRange,
        justOpened: true,
      });
    }

    // Restore active text editor.
    if (originalActiveTextEditor) {
      // Don't use this.openTextDocumentByVscUri because it refuses to
      // open untitled documents with associated files.
      await vscode.window.showTextDocument(originalActiveTextEditor.document);
    }

    return events;
  }

  async sync(targetUris?: string[]) {
    // Vscode does not let us close a TextDocument. We can only close tabs and tab groups.

    const worktree = this.worktree;
    const urisChangedOnDisk = new Set();

    // Make sure workspace path exists.
    await fs.promises.mkdir(this.session.workspace, { recursive: true });

    // If targetUris are not given, all uris in worktree are targets.
    const wasGivenTargetUris = Boolean(targetUris);
    targetUris ??= worktree.getUris();

    // Sync files on disk.
    // If uri scheme is not workspace, ignore it. We're looking for workspace files/dirs.
    // If uri is not in worktree or has no file, ignore it. Will delete later.
    // If its type (dir vs file) is different than in worktree delete it first.
    // If it doesn't exist or its sha1 is different than in worktree, copy blob to workspace.
    for (const targetUri of targetUris) {
      if (URI.parse(targetUri).scheme !== 'workspace') continue;

      const item = worktree.getOpt(targetUri);
      if (!item?.file) continue;

      const fsPath = URI.parse(this.session.core.resolveUri(targetUri)).fsPath;

      const [statError, stat] = await lib.tryCatch(fs.promises.stat(fsPath));
      const errorNoEntry = (statError as NodeJS.ErrnoException | null)?.code === 'ENOENT';
      if (statError && !errorNoEntry) throw statError;

      switch (item.file.type) {
        case 'dir': {
          if (!stat?.isDirectory()) {
            await fs.promises.rm(fsPath, { force: true, recursive: true });
            await fs.promises.mkdir(fsPath, { recursive: true });
            urisChangedOnDisk.add(targetUri);
          } else if (errorNoEntry) {
            await fs.promises.mkdir(fsPath, { recursive: true });
            urisChangedOnDisk.add(targetUri);
          }
          break;
        }
        case 'blob': {
          if (stat && !stat.isFile()) {
            await fs.promises.rm(fsPath, { force: true, recursive: true });
            urisChangedOnDisk.add(targetUri);
          }
          const existingSha1 = stat?.isFile() && (await misc.computeSHA1(await fs.promises.readFile(fsPath)));
          if (existingSha1 !== item.file.sha1) {
            await this.session.core.copyBlobTo(item.file.sha1, fsPath);
            urisChangedOnDisk.add(targetUri);
          }
          break;
        }
        default:
          throw new Error(`Cannot sync file of type ${item.file.type}`);
      }
    }

    // Sync vscode text documents and text editors.
    // If uri is not in worktree, ignore it. Will close later.
    // If uri scheme is workspace and there is a vscode document open:
    //   If uri was changed above on disk or has no internal document, then revert vsc document to avoid warnings later.
    //   NOTE: if there's no internal document, it means all the changes in vsc, if any, must be thrown out.
    //   NOTE: reverting a document may open its text editor even if it was closed. So we must make sure
    //         to revert documents before attempting to close anything.
    // If internal document is open:
    //   If there's no vscode document, open it (may be file or untitled).
    //   If vscode document content is different from internal, edit vscode.
    {
      const edit = new vscode.WorkspaceEdit();
      for (const targetUri of targetUris) {
        const item = worktree.getOpt(targetUri);
        if (!item) continue;

        let vscTextDocument = this.findVscTextDocumentByUri(targetUri);

        if (
          URI.parse(targetUri).scheme === 'workspace' &&
          vscTextDocument &&
          !vscTextDocument.isClosed &&
          (urisChangedOnDisk.has(targetUri) || (!item.textDocument && this.isVscTextDocumentDirty(vscTextDocument)))
        ) {
          await this.revertVscTextDocument(vscTextDocument);
        }

        if (item.textDocument) {
          vscTextDocument ??= await this.openTextDocumentByUri(targetUri, { createFileIfNecessary: true });
          const vscContent = vscTextDocument.getText();
          const internalContent = item.textDocument.getText();
          if (vscContent !== internalContent) {
            edit.replace(vscTextDocument.uri, this.getVscTextDocumentVscRange(vscTextDocument), internalContent);
          }
        }
      }
      await vscode.workspace.applyEdit(edit);
    }

    // Update languageId of vscode text documents.
    for (const targetUri of targetUris) {
      const irTextDocument = worktree.getOpt(targetUri)?.textDocument;
      let vscTextDocument = this.findVscTextDocumentByUri(targetUri);
      if (!irTextDocument || !vscTextDocument) continue;

      if (irTextDocument.languageId !== vscTextDocument.languageId) {
        vscTextDocument = await vscode.languages.setTextDocumentLanguage(vscTextDocument, irTextDocument.languageId);
      }
    }

    // all text editor tabs that are not in internalWorkspace's textEditors should be closed
    for (const tab of this.getTabsWithInputText()) {
      if (this.shouldRecordVscUri(tab.input.uri)) {
        if (!worktree.getOpt(this.uriFromVsc(tab.input.uri))?.textEditor) {
          await this.closeVscTextEditorByVscUri(tab.input.uri, { skipConfirmation: true });
        }
      }
    }

    // Delete files that no longer exist in internal worktree or have an associated file.
    if (wasGivenTargetUris) {
      // Only check paths in targetUris.
      for (const targetUri of targetUris) {
        if (!worktree.getOpt(targetUri)?.file) {
          if (URI.parse(targetUri).scheme === 'workspace') {
            await fs.promises.rm(URI.parse(this.session.core.resolveUri(targetUri)).fsPath, {
              force: true,
              recursive: true,
            });
          }
        }
      }
    } else {
      // Check all paths.
      const workspacePathsWithStats = await this.session.core.readDirRecursively({
        includeFiles: true,
        includeDirs: true,
      });
      for (const [p] of workspacePathsWithStats) {
        const uri = lib.workspaceUri(p);
        if (!worktree.getOpt(uri)?.file) {
          await fs.promises.rm(path.join(this.session.workspace, p), { force: true, recursive: true });
        }
      }
    }

    // open all internalWorkspace's textEditors in vscode
    {
      for (const item of worktree.getItems()) {
        if (item.textEditor) {
          const selection = VscWorkspace.toVscSelection(item.textEditor.selections[0]);
          await this.showTextDocumentByUri(item.uri, { preserveFocus: true, selection });
        }
      }
    }

    // show active text editor.
    if (worktree.activeTextEditorUri) {
      const textEditor = worktree.get(worktree.activeTextEditorUri).textEditor;
      assert(textEditor);
      const selection = VscWorkspace.toVscSelection(textEditor.selections[0]);
      await this.showTextDocumentByUri(worktree.activeTextEditorUri, { preserveFocus: false, selection });
      await vscode.commands.executeCommand('revealLine', { lineNumber: textEditor.visibleRange.start, at: 'top' });
    }
  }

  async closeVscTextEditorByVscUri(uri: vscode.Uri, options?: { skipConfirmation?: boolean }) {
    // Check if there's any tab open for uri.
    if (!this.getRelevantTabVscUris().some(curUri => curUri.toString() === uri.toString())) return;

    // Remember the current ative text editor to restore later.
    const activeVscDocument = vscode.window.activeTextEditor?.document;

    // If uri is not the active text editor, open it.
    if (activeVscDocument?.uri.toString() !== uri.toString()) {
      try {
        await this.showTextDocumentByVscUri(uri);
      } catch (error) {
        console.error(error);
        // if the text document was deleted vscode shows the tab but cannot open
        // it and activeTextEditor is undefined.
        const tab = this.findTabInputTextByVscUri(uri);
        if (tab) await vscode.window.tabGroups.close(tab);
        return;
      }
    }

    // Now, we can revert and close it.
    assert(
      vscode.window.activeTextEditor?.document.uri.toString() === uri.toString(),
      `Failed to open editor for ${uri.toString()}`,
    );
    if (options?.skipConfirmation) {
      await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
    } else {
      await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
    }

    assert(vscode.window.activeTextEditor?.document.uri.toString() !== uri.toString(), `${uri} was not closed`);

    // Restore the previous active text editor.
    if (activeVscDocument && activeVscDocument.uri.toString() !== uri.toString()) {
      // Don't use this.openTextDocumentByVscUri because it refuses to
      // open untitled documents with associated files.
      await vscode.window.showTextDocument(activeVscDocument);
    }
  }

  /**
   * Restore active text editor after awaiting cb() unless the active text
   * editor has the same uri as exception.
   */
  async deferRestoreTextEditorByVscUri<T>(cb: () => T, opts?: { exception?: vscode.Uri }): Promise<T> {
    // Remember the current ative text editor to restore later.
    const document = vscode.window.activeTextEditor?.document;
    let res;
    try {
      res = await cb();
    } finally {
      if (document && opts?.exception?.toString() !== document.uri.toString()) {
        await vscode.window.showTextDocument(document);
      }
    }
    return res;
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
    await vscode.window.showTextDocument(vscTextDocument, { preview: false, viewColumn: vscode.ViewColumn.One });
    // await vscode.commands.executeCommand('vscode.open', vscTextDocument.uri);
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
    const vscTextDocument = await this.openTextDocumentByVscUri(uri, { createFileIfNecessary: true });
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

  private isUntitledVscUriValid(uri: vscode.Uri): boolean {
    return /^Untitled-\d+$/.test(uri.path);
  }

  /**
   * Use this instead of TextDocument.isDirty because that doesn't report the dirty
   * state for untitled documents properly every time. Apparently there's a bug:
   * https://github.com/microsoft/vscode/issues/230754
   * https://github.com/microsoft/vscode/issues/723
   */
  isVscTextDocumentDirty(vscTextDocument: vscode.TextDocument): boolean {
    return Boolean(vscTextDocument.isDirty || (vscTextDocument.uri.scheme === 'untitled' && vscTextDocument.getText()));
  }

  /**
   * The problem is that when we do something like =vscode.workspace.openTextDocument('untitled:Untitled-1')= it
   * creates a document with associated resource, a document with a path that will be saved to file =./Untitled-1=
   * even if its content is empty.
   *
   * If instead we use =vscode.commands.executeCommand('workbench.action.files.newUntitledFile')= or
   * vscode.workspace.openTextDocument() we get an untitled file without an associated resource which will
   * not prompt to save when the content is empty.
   *
   * However, the URI of the new document will be picked by vscode. For example, if Untitled-1 and Untitled-3 are
   * already open, when we open a new untitled file, vscode will name it Untitled-2.
   * So, we must make sure that when opening Untitled-X, every untitled number less than X is already open
   * and then try to open a new file.
   *
   * Another thing is that just because there is no tab currently with that name, doesn't necessarily mean that
   * there is no document open with that name.
   *
   * The opposite is true as well! If vscode was just started (e.g. with F5 during dev) and tabs from the
   * previous session are opened, the tabs may exist but their documents do not exist yet.
   */
  private async openUntitledVscTextDocumentByVscUri(uri: vscode.Uri): Promise<vscode.TextDocument> {
    if (!this.isUntitledVscUriValid(uri)) {
      throw new Error(`openUntitledVscTextDocumentByVscUri: untitled URI with invalid path: ${uri.path}.`);
    }

    // Check if the tab exists we can reuse its URI to open the text document.
    const tab = this.getTabsWithInputText().find(tab => tab.input.uri.toString() === uri.toString());
    if (tab) return vscode.workspace.openTextDocument(tab.input.uri);

    // Gather all the untitled names.
    const openTextDocumentsPaths: string[] = vscode.workspace.textDocuments.map(d => d.uri.path);

    // console.log('XXX untitled names: ', openTextDocumentsPaths.join(', '));
    // Open every untitled name up to target name.
    for (let i = 1; i < 100; i++) {
      let name = `Untitled-${i}`;
      if (!openTextDocumentsPaths.includes(name)) {
        await vscode.workspace.openTextDocument();
        // await vscode.commands.executeCommand('workbench.action.files.newUntitledFile');
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
   * Use this instead of vscode.workspace.openTextDocument() because:
   * + it handles untitled documents properly
   * + it can optionally create the file before opening it, otherwise vscode throws error
   */
  async openTextDocumentByVscUri(
    uri: vscode.Uri,
    opts?: { createFileIfNecessary?: boolean },
  ): Promise<vscode.TextDocument> {
    if (uri.scheme === 'untitled') {
      return this.openUntitledVscTextDocumentByVscUri(uri);
    } else if (uri.scheme === 'file') {
      const textDocument = this.findVscTextDocumentByVscUri(uri);
      if (textDocument) return textDocument;

      if (opts?.createFileIfNecessary && !(await storage.pathExists(uri.fsPath))) {
        await storage.writeString(uri.fsPath, '');
      }
      return vscode.workspace.openTextDocument(uri);
    } else {
      throw new Error(`Cannot open text document with scheme ${uri.scheme}`);
    }
  }

  async openTextDocumentByUri(uri: string, opts?: { createFileIfNecessary?: boolean }): Promise<vscode.TextDocument> {
    return this.openTextDocumentByVscUri(this.uriToVsc(uri), opts);
  }

  shouldRecordVscUri(vscUri: vscode.Uri): boolean {
    switch (vscUri.scheme) {
      case 'file':
        return this.session.core.shouldRecordAbsPath(vscUri.fsPath);
      case 'untitled':
        // If URI is untitled, make sure it doesn't have an associated file.
        // I don't know what their use case is and don't know how to close
        // them while skipping the confirmation dialog. Perhaps, reverting
        // it before closing works, I don't know.
        return this.isUntitledVscUriValid(vscUri);
      default:
        return false;
    }
  }

  getVscTextDocumentRange(document: vscode.TextDocument): t.Range {
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
      vscTextDocument.languageId,
    );
  }

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

  async makeTest() {
    const testPath = path.resolve(PROJECT_PATH, 'test_data/sessions', this.session.head.handle);
    const testClockPath = path.resolve(testPath, `clock_${this.session.rr.clock}`);
    const testDataPath = path.resolve(testPath, 'CodeMic');
    await this.rehydrateRelevantTextDocuments();
    const relevantVscTextDocuments = vscode.workspace.textDocuments.filter(d => this.shouldRecordVscUri(d.uri));

    // Remove existing data path and clock path.
    await fs.promises.rm(testClockPath, { recursive: true, force: true });
    await fs.promises.rm(testDataPath, { recursive: true, force: true });

    // Flush and write head/body to test data path.
    this.session.editor.finishEditing();
    this.session.core.write();
    await fs.promises.cp(this.session.core.dataPath, testDataPath, { recursive: true });

    // Write files.
    const filePathsStats = await this.session.core.readDirRecursively({ includeDirs: true, includeFiles: true });
    await fs.promises.mkdir(path.resolve(testClockPath, 'files'), { recursive: true });
    for (const [filePath, stat] of filePathsStats) {
      const srcFilePath = path.resolve(this.session.workspace, filePath);
      const testFilePath = path.resolve(testClockPath, 'files', filePath);
      if (stat.isDirectory()) {
        await fs.promises.mkdir(testFilePath, { recursive: true });
      } else if (stat.isFile()) {
        await fs.promises.cp(srcFilePath, testFilePath, { force: true });
      } else {
        throw new Error(`Unknown file type at ${srcFilePath}`);
      }
    }

    // Write text_documents.
    {
      const vscTextDocuments = relevantVscTextDocuments.map(d => ({
        content: d.getText(),
        uri: this.uriFromVsc(d.uri),
      }));
      const internalTextDocuments = await Promise.all(
        this.worktree.getTextDocuments().map(async d => ({
          content: d.getText(),
          uri: d.uri,
          isDirty: await this.worktree.get(d.uri).isDirty(),
        })),
      );

      // Assert that internal and vscode text documents are the same.
      // It's ok for vscode to have extra text documents because we cannot explicitly close vscode text documents.
      // It's ok for internal to have extra text documents if they are not dirty because we don't always close them.
      const diffTextDocumentUris: string[] = [];
      for (const internal of internalTextDocuments) {
        const vsc = _.find(vscTextDocuments, ['uri', internal.uri]);
        if ((vsc && vsc.content !== internal.content) || (!vsc && internal.isDirty)) {
          diffTextDocumentUris.push(internal.uri);
        }
      }
      if (!_.isEmpty(diffTextDocumentUris)) {
        const diffInternalTextDocuments = _.filter(internalTextDocuments, ({ uri }) =>
          _.includes(diffTextDocumentUris, uri),
        );
        const diffVscTextDocuments = _.filter(vscTextDocuments, ({ uri }) => _.includes(diffTextDocumentUris, uri));
        throw new Error(
          `Internal and VSCode text documents are different:\n` +
            `internal documents diff: ${JSON.stringify(diffInternalTextDocuments, null, 2)}\n` +
            `vscode documents diff: ${JSON.stringify(diffVscTextDocuments, null, 2)}\n`,
        );
      }

      await fs.promises.mkdir(path.resolve(testClockPath, 'text_documents'), { recursive: true });
      for (const internalTextDocument of this.worktree.getTextDocuments()) {
        const parsedUri = URI.parse(internalTextDocument.uri);
        const relPath = parsedUri.fsPath;
        if (parsedUri.scheme === 'untitled') {
          assert(/^Untitled-\d+$/.test(relPath));
        } else if (parsedUri.scheme === 'workspace') {
          // nothing
        } else {
          throw new Error(`Unknown URI scheme ${parsedUri.toString()}`);
        }

        const testFilePath = path.resolve(testClockPath, 'text_documents', relPath);
        await storage.writeString(testFilePath, internalTextDocument.getText());
      }
    }

    // Text editors
    const dirtyTextDocuments = relevantVscTextDocuments
      .filter(d => this.isVscTextDocumentDirty(d))
      .map(d => this.uriFromVsc(d.uri));
    const tabVscUris = this.getRelevantTabVscUris();
    let vscOpenTextEditors: t.TestMetaTextEditor[] = [];
    const originalActiveTextEditor = vscode.window.activeTextEditor;
    for (const tabVscUri of tabVscUris) {
      const vscTextEditor = await this.showTextDocumentByVscUri(tabVscUri);
      const selections = VscWorkspace.fromVscSelections(vscTextEditor.selections);
      const visibleRange = VscWorkspace.fromVscLineRange(vscTextEditor.visibleRanges[0]);
      vscOpenTextEditors.push({ uri: this.uriFromVsc(tabVscUri), selections, visibleRange });
    }
    vscOpenTextEditors = _.orderBy(vscOpenTextEditors, 'uri');

    // Text documents languageId
    let languageIds: Record<string, string> = {};
    {
      const vscTextDocuments = relevantVscTextDocuments.map(d => ({
        languageId: d.languageId,
        uri: this.uriFromVsc(d.uri),
      }));
      const internalTextDocuments = await Promise.all(
        this.worktree.getTextDocuments().map(async d => ({
          languageId: d.languageId,
          uri: d.uri,
        })),
      );

      const diffTextDocumentUris: string[] = [];
      for (const internal of internalTextDocuments) {
        const vsc = _.find(vscTextDocuments, ['uri', internal.uri]);
        if (vsc && vsc.languageId !== internal.languageId) {
          diffTextDocumentUris.push(internal.uri);
        }
      }

      if (!_.isEmpty(diffTextDocumentUris)) {
        const diffInternalTextDocuments = _.filter(internalTextDocuments, ({ uri }) =>
          _.includes(diffTextDocumentUris, uri),
        );
        const diffVscTextDocuments = _.filter(vscTextDocuments, ({ uri }) => _.includes(diffTextDocumentUris, uri));
        throw new Error(
          `Internal and VSCode text documents have different language IDs:\n` +
            `internal documents diff: ${JSON.stringify(diffInternalTextDocuments, null, 2)}\n` +
            `vscode documents diff: ${JSON.stringify(diffVscTextDocuments, null, 2)}\n`,
        );
      }

      languageIds = Object.fromEntries(vscTextDocuments.concat(internalTextDocuments).map(x => [x.uri, x.languageId]));
    }

    // Assert that internal and vscode text editors are the same.
    let internalOpenTextEditors: t.TestMetaTextEditor[] = this.worktree.getTextEditors().map(textEditor => ({
      uri: textEditor.uri,
      selections: textEditor.selections,
      visibleRange: textEditor.visibleRange,
    }));
    internalOpenTextEditors = _.orderBy(internalOpenTextEditors, 'uri');
    if (!_.isEqual(vscOpenTextEditors, internalOpenTextEditors)) {
      const diffVsc = _.differenceWith(vscOpenTextEditors, internalOpenTextEditors, _.isEqual);
      const diffInternal = _.differenceWith(internalOpenTextEditors, vscOpenTextEditors, _.isEqual);
      throw new Error(
        `Internal and VSCode text editors are different:\n` +
          `internal editors diff: ${JSON.stringify(diffInternal, null, 2)}\n` +
          `vscode editors diff: ${JSON.stringify(diffVsc, null, 2)}\n`,
      );
    }

    // Restore active text editor.
    if (originalActiveTextEditor) {
      // Don't use this.openTextDocumentByVscUri because it refuses to
      // open untitled documents with associated files.
      await vscode.window.showTextDocument(originalActiveTextEditor.document);
    }

    const meta: t.TestMeta = {
      dirtyTextDocuments,
      openTextEditors: vscOpenTextEditors,
      activeTextEditor:
        originalActiveTextEditor && this.shouldRecordVscUri(originalActiveTextEditor.document.uri)
          ? this.uriFromVsc(originalActiveTextEditor.document.uri)
          : undefined,
      languageIds,
    };
    await storage.writeJSON(path.resolve(testClockPath, 'meta.json'), serializeTestMeta(meta));
  }

  /**
   * If vscode was just started (e.g. with F5 during dev) and tabs from the
   * previous session are opened, the tabs may exist but their documents do not exist yet.
   * We can rehydrate them by visiting such tabs so that we can then use
   * vscode.workspace.textDocuments
   */
  private async rehydrateRelevantTextDocuments() {
    const tabUris = this.getRelevantTabVscUris();
    const textDocumentUris = vscode.workspace.textDocuments.map(d => d.uri);
    const missingTextDocumentUris = _.differenceWith(
      tabUris,
      textDocumentUris,
      (a, b) => a.toString() === b.toString(),
    );
    const originalActiveTextEditor = vscode.window.activeTextEditor;

    for (const uri of missingTextDocumentUris) {
      await vscode.window.showTextDocument(uri);
    }

    // Restore active text editor.
    if (!_.isEmpty(missingTextDocumentUris) && originalActiveTextEditor) {
      // Don't use this.openTextDocumentByVscUri because it refuses to
      // open untitled documents with associated files.
      await vscode.window.showTextDocument(originalActiveTextEditor.document);
    }
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
