import * as path from 'path';
import os from 'os';
import process from 'process';
import _ from 'lodash';
import { OSPaths } from '../lib/types';

function macos(name: string): OSPaths {
  return {
    home: os.homedir(),
    data: path.join(os.homedir(), 'Library', 'Application Support', name),
    config: path.join(os.homedir(), 'Library', 'Preferences', name),
    cache: path.join(os.homedir(), 'Library', 'Caches', name),
    log: path.join(os.homedir(), 'Library', 'Logs', name),
    temp: path.join(os.tmpdir(), name),
  };
}

function windows(name: string): OSPaths {
  const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');

  return {
    // Data/config/cache/log are invented by me as Windows isn't opinionated about this
    home: os.homedir(),
    data: path.join(localAppData, name, 'Data'),
    config: path.join(appData, name, 'Config'),
    cache: path.join(localAppData, name, 'Cache'),
    log: path.join(localAppData, name, 'Log'),
    temp: path.join(os.tmpdir(), name),
  };
}

// https://specifications.freedesktop.org/basedir-spec/basedir-spec-latest.html
function linux(name: string): OSPaths {
  return {
    home: os.homedir(),
    data: path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), name),
    config: path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), name),
    cache: path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'), name),
    // https://wiki.debian.org/XDGBaseDirectorySpecification#state
    log: path.join(process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state'), name),
    temp: path.join(os.tmpdir(), path.basename(os.homedir()), name),
  };
}

function getOSPaths(name: string): OSPaths {
  if (process.platform === 'darwin') return macos(name);
  if (process.platform === 'win32') return windows(name);
  return linux(name);
}

export default getOSPaths('CodeMic');
