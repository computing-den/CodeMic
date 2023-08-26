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
  | { type: 'openRecorder' }
  // | { type: 'askToCloseRecorder' }
  | { type: 'play'; workspacePath?: AbsPath }
  | { type: 'record'; workspacePath?: AbsPath }
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
  workspacePath?: AbsPath;
  defaultWorkspacePath?: AbsPath;
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
  defaultWorkspacePath?: AbsPath;
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

export interface Position {
  line: number;
  character: number;
}

export interface Range {
  start: Position;
  end: Position;
}

export interface Selection {
  anchor: Position;
  active: Position;
}

export type EndOfLine = '\n' | '\r\n';
