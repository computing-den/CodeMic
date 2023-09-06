import { types as t, path, ir, lib, assert } from '@codecast/lib';
import os from 'os';
import * as fs from 'fs';
import * as misc from './misc.js';
import Db from './db.js';
import * as vscode from 'vscode';
import _ from 'lodash';

export type ReadDirOptions = { includeDirs?: boolean; includeFiles?: boolean };

export default class Workspace {
  constructor(public root: t.AbsPath, public session?: ir.Session) {}

  static async populateSessionSummary(
    db: Db,
    sessionSummary: t.SessionSummary,
    root: t.AbsPath,
    clock?: number,
  ): Promise<Workspace | undefined> {
    try {
      const files = await fs.promises.readdir(root);
      if (files.length) {
        // root exists and is a directory but it's not empty.
        if (!(await askToOverwriteRoot(root))) return undefined;
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        // root doesn't exist. Ask user if they want to create it.
        if (!(await askToCreateRoot(root))) return undefined;
        await fs.promises.mkdir(root, { recursive: true });
      } else if (code === 'ENOTDIR') {
        // Exists, but it's not a directory
        vscode.window.showErrorMessage(`"${root}" exists but it's not a folder.`);
        return undefined;
      }
    }

    const workspace = await Workspace.fromSessionSummary(db, sessionSummary, root);
    if (clock) {
      throw new Error('TODO seek ir.Session');
    }
    await workspace.syncSessionToVscodeAndDisk();
    return workspace;
  }

  static async fromSessionSummary(db: Db, sessionSummary: t.SessionSummary, root: t.AbsPath): Promise<Workspace> {
    const json = await db.readSession(sessionSummary.id);
    const session = ir.Session.fromJSON(root, json, sessionSummary);
    return new Workspace(root, session);
  }

  static async fromDirAndVsc(summary: t.SessionSummary, root: t.AbsPath): Promise<Workspace> {
    const workspace = new Workspace(root);
    const checkpoint = await workspace.createCheckpointFromDirAndVsc();
    workspace.session = ir.Session.fromCheckpoint(root, checkpoint, [], os.EOL as t.EndOfLine, summary);
    return workspace;
  }

  static getDefaultRoot(): t.AbsPath | undefined {
    const uri = vscode.workspace.workspaceFolders?.[0].uri;
    return uri && uri.scheme === 'file' ? path.abs(uri.path) : undefined;
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
    return ir.makeSelection(this.positionFromVsc(selection.anchor), this.positionFromVsc(selection.active));
  }

  rangeFromVsc(range: vscode.Range): t.Range {
    return ir.makeRange(this.positionFromVsc(range.start), this.positionFromVsc(range.end));
  }

  positionFromVsc(position: vscode.Position): t.Position {
    return ir.makePosition(position.line, position.character);
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
    uri = this.resolveUri(uri);
    return vscode.workspace.textDocuments.find(d => d.uri.toString() === uri);
  }

  findVscTextEditorByUri(textEditors: readonly vscode.TextEditor[], uri: t.Uri): vscode.TextEditor | undefined {
    return this.findVscTextEditorByVscUri(textEditors, this.uriToVsc(uri));
  }

  findVscTextEditorByVscUri(textEditors: readonly vscode.TextEditor[], uri: vscode.Uri): vscode.TextEditor | undefined {
    const uriStr = uri.toString();
    return textEditors.find(x => x.document.uri.toString() === uriStr);
  }

  textDocumentFromVsc(vscTextDocument: vscode.TextDocument, uri: t.Uri): ir.TextDocument {
    return new ir.TextDocument(
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

  // openTextDocumentFromVsc(vscTextDocument: vscode.TextDocument, uri: t.Uri): ir.TextDocument {
  //   let textDocument = this.session!.findTextDocumentByUri(uri);
  //   if (!textDocument) {
  //     textDocument = this.textDocumentFromVsc(vscTextDocument, uri);
  //     this.session!.textDocuments.push(textDocument);
  //   }
  //   return textDocument;
  // }

  // openTextEditorFromVsc(
  //   vscTextDocument: vscode.TextDocument,
  //   uri: t.Uri,
  //   selections: t.Selection[],
  //   visibleRange: t.Range,
  // ): ir.TextEditor {
  //   // const selections = selectionsFromVsc(vscTextEditor.selections);
  //   // const visibleRange = rangeFromVsc(vscTextEditor.visibleRanges[0]);
  //   const textDocument = this.openTextDocumentFromVsc(vscTextDocument, uri);
  //   let textEditor = this.session!.findTextEditorByUri(textDocument.uri);
  //   if (!textEditor) {
  //     textEditor = new ir.TextEditor(textDocument, selections, visibleRange);
  //     this.session!.textEditors.push(textEditor);
  //   } else {
  //     textEditor.select(selections, visibleRange);
  //   }
  //   return textEditor;
  // }

  async syncSessionToVscodeAndDisk(targetUris?: t.Uri[]) {
    // Vscode does not let us close a TextDocument. We can only close tabs and tab groups.

    // all tabs that are not in this.textEditors should be closed
    for (const tabGroup of vscode.window.tabGroups.all) {
      for (const tab of tabGroup.tabs) {
        if (tab.input instanceof vscode.TabInputText) {
          if (this.shouldRecordVscUri(tab.input.uri)) {
            const uri = this.uriFromVsc(tab.input.uri);
            if (!this.session!.findTextEditorByUri(uri)) {
              const vscTextDocument = await vscode.workspace.openTextDocument(tab.input.uri);
              await vscTextDocument.save();
              await vscode.window.tabGroups.close(tab);
            }
          }
        }
      }
    }

    if (targetUris) {
      // all files in targetUris that are no longer in this.textDocuments should be deleted
      for (const targetUri of targetUris) {
        if (!this.session!.findTextDocumentByUri(targetUri)) {
          if (path.isWorkspaceUri(targetUri)) {
            await fs.promises.rm(path.getFileUriPath(this.resolveUri(targetUri)), { force: true });
          }
        }
      }
    } else {
      // targetUris is undefined when we need to restore a checkpoint completely, meaning that
      // any file that is not in this.textDocuments should be deleted and any text editor not in
      // this.textEditors should be closed.

      // save all tabs and close them
      // for (const tabGroup of vscode.window.tabGroups.all) {
      //   for (const tab of tabGroup.tabs) {
      //     if (tab.input instanceof vscode.TabInputText) {
      //       const partialUri = this.getPartialUri(tab.input.uri);
      //       if (partialUri) {
      //         const vscTextDocument = await vscode.workspace.openTextDocument(tab.input.uri);
      //         await vscTextDocument.save();
      //         await vscode.window.tabGroups.close(tab);
      //       }
      //     }
      //   }
      // }

      // all files in workspace that are not in this.textDocuments should be deleted
      const workspaceFiles = await this.readDirRecursively({ includeFiles: true });
      for (const file of workspaceFiles) {
        const uri = path.workspaceUriFromRelPath(file);
        if (!this.session!.findTextDocumentByUri(uri)) {
          await fs.promises.rm(path.join(this.root, file), { force: true });
        }
      }

      // set targetUris to this.textDocument's uris
      targetUris = this.session!.textDocuments.map(d => d.uri);
    }

    // for now, just delete empty directories
    const dirs = await this.readDirRecursively({ includeDirs: true });
    for (const dir of dirs) {
      const dirIsEmpty = !this.session!.textDocuments.some(
        d => path.isWorkspaceUri(d.uri) && path.isBaseOf(dir, path.getWorkspaceUriPath(d.uri)),
      );
      if (dirIsEmpty) await fs.promises.rm(path.join(this.root, dir), { force: true, recursive: true });
    }

    // for each targetUri
    //   if there's a textDocument open in vscode, replace its content
    //   else, mkdir and write to file
    for (const targetUri of targetUris) {
      assert(path.isWorkspaceUri(targetUri), 'TODO currently, we only support workspace URIs');

      const textDocument = this.session!.findTextDocumentByUri(targetUri);
      if (!textDocument) continue; // already deleted above

      const vscTextDocument = this.findVscTextDocumentByUri(targetUri);
      if (vscTextDocument) {
        const vscTextEditor = await vscode.window.showTextDocument(vscTextDocument, { preserveFocus: true });
        await vscTextEditor.edit(editBuilder => {
          editBuilder.replace(this.getVscTextDocumentRange(vscTextDocument), textDocument.getText());
        });
        await vscTextDocument.save();
      } else {
        const absPath = path.getFileUriPath(this.resolveUri(targetUri));
        await fs.promises.mkdir(path.dirname(absPath), { recursive: true });
        await fs.promises.writeFile(absPath, textDocument.getText(), 'utf8');
      }
    }

    // open all this.textEditors
    for (const textEditor of this.session!.textEditors) {
      const vscUri = this.uriToVsc(textEditor.document.uri);
      await vscode.window.showTextDocument(vscUri, {
        preview: false,
        preserveFocus: true,
        selection: this.selectionToVsc(textEditor.selections[0]),
        viewColumn: vscode.ViewColumn.One,
      });
    }

    // show this.activeTextEditor
    if (this.session!.activeTextEditor) {
      const vscUri = this.uriToVsc(this.session!.activeTextEditor.document.uri);
      await vscode.window.showTextDocument(vscUri, {
        preview: false,
        preserveFocus: false,
        selection: this.selectionToVsc(this.session!.activeTextEditor.selections[0]),
        viewColumn: vscode.ViewColumn.One,
      });
    }
  }

  private async createCheckpointFromDirAndVsc(): Promise<t.Checkpoint> {
    for (const vscTextDocument of vscode.workspace.textDocuments) {
      if (vscTextDocument.isDirty) {
        throw new Error('Checkpoint.fromWorkspace: there are unsaved files in the current workspace.');
      }
    }

    const textDocuments = await this.createCheckpointTextDocuments();

    // Get textEditors from vscode.window.visibleTextEditors first. These have selections and visible range.
    // Then get the rest from vscode.window.tabGroups. These don't have selections and range.
    const textEditors = vscode.window.visibleTextEditors
      .filter(e => this.shouldRecordVscUri(e.document.uri))
      .map(e => this.createCheckpointTextEditor(e));
    const tabUris: t.Uri[] = [];
    for (const tabGroup of vscode.window.tabGroups.all) {
      for (const tab of tabGroup.tabs) {
        if (tab.input instanceof vscode.TabInputText && this.shouldRecordVscUri(tab.input.uri)) {
          tabUris.push(this.uriFromVsc(tab.input.uri));
        }
      }
    }
    for (const uri of tabUris) {
      if (!textEditors.some(e => e.uri === uri)) {
        textEditors.push(ir.makeCheckpointTextEditor(uri));
      }
    }

    const activeTextEditorVscUri = vscode.window.activeTextEditor?.document.uri;
    let activeTextEditorUri;
    if (activeTextEditorVscUri && this.shouldRecordVscUri(activeTextEditorVscUri)) {
      activeTextEditorUri = this.uriFromVsc(activeTextEditorVscUri);
    }

    return ir.makeCheckpoint(textDocuments, textEditors, activeTextEditorUri);
  }

  private async createCheckpointTextDocuments(): Promise<t.CheckpointTextDocument[]> {
    const res: t.CheckpointTextDocument[] = [];
    const paths = await this.readDirRecursively({ includeFiles: true });
    for (const p of paths) {
      const text = await fs.promises.readFile(path.join(this.root, p), 'utf8');
      const uri = path.workspaceUriFromRelPath(p);
      res.push(ir.makeCheckpointTextDocument(uri, text));
    }
    return res;
  }

  private createCheckpointTextEditor(vscTextEditor: vscode.TextEditor): t.CheckpointTextEditor {
    return ir.makeCheckpointTextEditor(
      this.uriFromVsc(vscTextEditor.document.uri),
      this.selectionsFromVsc(vscTextEditor.selections),
      this.rangeFromVsc(vscTextEditor.visibleRanges[0]),
    );
  }

  /**
   * Returns a sorted list of all files.
   * The returned items do NOT start with "/".
   */
  private async readDirRecursively(
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
}

async function askToOverwriteRoot(root: t.AbsPath): Promise<boolean> {
  const overwriteTitle = 'Overwrite';
  const answer = await vscode.window.showWarningMessage(
    `"${root}" is not empty. Do you want to overwrite it?`,
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

async function askToCreateRoot(root: t.AbsPath): Promise<boolean> {
  const createPathTitle = 'Create path';
  const answer = await vscode.window.showWarningMessage(
    `"${root}" does not exist. Do you want to create it?`,
    { modal: true },
    { title: createPathTitle },
    { title: 'Cancel', isCloseAffordance: true },
  );
  return answer?.title === createPathTitle;
}
