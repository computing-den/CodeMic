export type FrontendRequest =
  | { type: 'seek'; clock: number }
  | { type: 'openWelcome' }
  | { type: 'openPlayer'; sessionId: string }
  | { type: 'openRecorder' }
  // | { type: 'askToCloseRecorder' }
  | { type: 'play'; workspacePath?: Uri }
  | { type: 'record' }
  // | { type: 'closePlayer' }
  // | { type: 'closeRecorder' }
  | { type: 'pausePlayer' }
  | { type: 'pauseRecorder' }
  // | { type: 'save' }
  // | { type: 'discard' }
  | { type: 'playbackUpdate'; clock: number }
  | { type: 'getStore' };
export type BackendResponse =
  | { type: 'getStore'; store: Store }
  | { type: 'error' }
  | { type: 'ok' }
  | { type: 'boolean'; value: boolean };

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
  recorder?: Recorder;
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
  Init,
  Recording,
  Paused,
  Stopped,
}

export type Recorder = {
  workspaceFolders: string[];
  status: RecorderStatus;
  duration: number;
  name: string;
  uri?: Uri;
};

export enum PlayerStatus {
  Init,
  WorkspacePopulated,
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
