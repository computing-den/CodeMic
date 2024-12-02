import type { ExtensionContext, WebviewView } from 'vscode';
import * as t from '../lib/types.js';
import _ from 'lodash';

export type Context = {
  extension: ExtensionContext;
  userDataPath: t.AbsPath;
  settings: t.Settings;
  postAudioMessage?: (req: t.BackendAudioRequest) => Promise<t.FrontendAudioResponse>;
  postVideoMessage?: (req: t.BackendVideoRequest) => Promise<t.FrontendVideoResponse>;
  updateFrontend?: () => any;
  postMessage?: (req: t.BackendRequest) => Promise<t.FrontendResponse>;
  view?: WebviewView;
  user?: t.User;
};

export type RecorderRestoreState = {
  workspace: t.AbsPath;
  mustScan: boolean;
  tabId: t.RecorderUITabId;
  seekClock?: number;
  cutClock?: number;
};

export type WorkspaceChangeGlobalState = { screen: t.Screen; sessionId?: string; recorder?: RecorderRestoreState };
export type ReadDirOptions = { includeDirs?: boolean; includeFiles?: boolean };
