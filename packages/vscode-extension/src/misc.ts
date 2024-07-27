import * as vscode from 'vscode';
import nodePath from 'path';
import os from 'os';
import fs from 'fs';
import * as git from './git';
import { types as t, path } from '@codecast/lib';
import _ from 'lodash';
import assert from 'assert';
import crypto from 'crypto';

// export function getRecordingsPath(): t.AbsPath {
//   return nodePath.join(os.homedir(), 'codecast', 'recordings') as t.AbsPath;
// }

// export function getDefaultRecordingPath(): t.AbsPath {
//   return nodePath.join(getRecordingsPath(), 'session.codecast') as t.AbsPath;
// }

export async function getGitAPI(): Promise<git.API> {
  const extension = vscode.extensions.getExtension('vscode.git') as vscode.Extension<git.GitExtension>;

  if (!extension) throw new Error('Git extension not found');
  const git = extension.isActive ? extension.exports : await extension.activate();
  return git.getAPI(1);
}

/**
 * Given '/home/sean/abc/' will return '~/abc/'.
 * p must be absolute.
 */
export function shortenPath(p: string): string {
  assert(nodePath.isAbsolute(p));
  const rel = nodePath.relative(os.homedir(), p);
  if (rel.startsWith('..' + nodePath.sep)) {
    return p;
  } else {
    return nodePath.join('~', rel);
  }
}

export async function fileExists(p: t.AbsPath): Promise<boolean> {
  try {
    await fs.promises.access(p);
    return true;
  } catch (error: any) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  return false;
}

export async function computeSHA1(data: Uint8Array): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-1', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export function getDefaultVscWorkspace(): t.AbsPath | undefined {
  // .uri can be undefined after user deletes the only folder from workspace
  // probably because it doesn't cause a vscode restart.
  const uri = vscode.workspace.workspaceFolders?.[0]?.uri;
  return uri?.scheme === 'file' ? path.abs(uri.path) : undefined;
}
