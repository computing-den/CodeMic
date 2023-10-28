import { types as t, path, editorTrack as et, lib, assert } from '@codecast/lib';
import os from 'os';
import * as fs from 'fs';
import * as misc from './misc.js';
import Db from './db.js';
import * as vscode from 'vscode';
import _ from 'lodash';
import nodePath from 'path';

export type ReadDirOptions = { includeDirs?: boolean; includeFiles?: boolean };

export default class VscWorkspace {
  constructor(public root: t.AbsPath) {}

  static getDefaultRoot(): t.AbsPath | undefined {
    const uri = vscode.workspace.workspaceFolders?.[0].uri;
    return uri && uri.scheme === 'file' ? path.abs(uri.path) : undefined;
  }

  static async askForRoot(title: string): Promise<t.AbsPath | undefined> {
    const options = {
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      defaultUri: vscode.workspace.workspaceFolders?.[0].uri,
      title,
    };
    const uris = await vscode.window.showOpenDialog(options);
    if (uris?.length === 1) {
      return path.abs(uris[0].path);
    }
  }

  shouldRecordVscUri(vscUri: vscode.Uri): boolean {
    switch (vscUri.scheme) {
      case 'file':
        return path.isBaseOf(this.root, path.abs(vscUri.path));
      default:
        return false;
    }
  }

  selectionsFromVsc(selections: readonly vscode.Selection[]): t.Selection[] {
    return selections.map(s => this.selectionFromVsc(s));
  }

  selectionFromVsc(selection: vscode.Selection): t.Selection {
    return et.makeSelection(this.positionFromVsc(selection.anchor), this.positionFromVsc(selection.active));
  }

  rangeFromVsc(range: vscode.Range): t.Range {
    return et.makeRange(this.positionFromVsc(range.start), this.positionFromVsc(range.end));
  }

  positionFromVsc(position: vscode.Position): t.Position {
    return et.makePosition(position.line, position.character);
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
        return path.workspaceUriFromAbsPath(this.root, path.abs(vscUri.path));
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
    return path.resolveUri(this.root, uri);
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

  textDocumentFromVsc(vscTextDocument: vscode.TextDocument, uri: t.Uri): et.TextDocument {
    return new et.TextDocument(
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

  async saveAllRelevantVscTabs() {
    const uris = this.getRelevantTabVscUris();
    for (const uri of uris) {
      const vscTextDocument = this.findVscTextDocumentByVscUri(uri);
      await vscTextDocument?.save();
    }
  }

  makeTextEditorSnapshotFromVsc(vscTextEditor: vscode.TextEditor): t.TextEditor {
    return et.makeTextEditorSnapshot(
      this.uriFromVsc(vscTextEditor.document.uri),
      this.selectionsFromVsc(vscTextEditor.selections),
      this.rangeFromVsc(vscTextEditor.visibleRanges[0]),
    );
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
      filenames = (await fs.promises.readdir(path.join(this.root, rel))) as t.RelPath[];
    } catch (error) {
      const rootDoesntExist = (error as NodeJS.ErrnoException).code === 'ENOENT' && rel !== path.CUR_DIR;
      if (!rootDoesntExist) throw error;
    }

    filenames.sort();
    for (const childname of filenames) {
      const childRel = path.join(rel, childname);
      const childFull = path.join(this.root, childRel);
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

  async askToOverwriteRoot(): Promise<boolean> {
    const overwriteTitle = 'Overwrite';
    const answer = await vscode.window.showWarningMessage(
      `"${this.root}" is not empty. Do you want to overwrite it?`,
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

  async askAndCreateRoot(): Promise<boolean> {
    const createPathTitle = 'Create path';
    const answer = await vscode.window.showWarningMessage(
      `"${this.root}" does not exist. Do you want to create it?`,
      { modal: true },
      { title: createPathTitle },
      { title: 'Cancel', isCloseAffordance: true },
    );
    return answer?.title === createPathTitle;
  }

  async askToCreateOrOverwriteRoot(): Promise<boolean> {
    // user confirmations and root directory creation
    try {
      const files = await fs.promises.readdir(this.root);
      return files.length === 0 || (await this.askToOverwriteRoot());
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        // root doesn't exist. Ask user if they want to create it.
        return this.askAndCreateRoot();
      } else if (code === 'ENOTDIR') {
        // Exists, but it's not a directory
        vscode.window.showErrorMessage(`"${this.root}" exists but it's not a folder.`);
      }
      return false;
    }
  }

  async updateWorkspaceFolder(): Promise<boolean> {
    // const history = this.db.settings.history[this.playerSetup.sessionSummary.id];
    if (VscWorkspace.getDefaultRoot() === this.root) return true;

    // return vscode.workspace.updateWorkspaceFolders(0, vscode.workspace.workspaceFolders?.length ?? 0, {
    //   uri: vscode.Uri.file(this.root),
    //   name: sessionTitle,
    // });
    const disposables: vscode.Disposable[] = [];
    const done = new Promise((resolve, reject) => {
      vscode.workspace.onDidChangeWorkspaceFolders(() => resolve(undefined), undefined, disposables);
    });

    const success = vscode.workspace.updateWorkspaceFolders(0, vscode.workspace.workspaceFolders?.length ?? 0, {
      uri: vscode.Uri.file(this.root),
      // name: sessionTitle,
    });

    await done;
    for (const d of disposables) d.dispose();

    return success;
  }

  async makeRoot() {
    await fs.promises.mkdir(this.root, { recursive: true });
  }
}
