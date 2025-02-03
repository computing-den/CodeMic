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
  earlyAccessEmail?: string;
  withProgress<R>(options: ProgressOptions, task: ProgressTask<R>): PromiseLike<R>;
};

export type ProgressOptions = { title?: string; cancellable?: boolean };

export type ProgressTask<R> = (progress: Progress, abortController: AbortController) => PromiseLike<R>;

export type Progress = {
  report: ProgressReport;
};

export type ProgressReport = (value: { message?: string; increment?: number }) => void;

export type RecorderRestoreState = {
  mustScan: boolean;
  tabId: t.RecorderUITabId;
  clock?: number;
};

export type WorkspaceChangeGlobalState = {
  screen: t.Screen;
  workspace: string;
  userMetadata?: t.UserMetadata;
  recorder?: RecorderRestoreState;
};
export type ReadDirOptions = { includeDirs?: boolean; includeFiles?: boolean };

// export interface Thenable<T> extends PromiseLike<T> { }
