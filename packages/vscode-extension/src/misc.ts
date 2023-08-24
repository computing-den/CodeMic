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
  return a.toString() === b.toString();
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

export function getPartialUri(workspacePath: string, uri: vscode.Uri): vscode.Uri | undefined {
  // TODO remember that untitled uri's path may or may not be an actual path, it might just be a name
  assert(uri.scheme !== 'untitled', 'TODO: untitled uri is not yet supported.');

  if (uri.scheme === 'file') {
    const p = path.relative(workspacePath, uri.path);
    if (!p.startsWith('../')) {
      return vscode.Uri.file(p);
    }
  }
  return undefined;
}

export function getFullUri(workspacePath: string, uri: vscode.Uri): vscode.Uri {
  // TODO remember that untitled uri's path may or may not be an actual path, it might just be a name
  assert(uri.scheme !== 'untitled', 'TODO: untitled uri is not yet supported.');

  if (uri.scheme === 'file') {
    return vscode.Uri.file(path.join(workspacePath, uri.path));
  }
  return uri;
}

export function uriFromVsc(uri: vscode.Uri): t.Uri {
  // TODO remember that untitled uri's path may or may not be an actual path, it might just be a name
  assert(uri.scheme !== 'untitled', 'TODO: untitled uri is not yet supported.');
  assert(uri.scheme === 'file');
  return { scheme: uri.scheme, path: uri.path };
}

export type ReadDirOptions = { includeDirs?: boolean; includeFiles?: boolean };

/**
 * Returns a sorted list of all files. It excludes empty directories.
 */
export async function readDirRecursively(
  root: string,
  options: ReadDirOptions,
  rel: string = '',
  res: string[] = [],
): Promise<string[]> {
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
      await readDirRecursively(root, options, childRel, res);
    }

    if ((stat.isDirectory() && options.includeDirs) || (stat.isFile() && options.includeFiles)) {
      res.push(childRel);
    }
  }
  return res;
}

// Returns a sorted list of all file URIs. It excludes empty directories.
export async function readDirRecursivelyUri(root: string, options: ReadDirOptions): Promise<vscode.Uri[]> {
  const files = await readDirRecursively(root, options);
  return files.map(file => vscode.Uri.file(file));
}

// Given '/home/sean/abc/' will return '~/abc/'.
// p must be absolute.
export function shortenPath(p: string): string {
  assert(path.isAbsolute(p));
  const rel = path.relative(os.homedir(), p);
  if (rel.startsWith('..' + path.sep)) {
    return p;
  } else {
    return path.join('~', rel);
  }
}
