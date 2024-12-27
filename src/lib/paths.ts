import { isWindows, isBrowser } from './platform.js';
import path from 'path';

// const SEP = isWindows ? '\\' : '/';

export function getDefaultWorkspaceBasePath(home: string): string {
  return path.join(home, 'CodeMic');
}

// export type SessionDataPathOpts = 'head.json' | 'body.json' | 'body.zip' | 'cover' | 'blobs' | { blob: string };

// export function fromWorkspace(opts?: SessionDataPathOpts): string[] {
//   return ['.CodeMic', ...fromSessionData(opts)];
// }

// export function fromSessionData(opts?: SessionDataPathOpts): string[] {
//   if (!opts) return [];
//   if (opts === 'head.json') return ['head.json'];
//   if (opts === 'body.json') return ['body.json'];
//   if (opts === 'body.zip') return ['body.zip'];
//   if (opts === 'cover') return ['cover'];
//   if (opts === 'blobs') return ['blobs'];
//   if ('blob' in opts) return ['blobs', opts.blob];

//   throw new Error(`fromSessionData: unknown opts: ${JSON.stringify(opts)}`);
// }

// /**
//  * We don't want to import the path module here. In the browser the path module
//  * resolves to path-browserify which only provides the posix API.
//  */
// function join(...paths: string[]) {
//   return paths.join(SEP);
// }
