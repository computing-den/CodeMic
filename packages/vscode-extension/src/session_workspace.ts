import { types as t, path, ir, lib, assert } from '@codecast/lib';
import os from 'os';
import * as fs from 'fs';
import Db from './db.js';
import { SessionIO } from './session.js';
import * as misc from './misc.js';
import Workspace from './workspace.js';
import * as vscode from 'vscode';
import _ from 'lodash';
import nodePath from 'path';

export type ReadDirOptions = { includeDirs?: boolean; includeFiles?: boolean };

export default class SessionWorkspace extends Workspace {
  constructor(public root: t.AbsPath, public session: ir.Session, public io: SessionIO) {
    super(root);
  }

  static async populateSession(
    db: Db,
    rootStr: string,
    sessionSummary: t.SessionSummary,
    seekClock?: number,
    cutClock?: number,
  ): Promise<SessionWorkspace | undefined> {
    const root = path.abs(nodePath.resolve(rootStr));
    // user confirmations and root directory creation
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

    // read the session and cut it to cutClock.
    const sessionIO = new SessionIO(db, sessionSummary.id);
    const sessionJson = await db.readSession(sessionSummary.id);
    const session = await ir.Session.fromJSON(root, sessionIO, sessionSummary, sessionJson);
    if (cutClock !== undefined) session.cut(cutClock);
    const workspace = new SessionWorkspace(root, session, sessionIO);

    // seek if necessary
    let targetUris: t.Uri[] | undefined;
    if (seekClock) {
      const uriSet: t.UriSet = {};
      const seekData = session.getSeekData(seekClock);
      await session.seek(seekData, uriSet);
      targetUris = Object.keys(uriSet);
    }

    // sync, save and return
    await workspace.syncSessionToVscodeAndDisk(targetUris);
    await workspace.saveAllRelevantVscTabs();
    return workspace;
  }

  static async fromDirAndVsc(db: Db, summary: t.SessionSummary, rootStr: string): Promise<SessionWorkspace> {
    const root = path.abs(nodePath.resolve(rootStr));
    const sessionIO = new SessionIO(db, summary.id);
    const sessionJSON: t.SessionJSON = {
      events: [],
      audioTracks: [],
      defaultEol: os.EOL as t.EndOfLine,
      initSnapshot: ir.makeEmptySessionSnapshot(),
    };
    const session = await ir.Session.fromJSON(root, sessionIO, summary, sessionJSON);
    const workspace = new SessionWorkspace(root, session, sessionIO);
    const initSnapshot = await workspace.createSessionSnapshotFromDirAndVsc();
    await session.setInitSnapshotAndRestore(initSnapshot);
    return workspace;
  }

  async createSessionSnapshotFromDirAndVsc(): Promise<t.SessionSnapshot> {
    for (const vscTextDocument of vscode.workspace.textDocuments) {
      if (vscTextDocument.isDirty) {
        throw new Error('Checkpoint.fromWorkspace: there are unsaved files in the current workspace.');
      }
    }

    // Create the worktree.
    // TODO: ignore files in .gitignore and .codecastignore
    const worktree: t.Worktree = {};
    const paths = await this.readDirRecursively({ includeFiles: true });
    for (const p of paths) {
      const uri = path.workspaceUriFromRelPath(p);
      const data = await fs.promises.readFile(path.join(this.root, p));
      const sha1 = await misc.computeSHA1(data);
      worktree[uri] = { type: 'local', sha1 };
    }

    // Get textEditors from vscode.window.visibleTextEditors first. These have selections and visible range.
    // Then get the rest from vscode.window.tabGroups. These don't have selections and range.
    const textEditors = vscode.window.visibleTextEditors
      .filter(e => this.shouldRecordVscUri(e.document.uri))
      .map(e => this.makeSnapshotTextEditorFromVsc(e));

    const tabUris = this.getRelevantTabUris();
    for (const uri of tabUris) {
      if (!textEditors.some(e => e.uri === uri)) {
        textEditors.push(ir.makeSnapshotTextEditor(uri));
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

  async syncSessionToVscodeAndDisk(targetUris?: t.Uri[]) {
    // Vscode does not let us close a TextDocument. We can only close tabs and tab groups.

    const { root, session } = this;

    // TODO having both directories and files in targetUris and session.worktree can make things
    //      a bit confusing. Especially when it comes to deleting directories when there's
    //      still a file inside but is supposed to be ignored according to .gitignore or .codecastignore
    //      I think it's best to keep the directory structure in a separate variable than session.worktree
    //      worktreeFiles: {[key: Uri]: WorktreeFile} vs worktreeDirs: Uri[]
    // assert(_.values(session.worktree).every(item => item.file.type !== 'dir'));
    // assert(!targetUris || targetUris.every(uri => session.worktree[uri]?.file.type !== 'dir'));

    // all text editor tabs that are not in session's textEditors should be closed
    for (const tabGroup of vscode.window.tabGroups.all) {
      for (const tab of tabGroup.tabs) {
        if (tab.input instanceof vscode.TabInputText && this.shouldRecordVscUri(tab.input.uri)) {
          const uri = this.uriFromVsc(tab.input.uri);
          if (!session.findTextEditorByUri(uri)) {
            const vscTextDocument = await vscode.workspace.openTextDocument(tab.input.uri);
            await vscTextDocument.save();
            await vscode.window.tabGroups.close(tab);
          }
        }
      }
    }

    if (targetUris) {
      // all files in targetUris that are no longer in session's worktree should be deleted
      for (const targetUri of targetUris) {
        if (!session.doesUriExist(targetUri)) {
          if (path.isWorkspaceUri(targetUri)) {
            await fs.promises.rm(path.getFileUriPath(this.resolveUri(targetUri)), { force: true });
          }
        }
      }
    } else {
      // all files in workspace that are not in session's worktree should be deleted
      const workspaceFiles = await this.readDirRecursively({ includeFiles: true });
      for (const file of workspaceFiles) {
        const uri = path.workspaceUriFromRelPath(file);
        if (!session.doesUriExist(uri)) {
          await fs.promises.rm(path.join(root, file), { force: true });
        }
      }

      // set targetUris to all known uris in session
      targetUris = session.getWorktreeUris();
    }

    // for now, just delete empty directories
    {
      const dirs = await this.readDirRecursively({ includeDirs: true });
      const workspaceUriPaths = session.getWorktreeUris().filter(path.isWorkspaceUri).map(path.getWorkspaceUriPath);
      for (const dir of dirs) {
        const dirIsEmpty = !workspaceUriPaths.some(p => path.isBaseOf(dir, p));
        if (dirIsEmpty) await fs.promises.rm(path.join(root, dir), { force: true, recursive: true });
      }
    }

    // for each targetUri
    //   if it doesn't exist in session.worktree, it's already been deleted above, so ignore it
    //   if there's a textDocument open in vscode, replace its content
    //   else, mkdir and write to file
    {
      const targetUrisOutsideVsc: t.Uri[] = [];
      const edit = new vscode.WorkspaceEdit();
      for (const targetUri of targetUris) {
        assert(path.isWorkspaceUri(targetUri), 'TODO currently, we only support workspace URIs');

        if (session.doesUriExist(targetUri)) {
          const vscTextDocument = this.findVscTextDocumentByUri(targetUri);
          if (vscTextDocument) {
            const text = new TextDecoder().decode(await session.getContentByUri(targetUri));
            edit.replace(vscTextDocument.uri, this.getVscTextDocumentRange(vscTextDocument), text);
          } else {
            targetUrisOutsideVsc.push(targetUri);
          }
        }
      }
      await vscode.workspace.applyEdit(edit);

      for (const targetUri of targetUrisOutsideVsc) {
        const data = await session.getContentByUri(targetUri);
        const absPath = path.getFileUriPath(this.resolveUri(targetUri));
        await fs.promises.mkdir(path.dirname(absPath), { recursive: true });
        await fs.promises.writeFile(absPath, data);
      }
    }

    // open all session's textEditors in vscdoe
    {
      const tabUris = this.getRelevantTabUris();
      for (const textEditor of session.textEditors) {
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
    if (session.activeTextEditor) {
      const vscUri = this.uriToVsc(session.activeTextEditor.document.uri);
      await vscode.window.showTextDocument(vscUri, {
        preview: false,
        preserveFocus: false,
        selection: this.selectionToVsc(session.activeTextEditor.selections[0]),
        viewColumn: vscode.ViewColumn.One,
      });
    }
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
