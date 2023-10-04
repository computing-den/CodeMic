import * as vscode from 'vscode';
import path from 'path';
import os from 'os';
import fs from 'fs';
import * as git from './git';
import { types as t } from '@codecast/lib';
import _ from 'lodash';
import assert from 'assert';
import crypto from 'crypto';

// export function getRecordingsPath(): t.AbsPath {
//   return path.join(os.homedir(), 'codecast', 'recordings') as t.AbsPath;
// }

// export function getDefaultRecordingPath(): t.AbsPath {
//   return path.join(getRecordingsPath(), 'session.codecast') as t.AbsPath;
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
  assert(path.isAbsolute(p));
  const rel = path.relative(os.homedir(), p);
  if (rel.startsWith('..' + path.sep)) {
    return p;
  } else {
    return path.join('~', rel);
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
