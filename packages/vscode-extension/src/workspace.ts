import { types as t, path, ir, lib, assert } from '@codecast/lib';
import os from 'os';
import * as fs from 'fs';
import * as misc from './misc.js';
import Db from './db.js';
import * as vscode from 'vscode';
import _ from 'lodash';
import nodePath from 'path';

export type ReadDirOptions = { includeDirs?: boolean; includeFiles?: boolean };

export default class Workspace {
  constructor(public root: t.AbsPath) {}

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

  async saveAllRelevantVscTabs() {
    const uris = this.getRelevantTabVscUris();
    for (const uri of uris) {
      const vscTextDocument = this.findVscTextDocumentByVscUri(uri);
      await vscTextDocument?.save();
    }
  }

  // async createCheckpointTextDocuments(): Promise<t.CheckpointTextDocument[]> {
  //   const res: t.CheckpointTextDocument[] = [];
  //   const paths = await this.readDirRecursively({ includeFiles: true });
  //   for (const p of paths) {
  //     const text = await fs.promises.readFile(path.join(this.root, p), 'utf8');
  //     const uri = path.workspaceUriFromRelPath(p);
  //     res.push(ir.makeCheckpointTextDocument(uri, text));
  //   }
  //   return res;
  // }

  makeSnapshotTextEditorFromVsc(vscTextEditor: vscode.TextEditor): t.TextEditor {
    return ir.makeSnapshotTextEditor(
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
}
