import assert from './assert.js';
import * as t from './types.js';
import { URI } from 'vscode-uri';

export function workspaceUriFromRelPath(p: string): string {
  return `workspace:${p}`;
}
export function workspaceUriFromAbsPath(base: string, p: string): string {
  return workspaceUriFromRelPath(relToBase(base, p));
}
export function untitledUriFromName(name: string): string {
  // assert(!name.includes('/'));
  return `untitled:${name}`;
}
export function fileUriFromAbsPath(p: string): string {
  return `file://${p}`;
}

export function isWorkspaceUri(uri: string): boolean {
  return uri.startsWith('workspace:');
}

export function isFileUri(uri: string): boolean {
  return uri.startsWith('file://');
}

export function isUntitledUri(uri: string): boolean {
  return uri.startsWith('untitled:');
}

export function getWorkspaceUriPath(uri: string): string {
  const res = getWorkspaceUriPathOpt(uri);
  assert(res);
  return res;
}

export function getWorkspaceUriPathOpt(uri: string): string | undefined {
  if (isWorkspaceUri(uri)) return uri.slice('workspace:'.length) as string;
}

export function getFileUriPath(uri: string): string {
  const res = getFileUriPathOpt(uri);
  assert(res);
  return res;
}

export function getFileUriPathOpt(uri: string): string | undefined {
  if (isFileUri(uri)) return uri.slice('file://'.length) as string;
}

export function getUriPathOpt(uri: string): string | undefined {
  return getWorkspaceUriPathOpt(uri) ?? getFileUriPathOpt(uri);
}

export function getUntitledUriName(uri: string): string {
  const res = getUntitledUriNameOpt(uri);
  assert(res);
  return res;
}

export function getUntitledUriNameOpt(uri: string): string | undefined {
  if (isUntitledUri(uri)) return uri.slice('untitled:'.length);
}

export function getUriShortNameOpt(uri: string): string | undefined {
  const p = getUriPathOpt(uri);
  return p ? basename(p) : getUntitledUriNameOpt(uri);
}

// export function parseUri(uri: string): t.ParsedUri {
//   if (uri.startsWith('workspace:')) {
//     return { scheme: 'workspace', path: uri.slice('workspace:'.length) as t.RelPath };
//   } else if (uri.startsWith('file://')) {
//     return { scheme: 'file', path: uri.slice('file://'.length) as t.AbsPath };
//   } else if (uri.startsWith('untitled:')) {
//     return { scheme: 'untitled', name: uri.slice('untitled:'.length) };
//   }
//   throw new Error(`parseUri: unknown URI scheme: ${uri}`);
// }

/**
 * Turns workspace URIs into file URIs. Doesn't touch other kinds of URIs.
 */
export function resolveUri(base: string, uri: string): string {
  if (isWorkspaceUri(uri)) return fileUriFromAbsPath(join(base, getWorkspaceUriPath(uri)));
  return uri;
}

// /**
//  * Uri path is always absolute.
//  * VSCode doesn't event allow relative paths in Uris and automatically prepends a slash.
//  */
// export class Uri {
//   constructor(
//     public scheme: 'file' | 'untitled' | 'http' | 'https',
//     public path: t.AbsPath,
//     public authority?: string,
//     public query?: string,
//     public fragment?: string,
//   ) {}

//   toString(): string {
//     return this.scheme + '://' + this.path;
//   }

//   isEqual(u: Uri): boolean {
//     return (
//       this.scheme === u.scheme &&
//       this.path === u.path &&
//       this.authority === u.authority &&
//       this.query === u.query &&
//       this.fragment === u.fragment
//     );
//   }
// }

export const CUR_DIR = '.' as string;

export function rel(p: string, ...rest: string[]): string {
  p = normalize(p);
  rest = rest.map(normalize);
  assert(isRel(p), `abs: first part is not relative: ${p}`);
  assert(rest.every(isRel), `abs: remaining parts must be relative, instead got: ${rest.join(', ')}`);
  return join(p, ...rest);
}

export function abs(p: string, ...rest: string[]): string {
  p = normalize(p);
  rest = rest.map(normalize);
  assert(rest.every(isRel), `abs: remaining parts must be relative, instead got: ${rest.join(', ')}`);
  assert(isAbs(p), `abs: first part is not absolute: ${p}`);
  return join(p, ...rest);
}

export function isRel(p: string): p is string {
  return Boolean(p && p[0] !== '/');
}

export function isAbs(p: string): p is string {
  return Boolean(p && p[0] === '/');
}

/**
 * Replaces all '\' with '/', '//' with '/', and removes all '/'s at the end of the path
 * Only valid use of '.' is for the entire path, not as path components.
 * Do not use '..' as they are not resolved and may cause issues when comparing two paths.
 */
export function normalize(p: string): string {
  p = p
    .replace('\\', '/')
    .replace(/\/+$/, '')
    .replace(/\/{2,}/, '/');
  const parts = p.split('/');
  assert(p && !parts.includes('..') && (p === CUR_DIR || !parts.includes(CUR_DIR)), `Invalid path: "${p}"`);
  return p as string;
}

export function toString(p: string, sep: '/' | '\\'): string {
  return p.replace('/', sep);
}

/**
 * Removes parts that are equal to '.' but the whole returned path may be '.'.
 */
export function join(a: string, ...rest: string[]): string;
export function join(a: string, ...rest: string[]): string;
export function join(...parts: string[]): string {
  return (parts
    .filter(p => p !== CUR_DIR)
    .join('/')
    .replace('//', '/') || CUR_DIR) as string;
}

/**
 * dirname('.') => error
 * dirname('/') => error
 * dirname('a') => '.'
 * dirname('/a') => '/'
 * dirname('/a/b') => '/'
 */
export function dirname<T extends string>(p: T): T {
  assert(!isTopLevel(p));
  // 'abc':  i = -1
  // '/a':   i =  0
  // '/a/b:  i =  2
  const i = p.lastIndexOf('/');
  if (i === -1) return CUR_DIR as T;
  if (i === 0) return '/' as T;
  return p.slice(0, i) as T;
}

export function basename(p: string, options?: { omitExt: boolean }): string {
  const pathComps = p.split('/');
  let base = pathComps[pathComps.length - 1];

  if (options?.omitExt) {
    const parts = base.split('.');
    if (parts.length > 1) parts.pop();
    base = parts.join('.');
  }

  return base;
}

export function isTopLevel(p: string): boolean {
  return p === '/' || p === CUR_DIR;
}

/**
 * isBaseOf('.', '.') => true
 * isBaseOf('/', '/') => true
 *
 * isBaseOf('/a', '/a/b') => true
 * isBaseOf('a', 'a/b') => true
 *
 * isBaseOf('a', 'b/c') => false
 * isBaseOf('/a', '/b/c') => false
 */
export function isBaseOf<T extends string>(base: T, p: T): boolean {
  return p.startsWith(base) && (base.length === p.length || p[base.length] === '/');
}

/**
 * relToBase('/', '/') => '.'
 * relToBase('/a', '/a/b') => 'b'
 * relToBase('/a', '/a/b/c') => 'b/c'
 * relToBase('/a', '/b/c') => error
 */
export function relToBase(base: string, p: string): string {
  assert(isBaseOf(base, p));
  return (p.length === base.length ? CUR_DIR : p.slice(base.length + 1)) as string;
}
