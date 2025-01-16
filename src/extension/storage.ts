import * as t from '../lib/types.js';
import fs from 'fs';
import _ from 'lodash';
import stringify from 'json-stringify-pretty-compact';
import path from 'path';
import assert from '../lib/assert.js';

export async function readJSON<T>(p: string, defaultFn?: () => T): Promise<T> {
  try {
    const str = await fs.promises.readFile(p, 'utf8');
    return JSON.parse(str) as T;
  } catch (error: any) {
    if (!defaultFn || (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return defaultFn();
  }
}

export async function readJSONOptional<T>(p: string): Promise<T | undefined> {
  return readJSON(p, () => undefined);
}

export async function readStringOptional<T>(p: string): Promise<string | undefined> {
  try {
    return await fs.promises.readFile(p, 'utf8');
  } catch (error: any) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

export async function writeJSON(p: string, data: any) {
  assert(data);
  const str = stringify(data, { maxLength: 200, indent: 2 });
  assert(str);
  await writeString(p, str);
}

export async function writeBinary(p: string, buffer: NodeJS.ArrayBufferView) {
  await ensureContainingDir(p);
  await fs.promises.writeFile(p, buffer);
}

export async function writeString(p: string, str: string) {
  await ensureContainingDir(p);
  await fs.promises.writeFile(p, str, 'utf8');
}

export async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.promises.access(p);
    return true;
  } catch (error: any) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  return false;
}

export async function stat(p: string): Promise<fs.Stats | undefined> {
  try {
    const stat = await fs.promises.stat(p);
    return stat;
  } catch (error: any) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

export async function ensureContainingDir(p: string) {
  await fs.promises.mkdir(path.dirname(p), { recursive: true });
}
