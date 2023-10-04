// Type branding is a hack. The __brand__ property doesn't actually exist at runtime.
export type Path = RelPath | AbsPath;
export type RelPath = string & { readonly __brand__: 'rel' };
export type AbsPath = string & { readonly __brand__: 'abs' };

/**
 * file:///home/sean/a    file path is always absolute.
 * workspace:a/b/c        workspace path is always relative.
 * untitled:Untitled      untitled has a name, not an actual path (this is different from vscode's untitled Uris which can be either a path or a name)
 */
export type Uri = string;

export type ParsedUri =
  | { scheme: 'file'; path: AbsPath }
  | { scheme: 'workspace'; path: RelPath }
  | { scheme: 'untitled'; name: string };

// Having the response types separately improves typescript error messages.
export type StoreResponse = { type: 'store'; store: Store };
export type UrisResponse = { type: 'uris'; uris?: Uri[] };
export type BooleanResponse = { type: 'boolean'; value: boolean };
export type OKResponse = { type: 'ok' };
export type ErrorResponse = { type: 'error' };

export type FrontendToBackend =
  | { request: { type: 'openWelcome' }; response: StoreResponse }
  | { request: { type: 'openPlayer'; sessionId: string }; response: StoreResponse }
  | {
      request: { type: 'openRecorder'; sessionId?: string; fork?: boolean; forkClock?: number };
      response: StoreResponse;
    }
  | { request: { type: 'play' }; response: StoreResponse }
  | { request: { type: 'record' }; response: StoreResponse }
  | { request: { type: 'pausePlayer' }; response: StoreResponse }
  | { request: { type: 'seekPlayer'; clock: number }; response: StoreResponse }
  | { request: { type: 'pauseRecorder' }; response: StoreResponse }
  | { request: { type: 'saveRecorder' }; response: StoreResponse }
  | { request: { type: 'updateRecorder'; changes: RecorderUpdate }; response: StoreResponse }
  | { request: { type: 'updatePlayer'; changes: PlayerUpdate }; response: StoreResponse }
  // | { request: { type: 'toggleRecorderStudio' }; response: StoreResponse }
  | { request: { type: 'deleteSession'; sessionId: string }; response: StoreResponse }
  | { request: { type: 'getStore' }; response: StoreResponse }
  | { request: { type: 'showOpenDialog'; options: OpenDialogOptions }; response: UrisResponse }
  | { request: { type: 'confirmForkFromPlayer'; clock: number }; response: BooleanResponse }
  | { request: { type: 'confirmEditFromPlayer' }; response: BooleanResponse }
  | { request: { type: 'frontendMediaEvent'; event: FrontendMediaEvent }; response: StoreResponse }
  | { request: { type: 'test'; value: any }; response: StoreResponse };

export type BackendToFrontend =
  | { request: { type: 'updateStore'; store: Store }; response: OKResponse }
  | { request: { type: 'backendMediaEvent'; event: BackendMediaEvent }; response: OKResponse }
  | { request: { type: 'todo' }; response: OKResponse };

export type FrontendRequest = FrontendToBackend['request'];
export type BackendResponse = FrontendToBackend['response'] | ErrorResponse;

export type BackendRequest = BackendToFrontend['request'];
export type FrontendResponse = BackendToFrontend['response'] | ErrorResponse;

export type BackendResponseFor<Req extends FrontendRequest> = Extract<
  FrontendToBackend,
  { request: { type: Req['type'] } }
>['response'];

export type FrontendResponseFor<Req extends BackendRequest> = Extract<
  BackendToFrontend,
  { request: { type: Req['type'] } }
>['response'];

export type PostMessageOptions = {
  performDefaultActions: boolean;
};

export type PostMessageToFrontend = <Req extends BackendRequest>(req: Req) => Promise<FrontendResponseFor<Req>>;
export type PostMessageToBackend = <Req extends FrontendRequest>(
  req: Req,
  options?: PostMessageOptions,
) => Promise<BackendResponseFor<Req>>;

export enum Screen {
  Welcome,
  Recorder,
  Player,
}

// A separate field for each page
export type Store = {
  screen: Screen;
  welcome?: WelcomeState;
  recorder?: RecorderState;
  player?: PlayerState;
  test?: any;

  // welcome?: Welcome;
  // login?: Login;
};

export type WelcomeState = {
  workspace: SessionSummaryMap;
  featured: SessionSummaryMap;
  history: SessionHistory;
};

export enum RecorderStatus {
  Uninitialized,
  Ready,
  Recording,
  Paused,
  Stopped,
}

export type RecorderState = {
  status: RecorderStatus;
  sessionSummary: SessionSummary;
  clock: number;
  root?: string;
  fork?: boolean;
  forkClock?: number;
  history?: SessionHistoryItem;
  // studio: boolean;
};

export type RecorderUpdate = {
  title?: string;
  description?: string;
  root?: string;
  clock?: number;
};

export type RecorderSetup = {
  sessionSummary: SessionSummary;
  baseSessionSummary?: SessionSummary;
  fork?: boolean;
  forkClock?: number;
  root?: string;
};

export enum PlayerStatus {
  Uninitialized,
  Ready,
  Buffering,
  Playing,
  Paused,
  Stopped,
}

export type PlayerState = {
  status: PlayerStatus;
  sessionSummary: SessionSummary;
  clock: number;
  root?: string;
  history?: SessionHistoryItem;
};

export type PlayerUpdate = {
  root?: string;
  // clock?: number;
};

export type PlayerSetup = {
  sessionSummary: SessionSummary;
  root?: string;
};

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
  publishedUri?: Uri;
  duration: number;
  views: number;
  likes: number;
  timestamp: string;
  toc: TocItem[];
  forkedFrom?: string;
};

export type SessionSummaryMap = { [key: string]: SessionSummary };

export type SessionJSON = {
  events: PlaybackEvent[];
  audioTracks: AudioTrack[];
  defaultEol: EndOfLine;
  initSnapshot: SessionSnapshot;
};

export type SessionSnapshot = {
  worktree: Worktree;
  textEditors: TextEditor[];
  activeTextEditorUri?: Uri;
};

export type OpenDialogOptions = {
  canSelectFiles?: boolean;
  canSelectFolders?: boolean;
  canSelectMany?: boolean;
  defaultUri?: Uri;
  filters?: { [name: string]: string[] };
  title?: string;
};

export interface SessionIO {
  readFile(file: File): Promise<Uint8Array>;
}

export type PlaybackEvent =
  | TextChangeEvent
  | OpenTextDocumentEvent
  | ShowTextEditorEvent
  | SelectEvent
  | ScrollEvent
  | SaveEvent;

export type TextChangeEvent = {
  type: 'textChange';
  clock: number;
  uri: Uri;
  contentChanges: ContentChange[];
  // revSelections: vscode.Selection[];
};

export type OpenTextDocumentEvent = {
  type: 'openTextDocument';
  clock: number;
  uri: Uri;
  text: string;
  eol: EndOfLine;
};

export type ShowTextEditorEvent = {
  type: 'showTextEditor';
  clock: number;
  uri: Uri;
  selections: Selection[];
  visibleRange: Range;
  revUri?: Uri;
  revSelections?: Selection[];
  revVisibleRange?: Range;
  // revSelections: Selection[];
};

export type SelectEvent = {
  type: 'select';
  clock: number;
  uri: Uri;
  selections: Selection[];
  visibleRange: Range;
  revSelections: Selection[];
  revVisibleRange: Range;
};

export type ScrollEvent = {
  type: 'scroll';
  clock: number;
  uri: Uri;
  visibleRange: Range;
  revVisibleRange: Range;
};

export type SaveEvent = {
  type: 'save';
  clock: number;
  uri: Uri;
};

export enum Direction {
  Forwards,
  Backwards,
}

export type UriSet = { [key: Uri]: true };

export type ContentChange = {
  range: Range;
  text: string;
  revRange: Range;
  revText: string;
};

export type Position = {
  line: number;
  character: number;
};

export type Range = {
  start: Position;
  end: Position;
};

export type Selection = {
  anchor: Position;
  active: Position;
};

export type Worktree = { [key: Uri]: File };

export type File = EmptyFile | LocalFile | GitFile;
// export type DirFile = {
//   type: 'dir';
//   mimetype: 'text/directory';
// };
export type EmptyFile = {
  type: 'empty';
};
export type LocalFile = {
  type: 'local';
  sha1: string;
};
export type GitFile = {
  type: 'git';
  sha1: string;
};

export type TextEditor = {
  uri: Uri;
  selections: Selection[];
  visibleRange: Range;
  // = [{ anchor: { line: 0, character: 0 }, active: { line: 0, character: 0 } }],
  // = { start: { line: 0, character: 0 }, end: { line: 1, character: 0 } },
};

export type EndOfLine = '\n' | '\r\n';

/**
 * Multiple audio tracks may refer to the same file.
 */
export type AudioTrack = {
  id: string;
  file: File;
  title: string;
  clock: number;
  duration: number;
};

export type Settings = {
  history: SessionHistory;
};

export type SessionHistory = { [key: string]: SessionHistoryItem };

export type SessionHistoryItem = {
  id: string;
  lastRecordedTimestamp?: string;
  lastWatchedTimestamp?: string;
  lastWatchedClock?: number;
  root?: AbsPath;
};

export type SeekData = { events: PlaybackEvent[]; direction: Direction; i: number; clock: number; stop: boolean };

export type FrontendMediaEvent =
  | { type: 'loadstart' }
  | { type: 'durationchange' }
  | { type: 'loadedmetadata' }
  | { type: 'loadeddata' }
  | { type: 'progress' }
  | { type: 'canplay' }
  | { type: 'canplaythrough' }
  | { type: 'suspend' }
  | { type: 'abort' }
  | { type: 'error'; error: string }
  | { type: 'emptied' }
  | { type: 'stalled' }
  | { type: 'timeupdate'; clock: number }
  | { type: 'playing' }
  | { type: 'waiting' }
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'ended' }
  | { type: 'volumechange'; volume: number }
  | { type: 'seeking' }
  | { type: 'seeked' };

export type BackendMediaEvent =
  | { type: 'load'; src: string }
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'seek'; clock: number };

export type Vec2 = [number, number];
export type Rect = { top: number; right: number; bottom: number; left: number };
