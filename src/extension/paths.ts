import * as t from '../lib/types.js';
import * as path from '../lib/path.js';
import { basename } from 'path';
import os from 'os';
import process from 'process';
import _ from 'lodash';

export type OSPaths = {
  data: t.AbsPath;
  config: t.AbsPath;
  cache: t.AbsPath;
  log: t.AbsPath;
  temp: t.AbsPath;
};

function macos(name: string): OSPaths {
  return {
    data: path.abs(os.homedir(), 'Library', 'Application Support', name),
    config: path.abs(os.homedir(), 'Library', 'Preferences', name),
    cache: path.abs(os.homedir(), 'Library', 'Caches', name),
    log: path.abs(os.homedir(), 'Library', 'Logs', name),
    temp: path.abs(os.tmpdir(), name),
  };
}

function windows(name: string): OSPaths {
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
function linux(name: string): OSPaths {
  return {
    data: path.abs(process.env.XDG_DATA_HOME || path.abs(os.homedir(), '.local', 'share'), name),
    config: path.abs(process.env.XDG_CONFIG_HOME || path.abs(os.homedir(), '.config'), name),
    cache: path.abs(process.env.XDG_CACHE_HOME || path.abs(os.homedir(), '.cache'), name),
    // https://wiki.debian.org/XDGBaseDirectorySpecification#state
    log: path.abs(process.env.XDG_STATE_HOME || path.abs(os.homedir(), '.local', 'state'), name),
    temp: path.abs(os.tmpdir(), basename(os.homedir()), name),
  };
}

function getOSPaths(name: string): OSPaths {
  if (process.platform === 'darwin') return macos(name);
  if (process.platform === 'win32') return windows(name);
  return linux(name);
}

export const osPaths = getOSPaths('CodeMic');
export const defaultWorkspacePath = path.abs(os.homedir(), 'CodeMic');
