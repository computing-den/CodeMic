import * as t from '../lib/types.js';
import * as path from '../lib/path.js';
import fs from 'fs';
import _ from 'lodash';
import stringify from 'json-stringify-pretty-compact';

export async function readJSON<T>(p: t.AbsPath, defaultFn?: () => T): Promise<T> {
  try {
    const str = await fs.promises.readFile(p, 'utf8');
    return JSON.parse(str) as T;
  } catch (error: any) {
    if (!defaultFn || (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return defaultFn();
  }
}

export async function readJSONOptional<T>(p: t.AbsPath): Promise<T | undefined> {
  return readJSON(p, () => undefined);
}

export async function writeJSON(p: t.AbsPath, data: any) {
  await ensureContainingDir(p);
  await fs.promises.writeFile(p, stringify(data, { maxLength: 200, indent: 2 }), 'utf8');
}

export async function writeBinary(p: t.AbsPath, buffer: NodeJS.ArrayBufferView) {
  await ensureContainingDir(p);
  await fs.promises.writeFile(p, buffer);
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

export async function stat(p: t.AbsPath): Promise<fs.Stats | undefined> {
  try {
    const stat = await fs.promises.stat(p);
    return stat;
  } catch (error: any) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

export async function ensureContainingDir(p: t.AbsPath) {
  await fs.promises.mkdir(path.dirname(p), { recursive: true });
}
