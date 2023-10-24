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

export type FrontendToBackendReqRes =
  | { request: { type: 'openWelcome' }; response: StoreResponse }
  | { request: { type: 'openPlayer'; sessionId: string }; response: StoreResponse }
  | {
      request: { type: 'openRecorder'; sessionId?: string; fork?: boolean; forkClock?: number };
      response: StoreResponse;
    }
  | { request: { type: 'player/play' }; response: StoreResponse }
  | { request: { type: 'player/pause' }; response: StoreResponse }
  | { request: { type: 'player/seek'; clock: number }; response: StoreResponse }
  | { request: { type: 'player/update'; changes: PlayerUpdate }; response: StoreResponse }
  | { request: { type: 'recorder/play' }; response: StoreResponse }
  | { request: { type: 'recorder/record' }; response: StoreResponse }
  | { request: { type: 'recorder/pause' }; response: StoreResponse }
  | { request: { type: 'recorder/save' }; response: StoreResponse }
  | { request: { type: 'recorder/update'; changes: RecorderUpdate }; response: StoreResponse }
  // | { request: { type: 'toggleRecorderStudio' }; response: StoreResponse }
  | { request: { type: 'deleteSession'; sessionId: string }; response: StoreResponse }
  | { request: { type: 'getStore' }; response: StoreResponse }
  | { request: { type: 'showOpenDialog'; options: OpenDialogOptions }; response: UrisResponse }
  | { request: { type: 'confirmForkFromPlayer'; clock: number }; response: BooleanResponse }
  | { request: { type: 'confirmEditFromPlayer' }; response: BooleanResponse }
  | { request: { type: 'test'; value: any }; response: StoreResponse }
  | { request: { type: 'audio'; event: FrontendAudioEvent }; response: OKResponse };

export type FrontendAudioEvent =
  | { type: 'loadstart'; id: string }
  | { type: 'durationchange'; id: string }
  | { type: 'loadedmetadata'; id: string }
  | { type: 'loadeddata'; id: string }
  | { type: 'progress'; id: string }
  | { type: 'canplay'; id: string }
  | { type: 'canplaythrough'; id: string }
  | { type: 'suspend'; id: string }
  | { type: 'abort'; id: string }
  | { type: 'error'; id: string; error: string }
  | { type: 'emptied'; id: string }
  | { type: 'stalled'; id: string }
  | { type: 'timeupdate'; id: string; clock: number }
  | { type: 'playing'; id: string }
  | { type: 'waiting'; id: string }
  | { type: 'play'; id: string }
  | { type: 'pause'; id: string }
  | { type: 'ended'; id: string }
  | { type: 'volumechange'; id: string; volume: number }
  | { type: 'seeking'; id: string }
  | { type: 'seeked'; id: string };

export type BackendToFrontendReqRes =
  | { request: { type: 'updateStore'; store: Store }; response: OKResponse }
  | { request: { type: 'todo' }; response: OKResponse }
  | BackendAudioToFrontendReqRes;

export type BackendAudioToFrontendReqRes =
  | { request: { type: 'audio/load'; src: string; id: string }; response: OKResponse }
  | { request: { type: 'audio/play'; id: string }; response: OKResponse }
  | { request: { type: 'audio/pause'; id: string }; response: OKResponse }
  | { request: { type: 'audio/stop'; id: string }; response: OKResponse }
  | { request: { type: 'audio/dispose'; id: string }; response: OKResponse }
  | { request: { type: 'audio/seek'; id: string; clock: number }; response: OKResponse }
  | { request: { type: 'audio/setPlaybackRate'; id: string; rate: number }; response: OKResponse };

export type FrontendRequest = FrontendToBackendReqRes['request'];
export type BackendResponse = FrontendToBackendReqRes['response'] | ErrorResponse;

export type BackendRequest = BackendToFrontendReqRes['request'];
export type FrontendResponse = BackendToFrontendReqRes['response'] | ErrorResponse;

export type BackendResponseFor<Req extends FrontendRequest> = Extract<
  FrontendToBackendReqRes,
  { request: { type: Req['type'] } }
>['response'];

export type FrontendResponseFor<Req extends BackendRequest> = Extract<
  BackendToFrontendReqRes,
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

export type BackendAudioRequest = BackendAudioToFrontendReqRes['request'];
export type PostAudioMessageToFrontend = <Req extends BackendAudioRequest>(
  req: Req,
) => Promise<FrontendResponseFor<Req>>;

// export type PostAudioEventToBackend = (event: FrontendAudioEvent) => Promise<void>;

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

export type RecorderState = {
  trackPlayerSummary: TrackPlayerSummary;
  isInRecorderMode: boolean;
  sessionSummary: SessionSummary;
  clock: number;
  root?: string;
  fork?: boolean;
  forkClock?: number;
  history?: SessionHistoryItem;
  DEV_trackPlayerSummaries: TrackPlayerSummary[];
  // studio: boolean;
};

export type RecorderUpdate = {
  title?: string;
  description?: string;
  root?: string;
};

export type RecorderSetup = {
  sessionSummary: SessionSummary;
  baseSessionSummary?: SessionSummary;
  fork?: boolean;
  forkClock?: number;
  root?: string;
};

export type PlayerState = {
  trackPlayerSummary: TrackPlayerSummary;
  sessionSummary: SessionSummary;
  clock: number;
  root?: string;
  history?: SessionHistoryItem;
  DEV_trackPlayerSummaries: TrackPlayerSummary[];
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

export type Session = {
  editorTrack: EditorTrack;
  audioTracks: AudioTrack[];
};

export type Track = {
  id: string;
  clockRange: ClockRange;
};

export type ClockRange = {
  start: number;
  end: number;
};

export type EditorTrack = Track & {
  initSnapshot: EditorTrackSnapshot;
  events: EditorEvent[];
  defaultEol: EndOfLine;
};

/**
 * Multiple audio tracks may refer to the same file.
 */
export type AudioTrack = Track & {
  title: string;
  file: File;
};

export enum TrackPlayerStatus {
  Init,
  Error,
  // Loaded,
  Running,
  Paused,
  Stopped,
}

export type TrackPlayerState = {
  status: TrackPlayerStatus;
  loading: boolean;
  loaded: boolean;
  buffering: boolean;
  seeking: boolean;
};

export interface TrackPlayer {
  name: string;
  track: Track;
  clock: number;
  state: TrackPlayerState;
  playbackRate: number;
  isRecorder: boolean;
  onProgress?: (clock: number) => any;
  onStateChange?: (state: TrackPlayerState) => any;

  load(): void;
  start(): void;
  pause(): void;
  stop(): void;
  seek(clock: number): void;
  setClock(clock: number): void;
  extend(clock: number): void;
  setPlaybackRate(rate: number): void;
  dispose(): any;
}

export type TrackPlayerSummary = {
  name: string;
  track: Track;
  state: TrackPlayerState;
  clock: number;
  playbackRate: number;
};

export type EditorTrackSnapshot = {
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
  init(): Promise<void>;
  readFile(file: File): Promise<Uint8Array>;
  copyLocalFile(src: AbsPath, sha1: string): Promise<void>;
}

export interface EditorEventStepper {
  applyEditorEvent(e: EditorEvent, direction: Direction, uriSet?: UriSet): Promise<void>;
  applyTextChangeEvent(e: TextChangeEvent, direction: Direction, uriSet?: UriSet): Promise<void>;
  applyOpenTextDocumentEvent(e: OpenTextDocumentEvent, direction: Direction, uriSet?: UriSet): Promise<void>;
  applyShowTextEditorEvent(e: ShowTextEditorEvent, direction: Direction, uriSet?: UriSet): Promise<void>;
  applySelectEvent(e: SelectEvent, direction: Direction, uriSet?: UriSet): Promise<void>;
  applyScrollEvent(e: ScrollEvent, direction: Direction, uriSet?: UriSet): Promise<void>;
  applySaveEvent(e: SaveEvent, direction: Direction, uriSet?: UriSet): Promise<void>;
}

export type EditorEvent =
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

export type SeekData = { events: EditorEvent[]; direction: Direction; i: number; clock: number; stop: boolean };

export type Vec2 = [number, number];
export type Rect = { top: number; right: number; bottom: number; left: number };
