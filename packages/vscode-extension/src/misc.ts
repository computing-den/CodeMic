import * as vscode from 'vscode';
import path from 'path';
import os from 'os';
import fs from 'fs';
import * as git from './git';
import { types as t } from '@codecast/lib';
import _ from 'lodash';
import assert from 'assert';

export function getWholeTextDocumentRange(document: vscode.TextDocument): vscode.Range {
  return document.validateRange(new vscode.Range(0, 0, document.lineCount, 0));
}

export function unreachable(arg: never, message: string = 'Unreachable'): never {
  throw new Error(message);
}

export function isEqualUri(a: vscode.Uri, b: vscode.Uri) {
  return a.scheme === b.scheme && a.path === b.path;
}

export function getRecordingsPath(): string {
  return path.join(os.homedir(), 'codecast', 'recordings');
}

export function getDefaultRecordingPath(): string {
  return path.join(getRecordingsPath(), 'session.codecast');
}

export async function getGitAPI(): Promise<git.API> {
  const extension = vscode.extensions.getExtension('vscode.git') as vscode.Extension<git.GitExtension>;

  if (!extension) throw new Error('Git extension not found');
  const git = extension.isActive ? extension.exports : await extension.activate();
  return git.getAPI(1);
}

export function duplicateSelections(selections: readonly vscode.Selection[]): vscode.Selection[] {
  return selections.map(duplicateSelection);
}

export function duplicateSelection(selection: vscode.Selection): vscode.Selection {
  return new vscode.Selection(selection.anchor, selection.active);
}

export function duplicateRanges(ranges: readonly vscode.Range[]): vscode.Range[] {
  return ranges.map(duplicateRange);
}

export function duplicateRange(range: vscode.Range): vscode.Range {
  return new vscode.Range(range.start, range.end);
}

export function getRelUri(workspacePath: string, uri: vscode.Uri): vscode.Uri | undefined {
  // TODO remember that untitled uri's path may or may not be an actual path, it might just be a name
  assert(uri.scheme !== 'untitled', 'TODO: untitled uri is not yet supported.');

  if (uri.scheme === 'file') {
    const p = path.relative(path.resolve(workspacePath), path.resolve(uri.path));
    if (!p.startsWith('../')) {
      return vscode.Uri.from({ scheme: 'file', path: p });
    }
  }
  return undefined;
}

export function getAbsUri(workspacePath: string, uri: vscode.Uri): vscode.Uri | undefined {
  // TODO remember that untitled uri's path may or may not be an actual path, it might just be a name
  assert(uri.scheme !== 'untitled', 'TODO: untitled uri is not yet supported.');

  if (uri.scheme === 'file') {
    return vscode.Uri.from({ scheme: 'file', path: path.join(path.resolve(workspacePath), path.resolve(uri.path)) });
  } else {
    return undefined;
  }
}

export function uriFromVsc(uri: vscode.Uri): t.Uri {
  // TODO remember that untitled uri's path may or may not be an actual path, it might just be a name
  assert(uri.scheme !== 'untitled', 'TODO: untitled uri is not yet supported.');
  assert(uri.scheme === 'file');
  return { scheme: uri.scheme, path: uri.path };
}

// Returns a sorted list of all files. It excludes empty directories.
export async function readDirRecursively(root: string, rel: string = '', res: string[] = []): Promise<string[]> {
  let filenames: string[] = [];
  try {
    filenames = await fs.promises.readdir(path.join(root, rel));
  } catch (error) {
    const rootDoesntExist = (error as NodeJS.ErrnoException).code === 'ENOENT' && !rel;
    if (!rootDoesntExist) throw error;
  }

  filenames.sort();
  for (const childname of filenames) {
    const childRel = path.join(rel, childname);
    const childFull = path.join(root, childRel);
    const stat = await fs.promises.stat(childFull);

    if (stat.isDirectory()) {
      await readDirRecursively(root, childRel, res);
    } else if (stat.isFile()) {
      res.push(childRel);
    }
  }
  return res;
}

// Returns a sorted list of all file URIs. It excludes empty directories.
export async function readDirRecursivelyUri(root: string, rel: string = '', res: string[] = []): Promise<vscode.Uri[]> {
  const files = await readDirRecursively(root);
  return files.map(file => vscode.Uri.from({ scheme: 'file', path: file }));
}
