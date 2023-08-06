export type FrontendRequest =
  | { type: 'seek'; clock: number }
  | { type: 'openWelcome' }
  | { type: 'openPlayer'; uri?: Uri }
  | { type: 'openRecorder' }
  // | { type: 'askToCloseRecorder' }
  | { type: 'play' }
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
  sessions: {
    recent: SessionSummary[];
    workspace: SessionSummary[];
    recommended: SessionSummary[];
  };
};

export type Recorder = {
  workspaceFolders: string[];
  session?: {
    isRecording: boolean;
    duration: number;
    name: string;
    uri?: Uri;
  };
};

export type Player = {
  isPlaying: boolean;
  duration: number;
  clock: number;
  name: string;
  uri?: Uri;
};

export type Uri = {
  scheme: 'file' | 'untitled';
  path: string;
};

export type SessionSummary = {
  id: string;
  title: string;
  summary: string;
  author: string;
  published: boolean;
  localPath?: string;
  workspace?: string;
  duration: number;
  views: number;
  likes: number;
  timestamp: string;
};
