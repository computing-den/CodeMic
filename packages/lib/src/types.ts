export type FrontendRequest =
  | { type: 'seek'; clock: number }
  | { type: 'openWelcome' }
  | { type: 'openPlayer'; sessionId: string }
  | { type: 'openRecorder' }
  // | { type: 'askToCloseRecorder' }
  | { type: 'play'; workspacePath?: string }
  | { type: 'record'; workspacePath?: string }
  // | { type: 'closePlayer' }
  // | { type: 'closeRecorder' }
  | { type: 'pausePlayer' }
  | { type: 'pauseRecorder' }
  // | { type: 'save' }
  // | { type: 'discard' }
  | { type: 'playbackUpdate'; clock: number }
  | { type: 'getStore' }
  | { type: 'showOpenDialog'; options: OpenDialogOptions };
export type BackendResponse =
  | { type: 'getStore'; store: Store }
  | { type: 'error' }
  | { type: 'ok' }
  | { type: 'boolean'; value: boolean }
  | { type: 'uris'; uris?: Uri[] };

export type BackendRequest = { type: 'error' };
export type FrontendResponse = { type: 'error' } | { type: 'ok' };

export enum Screen {
  Welcome,
  Recorder,
  Player,
}

// A separate field for each page
export type Store = {
  screen: Screen;
  welcome: Welcome;

  // It is possible to have an uninitialized recorder which is still waiting for workspacePath and
  // possibly other fields to be filled out and workspace being scanned before starting.
  recorder: Recorder;

  // It is not possible to have even an uninitialized player without picking a session summary first.
  // After picking a session summary, now we can have an uninitialized player until workspacePath is
  // selected and workspace is populated.
  player?: Player;

  // welcome?: Welcome;
  // login?: Login;
};

export type Welcome = {
  recent: SessionSummary[];
  workspace: SessionSummary[];
  featured: SessionSummary[];
};

export enum RecorderStatus {
  Uninitialized,
  Ready,
  Recording,
  Paused,
  Stopped,
}

export type Recorder = {
  status: RecorderStatus;
  duration: number;
  name: string;
  workspacePath?: string;
  defaultWorkspacePath?: string;
};

export enum PlayerStatus {
  Uninitialized,
  Ready,
  Buffering,
  Playing,
  Paused,
  Stopped,
}

export type Player = {
  sessionSummary: SessionSummary;
  status: PlayerStatus;
  clock: number;
};

export type Uri =
  | { scheme: 'file' | 'untitled'; path: string }
  | { scheme: 'http' | 'https'; authority: string; path: string; query?: string; fragment?: string };

export type TocItem = { title: string; clock: number };

export type SessionSummary = {
  id: string;
  title: string;
  description: string;
  author: {
    avatar: string;
    name: string;
  };
  published: boolean;
  uri: Uri;
  defaultWorkspacePath?: string;
  duration: number;
  views: number;
  likes: number;
  timestamp: string;
  toc?: TocItem[];
};

export type OpenDialogOptions = {
  canSelectFiles?: boolean;
  canSelectFolders?: boolean;
  canSelectMany?: boolean;
  defaultUri?: Uri;
  filters?: { [name: string]: string[] };
  title?: string;
};
