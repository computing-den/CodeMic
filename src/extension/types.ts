import type { ExtensionContext, WebviewView } from 'vscode';
import type { DataPaths, DefaultWorkspacePaths } from './paths.js';
import * as t from '../lib/types.js';
import _ from 'lodash';

export type Context = {
  extension: ExtensionContext;
  dataPaths: DataPaths;
  defaultWorkspacePaths: DefaultWorkspacePaths;
  settings: t.Settings;
  postAudioMessage?: (req: t.BackendAudioRequest) => Promise<t.FrontendAudioResponse>;
  postVideoMessage?: (req: t.BackendVideoRequest) => Promise<t.FrontendVideoResponse>;
  updateFrontend?: () => any;
  view?: WebviewView;
  user?: t.User;
};

export type RecorderRestoreState = {
  mustScan: boolean;
  seekClock?: number;
  cutClock?: number;
  tabId?: t.RecorderTabId;
};

export type WorkspaceChangeGlobalState = { screen: t.Screen; sessionId?: string; recorder?: RecorderRestoreState };
export type ReadDirOptions = { includeDirs?: boolean; includeFiles?: boolean };
