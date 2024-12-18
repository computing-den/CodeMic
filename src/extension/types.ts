import type { ExtensionContext, WebviewView } from 'vscode';
import * as t from '../lib/types.js';
import _ from 'lodash';

export type Context = {
  extension: ExtensionContext;
  userDataPath: string;
  userSettingsPath: string;
  settings: t.Settings;
  postAudioMessage?: (req: t.BackendAudioRequest) => Promise<t.FrontendAudioResponse>;
  postVideoMessage?: (req: t.BackendVideoRequest) => Promise<t.FrontendVideoResponse>;
  updateFrontend?: () => any;
  postMessage?: (req: t.BackendRequest) => Promise<t.FrontendResponse>;
  view?: WebviewView;
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
