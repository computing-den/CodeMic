import { assert } from './assert.js';
import type * as t from './types.js';

export function workspaceUriFromRelPath(p: t.RelPath): t.Uri {
  return `workspace:${p}`;
}
export function workspaceUriFromAbsPath(base: t.AbsPath, p: t.AbsPath): t.Uri {
  return workspaceUriFromRelPath(relToBase(base, p));
}
export function untitledUriFromName(name: string): t.Uri {
  // assert(!name.includes('/'));
  return `untitled:${name}`;
}
export function fileUriFromAbsPath(p: t.AbsPath): t.Uri {
  return `file://${p}`;
}

export function isWorkspaceUri(uri: t.Uri): boolean {
  return uri.startsWith('workspace:');
}

export function isFileUri(uri: t.Uri): boolean {
  return uri.startsWith('file://');
}

export function isUntitledUri(uri: t.Uri): boolean {
  return uri.startsWith('untitled:');
}

export function getWorkspaceUriPath(uri: t.Uri): t.RelPath {
  const res = getWorkspaceUriPathOpt(uri);
  assert(res);
  return res;
}

export function getWorkspaceUriPathOpt(uri: t.Uri): t.RelPath | undefined {
  if (isWorkspaceUri(uri)) return uri.slice('workspace:'.length) as t.RelPath;
}

export function getFileUriPath(uri: t.Uri): t.AbsPath {
  const res = getFileUriPathOpt(uri);
  assert(res);
  return res;
}

export function getFileUriPathOpt(uri: t.Uri): t.AbsPath | undefined {
  if (isFileUri(uri)) return uri.slice('file://'.length) as t.AbsPath;
}

export function getUriPathOpt(uri: t.Uri): t.Path | undefined {
  return getWorkspaceUriPathOpt(uri) ?? getFileUriPathOpt(uri);
}

export function getUntitledUriName(uri: t.Uri): string {
  const res = getUntitledUriNameOpt(uri);
  assert(res);
  return res;
}

export function getUntitledUriNameOpt(uri: t.Uri): string | undefined {
  if (isUntitledUri(uri)) return uri.slice('untitled:'.length);
}

export function parseUri(uri: t.Uri): t.ParsedUri {
  if (uri.startsWith('workspace:')) {
    return { scheme: 'workspace', path: uri.slice('workspace:'.length) as t.RelPath };
  } else if (uri.startsWith('file://')) {
    return { scheme: 'file', path: uri.slice('file://'.length) as t.AbsPath };
  } else if (uri.startsWith('untitled:')) {
    return { scheme: 'untitled', name: uri.slice('untitled:'.length) };
  }
  throw new Error(`parseUri: unknown URI scheme: ${uri}`);
}

/**
 * Turns workspace URIs into file URIs. Doesn't touch other kinds of URIs.
 */
export function resolveUri(base: t.AbsPath, uri: t.Uri): t.Uri {
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

export const CUR_DIR = '.' as t.RelPath;

export function rel(p: string, ...rest: string[]): t.RelPath {
  p = normalize(p);
  rest = rest.map(normalize);
  assert(isRel(p), `abs: first part is not relative: ${p}`);
  assert(rest.every(isRel), `abs: remaining parts must be relative, instead got: ${rest.join(', ')}`);
  return join(p, ...rest);
}

export function abs(p: string, ...rest: string[]): t.AbsPath {
  p = normalize(p);
  rest = rest.map(normalize);
  assert(rest.every(isRel), `abs: remaining parts must be relative, instead got: ${rest.join(', ')}`);
  assert(isAbs(p), `abs: first part is not absolute: ${p}`);
  return join(p, ...rest);
}

export function isRel(p: string): p is t.RelPath {
  return Boolean(p && p[0] !== '/');
}

export function isAbs(p: string): p is t.AbsPath {
  return Boolean(p && p[0] === '/');
}

/**
 * Replaces all '\' with '/', '//' with '/', and removes all '/'s at the end of the path
 * Only valid use of '.' is for the entire path, not as path components.
 * Do not use '..' as they are not resolved and may cause issues when comparing two paths.
 */
export function normalize(p: string): t.Path {
  p = p
    .replace('\\', '/')
    .replace(/\/+$/, '')
    .replace(/\/{2,}/, '/');
  const parts = p.split('/');
  assert(p && !parts.includes('..') && (p === CUR_DIR || !parts.includes(CUR_DIR)), `Invalid path: "${p}"`);
  return p as t.Path;
}

export function toString(p: string, sep: '/' | '\\'): string {
  return p.replace('/', sep);
}

/**
 * Removes parts that are equal to '.' but the whole returned path may be '.'.
 */
export function join(a: t.AbsPath, ...rest: t.RelPath[]): t.AbsPath;
export function join(a: t.RelPath, ...rest: t.RelPath[]): t.RelPath;
export function join(...parts: t.Path[]): t.Path {
  return (parts
    .filter(p => p !== CUR_DIR)
    .join('/')
    .replace('//', '/') || CUR_DIR) as t.Path;
}

/**
 * dirname('.') => error
 * dirname('/') => error
 * dirname('a') => '.'
 * dirname('/a') => '/'
 * dirname('/a/b') => '/'
 */
export function dirname<T extends t.Path>(p: T): T {
  assert(!isTopLevel(p));
  // 'abc':  i = -1
  // '/a':   i =  0
  // '/a/b:  i =  2
  const i = p.lastIndexOf('/');
  if (i === -1) return CUR_DIR as T;
  if (i === 0) return '/' as T;
  return p.slice(0, i) as T;
}

export function basename(p: t.Path, options?: { omitExt: boolean }): string {
  const pathComps = p.split('/');
  let base = pathComps[pathComps.length - 1];

  if (options?.omitExt) {
    const parts = base.split('.');
    if (parts.length > 1) parts.pop();
    base = parts.join('.');
  }

  return base;
}

export function isTopLevel(p: t.Path): boolean {
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
export function isBaseOf<T extends t.Path>(base: T, p: T): boolean {
  return p.startsWith(base) && (base.length === p.length || p[base.length] === '/');
}

/**
 * relToBase('/', '/') => '.'
 * relToBase('/a', '/a/b') => 'b'
 * relToBase('/a', '/a/b/c') => 'b/c'
 * relToBase('/a', '/b/c') => error
 */
export function relToBase(base: t.AbsPath, p: t.AbsPath): t.RelPath {
  assert(isBaseOf(base, p));
  return (p.length === base.length ? CUR_DIR : p.slice(base.length + 1)) as t.RelPath;
}
