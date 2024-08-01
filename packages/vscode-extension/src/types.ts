import type { ExtensionContext, WebviewView } from 'vscode';
import type { DataPaths, DefaultWorkspacePaths } from './paths.js';
import type { types as t, internalEditorTrackCtrl as ietc } from '@codecast/lib';
import type SessionTracksCtrl from './session/session_tracks_ctrl.js';
import type CombinedEditorTrackPlayer from './session/combined_editor_track_player.js';
import type CombinedEditorTrackRecorder from './session/combined_editor_track_recorder.js';
import type AudioTrackCtrl from './session/audio_track_ctrl.js';
import type VscEditorEventStepper from './session/vsc_editor_event_stepper.js';
import _ from 'lodash';

export type Context = {
  extension: ExtensionContext;
  dataPaths: DataPaths;
  defaultWorkspacePaths: DefaultWorkspacePaths;
  settings: t.Settings;
  postAudioMessage?: (req: t.BackendAudioRequest) => Promise<t.FrontendAudioResponse>;
  updateFrontend?: () => any;
  view?: WebviewView;
  user?: t.User;
};

export type SessionCtrls = {
  sessionTracksCtrl: SessionTracksCtrl;
  internalEditorTrackCtrl: ietc.InternalEditorTrackCtrl;
  audioTrackCtrls: AudioTrackCtrl[];
  combinedEditorTrackPlayer: CombinedEditorTrackPlayer;
  combinedEditorTrackRecorder: CombinedEditorTrackRecorder;
  vscEditorEventStepper: VscEditorEventStepper;
};

export type RecorderRestoreState = {
  mustScan: boolean;
  seekClock?: number;
  cutClock?: number;
  tabId?: t.RecorderTabId;
};

export type WorkspaceChangeGlobalState = { screen: t.Screen; sessionId?: string; recorder?: RecorderRestoreState };
export type ReadDirOptions = { includeDirs?: boolean; includeFiles?: boolean };
