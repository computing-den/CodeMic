export type FrontendRequest =
  | { type: 'seek'; clock: number }
  | { type: 'openWelcome' }
  | { type: 'openPlayer' }
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
