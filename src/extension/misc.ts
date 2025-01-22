import nodePath from 'path';
import os from 'os';
import * as t from '../lib/types.js';
import _ from 'lodash';
import assert from 'assert';
import crypto from 'crypto';
import type { Progress } from './types.js';

// /**
//  * Given '/home/sean/abc/' will return '~/abc/'.
//  * p must be absolute.
//  */
// export function shortenPath(p: string): string {
//   assert(nodePath.isAbsolute(p));
//   const rel = nodePath.relative(os.homedir(), p);
//   if (rel.startsWith('..' + nodePath.sep)) {
//     return p;
//   } else {
//     return nodePath.join('~', rel);
//   }
// }

export async function computeSHA1(data: Uint8Array): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-1', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export function scaleProgress(progress: Progress, multiplier: number): Progress {
  return {
    report: value => {
      progress.report({ ...value, increment: value?.increment && value.increment * multiplier });
    },
  };
}
