import { URI, Utils } from 'vscode-uri';
import config from './config.js';
import type { CacheUIState } from '../lib/types.js';

export function cn(...args: any[]) {
  return args.filter(Boolean).join(' ');
}

export function asWebviewUri(...paths: string[]): URI {
  return Utils.joinPath(URI.parse(config.webviewUriBase), ...paths);
}

export function getCoverPhotoUri(sessionId: string, cache: CacheUIState): URI {
  return asWebviewUri(cache.coverPhotosPath, sessionId).with({ query: `v=${cache.version}` });
}

export function getAvatarUri(username: string, cache: CacheUIState): URI {
  return asWebviewUri(cache.avatarsPath, username).with({ query: `v=${cache.version}` });
}
