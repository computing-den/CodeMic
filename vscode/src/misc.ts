import * as vscode from 'vscode';
import path from 'path';
import os from 'os';
import * as git from './git';
import _ from 'lodash';

export function getWholeTextDocumentRange(document: vscode.TextDocument): vscode.Range {
  return document.validateRange(new vscode.Range(0, 0, document.lineCount, 0));
}

export function unreachable(arg: never, message: string = 'Unreachable'): never {
  throw new Error(message);
}

export function isEqualUri(a: vscode.Uri, b: vscode.Uri) {
  return a.scheme === b.scheme && a.path === b.path;
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

// // If root is given and uri is a file with absolute path, it'll make the uri relative to root
// export function makeCcUri(uri: Uri, root?: string): CcUri {
//   let p = uri.path;
//   if (root && uri.scheme === 'file' && path.isAbsolute(p)) {
//     p = path.relative(root, p);
//   }
//   return { scheme: uri.scheme, path: p };
// }

// // If root is given and uri is a file with relative path, it'll join them
// export function makeUri(uri: CcUri, root?: string): Uri {
//   let p = uri.path;
//   if (root && uri.scheme === 'file' && !path.isAbsolute(p)) {
//     p = path.join(root, p);
//   }
//   return Uri.from({ scheme: uri.scheme, path: p });
// }

export const SUPPORTED_URI_SCHEMES = ['untitled', 'file'] as const;

export function isUriPartOfRecording(uri: vscode.Uri) {
  // TODO
  return true;
  // if (uri.scheme === 'untitled') {
  //   return true;
  // } else if (uri.scheme === 'file') {
  //   const rel = path.relative(workdir, uri.path);
  //   return !rel.startsWith('..');
  // }
  // return false;
}

// export function makeCcPos(p: Position): CcPos {
//   return { line: p.line, col: p.character };
// }

// export function makePosition(p: CcPos): Position {
//   return new Position(p.line, p.col);
// }

// export function makeCcSelection(s: Selection): CcSelection {
//   return { anchor: makeCcPos(s.anchor), active: makeCcPos(s.active) };
// }

// export function makeSelection(s: CcSelection): Selection {
//   return new Selection(makePosition(s.anchor), makePosition(s.active));
// }

// export function makeCcRange(r: Range): CcRange {
//   return { start: makeCcPos(r.start), end: makeCcPos(r.end) };
// }

// export function makeRange(r: CcRange): Range {
//   return new Range(makePosition(r.start), makePosition(r.end));
// }

export function timeout(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Used to limit the number of simultaneous executions of async consumer.
 */
type Task = { args: any[]; resolve: Function; reject: Function };
type TaskConsumer = (...args: any[]) => Promise<any>;
type TaskQueue<F> = F & {
  clear(): void;
  getQueue(): Task[];
  getQueueSize(): number;
  getConsumerCount(): number;
};
export function taskQueue<F extends TaskConsumer>(consumer: F, maxConcurrency: number = 1): TaskQueue<F> {
  const queue: Task[] = [];
  let consumerCount = 0;

  function dispatch() {
    while (consumerCount < maxConcurrency && queue.length > 0) {
      consume(queue.shift()!);
    }
  }

  async function consume(task: Task) {
    consumerCount++;
    try {
      const res = await consumer(...task.args);
      task.resolve(res);
    } catch (error) {
      task.reject(error);
    } finally {
      consumerCount--;
      dispatch();
    }
  }

  function supply(...args: any[]): Promise<any> {
    return new Promise((resolve, reject) => {
      queue.push({ args, resolve, reject });
      dispatch();
    });
  }

  supply.clear = () => {
    queue.length = 0;
  };
  supply.getQueue = () => queue;
  supply.getQueueSize = () => queue.length;
  supply.getConsumerCount = () => consumerCount;
  return supply as TaskQueue<F>; // didn't find a better way to type this
}
