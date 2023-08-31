import { types as t, lib, path } from '@codecast/lib';
import userPaths from './user_paths.js';
import fs from 'fs';
import _ from 'lodash';

export type DbData = {
  sessionSummaries: t.SessionSummaryMap;
  settings: t.Settings;
};

// export type Updater = (data: DbData, flushImmediately: boolean) => void;
// export type DbConsumer = (data: DbData, updater: Updater) => void;

class Db {
  constructor(public sessionSummaries: t.SessionSummaryMap, public settings: t.Settings) {}

  static async init(): Promise<Db> {
    await fs.promises.mkdir(userPaths.data, { recursive: true });
    const sessionSummaries =
      (await readAndParseJSON<t.SessionSummaryMap>(path.abs(userPaths.data, 'session_summaries.json'))) ?? {};
    const settings = (await readAndParseJSON<t.Settings>(path.abs(userPaths.data, 'settings.json'))) ?? {
      history: [],
      workspace: [],
    };
    return new Db(sessionSummaries, settings);
  }

  write = lib.taskQueue(async () => {
    // stringify everything first before calling any async function
    const sessionSummaries = JSON.stringify(this.sessionSummaries);
    const settings = JSON.stringify(this.settings);

    await fs.promises.writeFile(path.abs(userPaths.data, 'sessionSummaries.json'), sessionSummaries, 'utf8');
    await fs.promises.writeFile(path.abs(userPaths.data, 'settings.json'), settings, 'utf8');
  });

  async writeSession(session: t.SessionJSON) {
    const dir = path.abs(userPaths.data, 'sessions');
    const file = path.abs(dir, `${session.summary.id}.json`);
    await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.writeFile(file, JSON.stringify(session, null, 2), 'utf8');
  }

  async readSession(id: string): Promise<t.SessionJSON> {
    const file = path.abs(userPaths.data, 'sessions', `${id}.json`);
    return JSON.parse(await fs.promises.readFile(file, 'utf8'));
  }

  // acquire = lib.taskQueue()
  // async update(updater: Updater) {
  //   this.data = await updater(this.data) || this.data;
  //   if (!this.flus) this.timeout = setTimeout();
  // }

  getSessionSummary(id: string): t.SessionSummary | undefined {
    return _.find(this.sessionSummaries, ['id', id]);
  }

  getRecentSessionSummaries(): t.SessionSummary[] {
    return this.settings.history.map(id => this.sessionSummaries[id]).filter(Boolean);
  }

  getWorkspaceSessionSummaries(): t.SessionSummary[] {
    return this.settings.workspace.map(id => this.sessionSummaries[id]).filter(Boolean);
  }

  insertRecentSessionSummary(session: t.SessionSummary) {
    this.settings.history.unshift(session.id);
    this.settings.history = _.uniq(this.settings.history);
    if (!this.sessionSummaries[session.id]) {
      this.sessionSummaries[session.id] = session;
    }
  }

  insertWorkspaceSessionSummary(session: t.SessionSummary) {
    this.settings.workspace.unshift(session.id);
    this.settings.workspace = _.uniq(this.settings.workspace);
    if (!this.sessionSummaries[session.id]) {
      this.sessionSummaries[session.id] = session;
    }
  }
}

async function readAndParseJSON<T>(p: t.AbsPath): Promise<T | undefined> {
  try {
    const str = await fs.promises.readFile(p, 'utf8');
    return JSON.parse(str) as T;
  } catch (error: any) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return undefined;
  }
}

export default Db;
