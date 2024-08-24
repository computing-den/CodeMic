import { types as t, path } from '@codecast/lib';
import { basename } from 'path';
import os from 'os';
import process from 'process';
import _ from 'lodash';

export type BasePaths = {
  data: t.AbsPath;
  config: t.AbsPath;
  cache: t.AbsPath;
  log: t.AbsPath;
  temp: t.AbsPath;
};

export type DataPaths = {
  root: t.AbsPath;
  settings: t.AbsPath;
  sessions: t.AbsPath;
  session: (id: string) => SessionDataPaths;
};

export type SessionDataPaths = {
  root: t.AbsPath;
  head: t.AbsPath;
  body: t.AbsPath;
  zip: t.AbsPath;
  blobs: t.AbsPath;
  blob: (sha1: string) => t.AbsPath;
};

export type DefaultWorkspacePaths = {
  root: t.AbsPath;
  session: (id: string) => DefaultSessionWorkspacePaths;
};

export type DefaultSessionWorkspacePaths = {
  root: t.AbsPath;
};

function macos(name: string): BasePaths {
  return {
    data: path.abs(os.homedir(), 'Library', 'Application Support', name),
    config: path.abs(os.homedir(), 'Library', 'Preferences', name),
    cache: path.abs(os.homedir(), 'Library', 'Caches', name),
    log: path.abs(os.homedir(), 'Library', 'Logs', name),
    temp: path.abs(os.tmpdir(), name),
  };
}

function windows(name: string): BasePaths {
  const appData = process.env.APPDATA || path.abs(os.homedir(), 'AppData', 'Roaming');
  const localAppData = process.env.LOCALAPPDATA || path.abs(os.homedir(), 'AppData', 'Local');

  return {
    // Data/config/cache/log are invented by me as Windows isn't opinionated about this
    data: path.abs(localAppData, name, 'Data'),
    config: path.abs(appData, name, 'Config'),
    cache: path.abs(localAppData, name, 'Cache'),
    log: path.abs(localAppData, name, 'Log'),
    temp: path.abs(os.tmpdir(), name),
  };
}

// https://specifications.freedesktop.org/basedir-spec/basedir-spec-latest.html
function linux(name: string): BasePaths {
  return {
    data: path.abs(process.env.XDG_DATA_HOME || path.abs(os.homedir(), '.local', 'share'), name),
    config: path.abs(process.env.XDG_CONFIG_HOME || path.abs(os.homedir(), '.config'), name),
    cache: path.abs(process.env.XDG_CACHE_HOME || path.abs(os.homedir(), '.cache'), name),
    // https://wiki.debian.org/XDGBaseDirectorySpecification#state
    log: path.abs(process.env.XDG_STATE_HOME || path.abs(os.homedir(), '.local', 'state'), name),
    temp: path.abs(os.tmpdir(), basename(os.homedir()), name),
  };
}

function getBasePaths(name: string) {
  if (process.platform === 'darwin') return macos(name);
  if (process.platform === 'win32') return windows(name);
  return linux(name);
}

export const basePaths = getBasePaths('codecast');

export const ANONYM = '_'; // minimum valid username is 3 characters

export const dataPaths = _.memoize((username?: string): DataPaths => {
  const root = path.abs(basePaths.data, username ?? ANONYM);
  return {
    root,
    settings: path.abs(root, 'settings.json'),
    sessions: path.abs(root, 'sessions'),
    session: _.memoize(id => {
      const sessionRoot = path.abs(root, 'sessions', id);
      return {
        root: sessionRoot,
        head: path.abs(sessionRoot, 'head.json'),
        body: path.abs(sessionRoot, 'body.json'),
        zip: path.abs(sessionRoot, 'body.zip'),
        blobs: path.abs(sessionRoot, 'blobs'),
        blob: _.memoize(sha1 => path.abs(sessionRoot, 'blobs', sha1)),
      };
    }),
  };
});

const workspacePath = path.abs(os.homedir(), 'codecast');

export const defaultWorkspacePaths = {
  root: workspacePath,
  session: _.memoize(id => {
    const sessionRoot = path.abs(workspacePath, id);
    return {
      root: sessionRoot,
    };
  }),
};
