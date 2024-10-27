import type { ExtensionContext, WebviewView } from 'vscode';
import type { DataPaths, DefaultWorkspacePaths } from './paths.js';
import * as t from '../lib/types.js';
import * as ietc from './session/internal_workspace.js';
import type SessionRuntime from './session/session_runtime.js';
import type WorkspacePlayer from './session/workspace_player.js';
import type WorkspaceRecorder from './session/workspace_recorder.js';
import type AudioTrackCtrl from './session/audio_track_ctrl.js';
import type VideoTrackCtrl from './session/video_track_ctrl.js';
import type VscWorkspaceStepper from './session/vsc_workspace_stepper.js';
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

export type SessionCtrls = {
  sessionRuntime: SessionRuntime;
  internalWorkspace: ietc.InternalWorkspace;
  audioTrackCtrls: AudioTrackCtrl[];
  videoTrackCtrl: VideoTrackCtrl;
  workspacePlayer: WorkspacePlayer;
  workspaceRecorder: WorkspaceRecorder;
  vscWorkspaceStepper: VscWorkspaceStepper;
};

export type RecorderRestoreState = {
  mustScan: boolean;
  seekClock?: number;
  cutClock?: number;
  tabId?: t.RecorderTabId;
};

export type WorkspaceChangeGlobalState = { screen: t.Screen; sessionId?: string; recorder?: RecorderRestoreState };
export type ReadDirOptions = { includeDirs?: boolean; includeFiles?: boolean };
