export type FrontendRequest =
  | { type: 'seek'; clock: number }
  | { type: 'play' }
  | { type: 'record' }
  | { type: 'stop' }
  | { type: 'save' }
  | { type: 'discard' }
  | { type: 'playbackUpdate'; clock: number }
  | { type: 'getStore' };
export type BackendResponse = { type: 'getStore'; store: Store } | { type: 'error' } | { type: 'ok' };

export type BackendRequest = { type: 'error' };
export type FrontendResponse = { type: 'error' } | { type: 'ok' };

// A separate field for each page
export type Store = {
  recorder?: Recorder;
  player?: Player;
  // welcome?: Welcome;
  // login?: Login;
};

export type Recorder = {
  workspaceFolders: string[];
  session?: {
    isRecording: boolean;
    duration: number;
    name: string;
    path?: string;
  };
};

export type Player = {
  isPlaying: boolean;
  duration: number;
  clock: number;
  name: string;
  path: string;
};
