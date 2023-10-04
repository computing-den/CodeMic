import { types as t, lib, path, assert } from '@codecast/lib';
import userPaths from './user_paths.js';
import fs from 'fs';
import _ from 'lodash';

export type DbData = {
  sessionSummaries: t.SessionSummaryMap;
  settings: t.Settings;
};

export type WriteOptions = {
  ifDirtyForLong?: boolean;
  waitMs?: number;
};

export default class Db {
  lastWriteTime = 0;
  constructor(public sessionSummaries: t.SessionSummaryMap, public settings: t.Settings) {}

  static async init(): Promise<Db> {
    await fs.promises.mkdir(userPaths.data, { recursive: true });
    const sessionSummaries = await readSessionSummaries();
    const settings = await readSettings();
    return new Db(sessionSummaries, settings);
  }

  write = lib.taskQueue(async (options?: WriteOptions) => {
    const ifDirtyForLong = options?.ifDirtyForLong ?? false;
    const waitMs = options?.waitMs ?? 5000;
    if (ifDirtyForLong && Date.now() < this.lastWriteTime + waitMs) return;

    // If there are multiple files, stringify everything first before calling any async function
    const settingsStr = stringify(this.settings);
    await writeDataFile('settings.json', settingsStr);
    this.lastWriteTime = Date.now();
  });

  async writeSession(session: t.Session, sessionSummary: t.SessionSummary) {
    console.log('writeSession: ', session, sessionSummary);
    // If there are multiple files, stringify everything first before calling any async function
    const sessionStr = stringify(session);
    const sessionSummaryStr = stringify(sessionSummary);

    await writeSessionFile(sessionSummary.id, 'session.json', sessionStr);
    await writeSessionFile(sessionSummary.id, 'summary.json', sessionSummaryStr);
    this.sessionSummaries[sessionSummary.id] = sessionSummary;
  }

  async writeSessionSummary(sessionSummary: t.SessionSummary) {
    // If there are multiple files, stringify everything first before calling any async function
    const sessionSummaryStr = stringify(sessionSummary);
    await writeSessionFile(sessionSummary.id, 'summary.json', sessionSummaryStr);
    this.sessionSummaries[sessionSummary.id] = sessionSummary;
  }

  async readSession(id: string): Promise<t.Session> {
    return readSession(id);
  }

  async readSessionBlobBySha1(sessionId: string, sha1: string): Promise<Uint8Array> {
    const p = path.abs(userPaths.data, 'sessions', sessionId, 'blobs', sha1);
    return fs.promises.readFile(p);
  }

  mergeSessionHistory(h: t.SessionHistoryItem) {
    this.settings.history[h.id] = { ...this.settings.history[h.id], ...h };
  }

  async deleteSession(id: string) {
    delete this.sessionSummaries[id];
    await fs.promises.rm(path.abs(userPaths.data, 'sessions', id), { force: true, recursive: true });
  }

  async copySession(from: t.SessionSummary, to: t.SessionSummary) {
    const fromPath = path.abs(userPaths.data, 'sessions', from.id);
    const toPath = path.abs(userPaths.data, 'sessions', to.id);
    await fs.promises.cp(fromPath, toPath);
    await this.writeSessionSummary(to);
  }
}

async function readAndParseJSON<T>(p: t.AbsPath, defaultFn?: () => T): Promise<T> {
  try {
    const str = await fs.promises.readFile(p, 'utf8');
    return JSON.parse(str) as T;
  } catch (error: any) {
    if (!defaultFn || (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return defaultFn();
  }
}

function stringify(json: any): string {
  return JSON.stringify(json, null, 2);
}

async function writeSessionFile(id: string, relFilePath: string, data: string | Uint8Array): Promise<void> {
  await writeDataFile(path.rel('sessions', id, relFilePath), data);
}

async function writeDataFile(relFilePath: string, data: string | Uint8Array): Promise<void> {
  const file = path.abs(userPaths.data, relFilePath);
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  if (typeof data === 'string') {
    await fs.promises.writeFile(file, data, 'utf8');
  } else {
    await fs.promises.writeFile(file, data);
  }
}

/**
 * It never throws an error.
 */
async function readSessionSummaries(): Promise<t.SessionSummaryMap> {
  let sessionIds: string[];
  try {
    sessionIds = await fs.promises.readdir(path.abs(userPaths.data, 'sessions'));
  } catch (error: any) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return {};
  }

  sessionIds = sessionIds.filter(id => id.length === 36);
  const settled = await Promise.allSettled(sessionIds.map(readSessionSummary));
  const fulfilled = settled.filter(isFulfilled);
  const summaries = fulfilled.map(x => x.value);
  return _.keyBy(summaries, 'id');
}

function readSessionSummary(id: string): Promise<t.SessionSummary> {
  return readAndParseJSON<t.SessionSummary>(path.abs(userPaths.data, 'sessions', id, `summary.json`));
}

function readSettings(): Promise<t.Settings> {
  return readAndParseJSON<t.Settings>(path.abs(userPaths.data, 'settings.json'), makeDefaultSettings);
}

function readSession(id: string): Promise<t.Session> {
  return readAndParseJSON<t.Session>(path.abs(userPaths.data, 'sessions', id, `session.json`));
}

function makeDefaultSettings(): t.Settings {
  return { history: {} };
}

function isFulfilled<T>(x: PromiseSettledResult<T>): x is PromiseFulfilledResult<T> {
  return x.status === 'fulfilled';
}
