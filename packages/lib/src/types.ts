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

export type FrontendRequest =
  | { type: 'seek'; clock: number }
  | { type: 'openWelcome' }
  | { type: 'openPlayer'; sessionId: string }
  | { type: 'openRecorder'; sessionId?: string; fork?: boolean; forkClock?: number }
  | { type: 'play'; root?: AbsPath }
  | { type: 'record'; root?: AbsPath; sessionSummary?: SessionSummary }
  | { type: 'pausePlayer' }
  | { type: 'pauseRecorder' }
  | { type: 'saveRecorder' }
  | { type: 'updateRecorderSessionSummary'; sessionSummary: SessionSummary }
  | { type: 'playbackUpdate'; clock: number }
  | { type: 'getStore' }
  | { type: 'showOpenDialog'; options: OpenDialogOptions };
export type BackendResponse =
  | { type: 'getStore'; store: Store }
  | { type: 'error' }
  | { type: 'ok' }
  | { type: 'boolean'; value: boolean }
  | { type: 'uris'; uris?: Uri[] };

export type BackendRequest = { type: 'updateStore'; store: Store } | { type: 'todo' };
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
  recorder?: RecorderState;
  player?: PlayerState;

  // welcome?: Welcome;
  // login?: Login;
};

export type Welcome = {
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
  root?: AbsPath;
  defaultRoot?: AbsPath;
  history?: SessionHistoryItem;
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
  history?: SessionHistoryItem;
  clock: number;
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
};

export type SessionSummaryMap = { [key: string]: SessionSummary };

export type SessionJSON = {
  events: PlaybackEvent[];
  initCheckpoint: Checkpoint;
  defaultEol: EndOfLine;
};

export type OpenDialogOptions = {
  canSelectFiles?: boolean;
  canSelectFolders?: boolean;
  canSelectMany?: boolean;
  defaultUri?: Uri;
  filters?: { [name: string]: string[] };
  title?: string;
};

export type PlaybackEvent =
  | StopEvent
  | TextChangeEvent
  | OpenDocumentEvent
  | ShowTextEditor
  | SelectEvent
  | ScrollEvent
  | SaveEvent;

export type StopEvent = {
  type: 'stop';
  clock: number;
};

export type TextChangeEvent = {
  type: 'textChange';
  clock: number;
  uri: Uri;
  contentChanges: ContentChange[];
  // revSelections: vscode.Selection[];
};

export type OpenDocumentEvent = {
  type: 'openDocument';
  clock: number;
  uri: Uri;
  // text: string;
  eol: EndOfLine;
};

export type ShowTextEditor = {
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

export type Checkpoint = {
  textDocuments: CheckpointTextDocument[];
  textEditors: CheckpointTextEditor[];
  activeTextEditorUri?: Uri;
};

export type CheckpointTextDocument = {
  uri: Uri;
  text: string;
};

export type CheckpointTextEditor = {
  uri: Uri;
  selections: Selection[];
  visibleRange: Range;
  // = [{ anchor: { line: 0, character: 0 }, active: { line: 0, character: 0 } }],
  // = { start: { line: 0, character: 0 }, end: { line: 1, character: 0 } },
};

export type EndOfLine = '\n' | '\r\n';

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
