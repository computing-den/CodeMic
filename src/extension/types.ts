import type { ExtensionContext } from 'vscode';
import * as t from '../lib/types.js';
import _ from 'lodash';
import type WebviewProvider from './webview_provider.js';

export type Context = {
  extension: ExtensionContext;
  webviewProvider: WebviewProvider;
  userDataPath: string;
  userSettingsPath: string;
  settings: t.Settings;
  postAudioMessage?: (req: t.BackendAudioRequest) => Promise<t.FrontendAudioResponse>;
  postVideoMessage?: (req: t.BackendVideoRequest) => Promise<t.FrontendVideoResponse>;
  updateFrontend?: () => any;
  user?: t.User;
};

export type RecorderRestoreState = {
  mustScan: boolean;
  tabId: t.RecorderUITabId;
  clock?: number;
};

export type WorkspaceChangeGlobalState = {
  screen: t.Screen;
  sessionId: string;
  sessionHandle: string;
  workspace: string;
  recorder?: RecorderRestoreState;
};
export type ReadDirOptions = { includeDirs?: boolean; includeFiles?: boolean };
