import { types as t, path, ir, lib, assert } from '@codecast/lib';
import os from 'os';
import * as fs from 'fs';
import * as misc from './misc.js';
import * as vscode from 'vscode';
import _ from 'lodash';

export async function sessionFromFile(workspacePath: t.AbsPath, p: t.AbsPath): Promise<ir.Session> {
  const json = JSON.parse(await fs.promises.readFile(p, 'utf8'));
  return ir.Session.fromJSON(workspacePath, json);
}

export async function sessionFromWorkspace(workspacePath: t.AbsPath): Promise<ir.Session> {
  const checkpoint = await checkpointFromWorkspace(workspacePath);
  return ir.Session.fromCheckpoint(workspacePath, checkpoint, [], os.EOL as t.EndOfLine);
}

export async function checkpointFromWorkspace(workspacePath: t.AbsPath): Promise<ir.Checkpoint> {
  for (const vscTextDocument of vscode.workspace.textDocuments) {
    if (vscTextDocument.isDirty) {
      throw new Error('Checkpoint.fromWorkspace: there are unsaved files in the current workspace.');
    }
  }

  const textDocuments = await checkpointTextDocumentFromWorkspace(workspacePath);

  // Get textEditors from vscode.window.visibleTextEditors first. These have selections and visible range.
  // Then get the rest from vscode.window.tabGroups. These don't have selections and range.
  const textEditors = vscode.window.visibleTextEditors
    .filter(e => shouldRecordVscUri(workspacePath, e.document.uri))
    .map(e => checkpointTextEditorFromVsc(workspacePath, e));
  const tabUris: t.Uri[] = [];
  for (const tabGroup of vscode.window.tabGroups.all) {
    for (const tab of tabGroup.tabs) {
      if (tab.input instanceof vscode.TabInputText && shouldRecordVscUri(workspacePath, tab.input.uri)) {
        tabUris.push(uriFromVsc(workspacePath, tab.input.uri));
      }
    }
  }
  for (const uri of tabUris) {
    if (!textEditors.some(e => e.uri === uri)) {
      textEditors.push(
        new ir.CheckpointTextEditor(
          uri,
          [new ir.Selection(new ir.Position(0, 0), new ir.Position(0, 0))],
          new ir.Range(new ir.Position(0, 0), new ir.Position(1, 0)),
        ),
      );
    }
  }

  const activeTextEditorUri =
    vscode.window.activeTextEditor?.document.uri &&
    uriFromVsc(workspacePath, vscode.window.activeTextEditor?.document.uri);

  return new ir.Checkpoint(textDocuments, textEditors, activeTextEditorUri);
}

export async function checkpointTextDocumentFromWorkspace(
  workspacePath: t.AbsPath,
): Promise<ir.CheckpointTextDocument[]> {
  const res: ir.CheckpointTextDocument[] = [];
  const paths = await readDirRecursively(workspacePath, { includeFiles: true });
  for (const p of paths) {
    const text = await fs.promises.readFile(path.join(workspacePath, p), 'utf8');
    const uri = path.workspaceUriFromRelPath(p);
    res.push(new ir.CheckpointTextDocument(uri, text));
  }
  return res;
}

export function checkpointTextEditorFromVsc(
  workspacePath: t.AbsPath,
  vscTextEditor: vscode.TextEditor,
): ir.CheckpointTextEditor {
  return new ir.CheckpointTextEditor(
    uriFromVsc(workspacePath, vscTextEditor.document.uri),
    selectionsFromVsc(vscTextEditor.selections),
    rangeFromVsc(vscTextEditor.visibleRanges[0]),
  );
}

export function selectionsFromVsc(selections: readonly vscode.Selection[]): ir.Selection[] {
  return selections.map(selectionFromVsc);
}

export function selectionFromVsc(selection: vscode.Selection): ir.Selection {
  return new ir.Selection(positionFromVsc(selection.anchor), positionFromVsc(selection.active));
}

export function rangeFromVsc(range: vscode.Range): ir.Range {
  return new ir.Range(positionFromVsc(range.start), positionFromVsc(range.end));
}

export function positionFromVsc(position: vscode.Position): ir.Position {
  return new ir.Position(position.line, position.character);
}

export function selectionsToVsc(selections: ir.Selection[]): vscode.Selection[] {
  return selections.map(selectionToVsc);
}

export function selectionToVsc(selection: ir.Selection): vscode.Selection {
  return new vscode.Selection(positionToVsc(selection.anchor), positionToVsc(selection.active));
}

export function rangeToVsc(range: ir.Range): vscode.Range {
  return new vscode.Range(positionToVsc(range.start), positionToVsc(range.end));
}

export function positionToVsc(position: ir.Position): vscode.Position {
  return new vscode.Position(position.line, position.character);
}

export function getVscTextDocumentRange(document: vscode.TextDocument): vscode.Range {
  return document.validateRange(new vscode.Range(0, 0, document.lineCount, 0));
}

export function uriFromVsc(workspacePath: t.AbsPath, vscUri: vscode.Uri): t.Uri {
  switch (vscUri.scheme) {
    case 'file':
      return path.workspaceUriFromAbsPath(workspacePath, path.abs(vscUri.path));
    case 'untitled':
      return path.untitledUriFromName(vscUri.path);
    default:
      throw new Error(`uriFromVsc: unknown scheme: ${vscUri.scheme}`);
  }
}

export function shouldRecordVscUri(workspacePath: t.AbsPath, vscUri: vscode.Uri): boolean {
  switch (vscUri.scheme) {
    case 'file':
      return path.isBaseOf(workspacePath, path.abs(vscUri.path));
    default:
      return false;
  }
}

export type ReadDirOptions = { includeDirs?: boolean; includeFiles?: boolean };

/**
 * Returns a sorted list of all files.
 * The returned items do NOT start with "/".
 */
export async function readDirRecursively(
  root: t.AbsPath,
  options: ReadDirOptions,
  rel: t.RelPath = path.CUR_DIR,
  res: t.RelPath[] = [],
): Promise<t.RelPath[]> {
  let filenames: t.RelPath[] = [];
  try {
    filenames = (await fs.promises.readdir(path.join(root, rel))) as t.RelPath[];
  } catch (error) {
    const rootDoesntExist = (error as NodeJS.ErrnoException).code === 'ENOENT' && rel !== path.CUR_DIR;
    if (!rootDoesntExist) throw error;
  }

  filenames.sort();
  for (const childname of filenames) {
    const childRel = path.join(rel, childname);
    const childFull = path.join(root, childRel);
    const stat = await fs.promises.stat(childFull);

    if (stat.isDirectory()) {
      await readDirRecursively(root, options, childRel, res);
    }

    if ((stat.isDirectory() && options.includeDirs) || (stat.isFile() && options.includeFiles)) {
      res.push(childRel);
    }
  }
  return res;
}

export function textDocumentFromVsc(vscTextDocument: vscode.TextDocument, uri: t.Uri): ir.TextDocument {
  return new ir.TextDocument(
    uri,
    _.times(vscTextDocument.lineCount, i => vscTextDocument.lineAt(i).text),
    eolFromVsc(vscTextDocument.eol),
  );
}

export function openTextDocumentFromVsc(
  session: ir.Session,
  vscTextDocument: vscode.TextDocument,
  uri: t.Uri,
): ir.TextDocument {
  let textDocument = session.findTextDocumentByUri(uri);
  if (!textDocument) {
    textDocument = textDocumentFromVsc(vscTextDocument, uri);
    session.textDocuments.push(textDocument);
  }
  return textDocument;
}

export function openTextEditorFromVsc(
  session: ir.Session,
  vscTextDocument: vscode.TextDocument,
  uri: t.Uri,
  selections: ir.Selection[],
  visibleRange: ir.Range,
): ir.TextEditor {
  // const selections = selectionsFromVsc(vscTextEditor.selections);
  // const visibleRange = rangeFromVsc(vscTextEditor.visibleRanges[0]);
  const textDocument = openTextDocumentFromVsc(session, vscTextDocument, uri);
  let textEditor = session.findTextEditorByUri(textDocument.uri);
  if (!textEditor) {
    textEditor = new ir.TextEditor(textDocument, selections, visibleRange);
    session.textEditors.push(textEditor);
  } else {
    textEditor.select(selections, visibleRange);
  }
  return textEditor;
}

export function eolFromVsc(eol: vscode.EndOfLine): t.EndOfLine {
  return eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
}

export async function syncSessionToVscodeAndDisk(session: ir.Session, targetUris?: t.Uri[]) {
  // Vscode does not let us close a TextDocument. We can only close tabs and tab groups.

  // all tabs that are not in this.textEditors should be closed
  for (const tabGroup of vscode.window.tabGroups.all) {
    for (const tab of tabGroup.tabs) {
      if (tab.input instanceof vscode.TabInputText) {
        if (shouldRecordVscUri(session.workspacePath, tab.input.uri)) {
          const uri = uriFromVsc(session.workspacePath, tab.input.uri);
          if (!session.findTextEditorByUri(uri)) {
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
      if (!session.findTextDocumentByUri(targetUri)) {
        const parsedUri = path.parseUri(targetUri);
        if (parsedUri.scheme === 'workspace') {
          await fs.promises.rm(path.join(session.workspacePath, parsedUri.path), { force: true });
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
    const workspaceFiles = await readDirRecursively(session.workspacePath, { includeFiles: true });
    for (const file of workspaceFiles) {
      const uri = path.workspaceUriFromRelPath(file);
      if (!session.findTextDocumentByUri(uri)) {
        await fs.promises.rm(path.join(session.workspacePath, file), { force: true });
      }
    }

    // set targetUris to this.textDocument's uris
    targetUris = session.textDocuments.map(d => d.uri);
  }

  // for now, just delete empty directories
  const dirs = await readDirRecursively(session.workspacePath, { includeDirs: true });
  const sessionParsedUris = session.textDocuments.map(d => path.parseUri(d.uri));
  for (const dir of dirs) {
    const dirIsEmpty = !sessionParsedUris.some(u => u.scheme === 'workspace' && path.isBaseOf(dir, u.path));
    if (dirIsEmpty) await fs.promises.rm(path.join(session.workspacePath, dir), { force: true, recursive: true });
  }

  // for each targetUri
  //   if there's a textDocument open in vscode, replace its content
  //   else, mkdir and write to file
  for (const targetUri of targetUris) {
    const textDocument = session.findTextDocumentByUri(targetUri);
    if (!textDocument) continue; // already deleted above

    const parsedUri = path.parseUri(targetUri);
    assert(parsedUri.scheme === 'workspace', 'TODO only supports workspace uri');
    const absPath = path.join(session.workspacePath, parsedUri.path);
    const vscTextDocument = findVscTextDocumentByAbsPath(absPath);
    if (vscTextDocument) {
      const vscTextEditor = await vscode.window.showTextDocument(vscTextDocument, { preserveFocus: true });
      await vscTextEditor.edit(editBuilder => {
        editBuilder.replace(getVscTextDocumentRange(vscTextDocument), textDocument.getText());
      });
      await vscTextDocument.save();
    } else {
      await fs.promises.mkdir(path.dirname(absPath), { recursive: true });
      await fs.promises.writeFile(absPath, textDocument.getText(), 'utf8');
    }
  }

  // open all this.textEditors
  for (const textEditor of session.textEditors) {
    const vscUri = uriToVsc(session.workspacePath, textEditor.document.uri);
    await vscode.window.showTextDocument(vscUri, {
      preview: false,
      preserveFocus: true,
      selection: selectionToVsc(textEditor.selections[0]),
      viewColumn: vscode.ViewColumn.One,
    });
  }

  // show this.activeTextEditor
  if (session.activeTextEditor) {
    const vscUri = uriToVsc(session.workspacePath, session.activeTextEditor.document.uri);
    await vscode.window.showTextDocument(vscUri, {
      preview: false,
      preserveFocus: false,
      selection: selectionToVsc(session.activeTextEditor.selections[0]),
      viewColumn: vscode.ViewColumn.One,
    });
  }
}

export function uriToVsc(workspacePath: t.AbsPath, uri: t.Uri): vscode.Uri {
  const parsedUri = path.parseUri(uri);
  assert(parsedUri.scheme === 'workspace', 'TODO only supports workspace uri');
  return vscode.Uri.file(path.join(workspacePath, parsedUri.path));
}

export function findVscTextDocumentByAbsPath(p: t.AbsPath): vscode.TextDocument | undefined {
  return vscode.workspace.textDocuments.find(d => d.uri.scheme === 'file' && d.uri.path === p);
}

export function findVscTextEditorByUri(
  textEditors: readonly vscode.TextEditor[],
  uri: vscode.Uri,
): vscode.TextEditor | undefined {
  const uriStr = uri.toString();
  return textEditors.find(x => x.document.uri.toString() === uriStr);
}
