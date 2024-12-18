import * as t from '../lib/types.js';
import fs from 'fs';
import _ from 'lodash';
import stringify from 'json-stringify-pretty-compact';
import path from 'path';

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

export async function writeJSON(p: string, data: any) {
  await ensureContainingDir(p);
  await fs.promises.writeFile(p, stringify(data, { maxLength: 200, indent: 2 }), 'utf8');
}

export async function writeBinary(p: string, buffer: NodeJS.ArrayBufferView) {
  await ensureContainingDir(p);
  await fs.promises.writeFile(p, buffer);
}

export async function fileExists(p: string): Promise<boolean> {
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
