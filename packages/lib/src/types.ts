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
export type ErrorResponse = { type: 'error'; message?: string };

export type FrontendToBackendReqRes =
  | { request: { type: 'account/open'; join?: boolean }; response: StoreResponse }
  | { request: { type: 'account/update'; changes: AccountUpdate }; response: StoreResponse }
  | { request: { type: 'account/join' }; response: StoreResponse }
  | { request: { type: 'account/login' }; response: StoreResponse }
  | { request: { type: 'account/logout' }; response: StoreResponse }
  | { request: { type: 'welcome/open' }; response: StoreResponse }
  | { request: { type: 'player/open'; sessionId: string }; response: StoreResponse }
  | { request: { type: 'player/load' }; response: StoreResponse }
  | { request: { type: 'player/play' }; response: StoreResponse }
  | { request: { type: 'player/pause' }; response: StoreResponse }
  | { request: { type: 'player/seek'; clock: number }; response: StoreResponse }
  // | { request: { type: 'player/update'; changes: PlayerUpdate }; response: StoreResponse }
  | {
      request: { type: 'recorder/open'; sessionId?: string; clock?: number; fork?: boolean };
      response: StoreResponse;
    }
  | { request: { type: 'recorder/openTab'; tabId: RecorderTabId }; response: StoreResponse }
  | { request: { type: 'recorder/load' }; response: StoreResponse }
  | { request: { type: 'recorder/play' }; response: StoreResponse }
  | { request: { type: 'recorder/record' }; response: StoreResponse }
  | { request: { type: 'recorder/pause' }; response: StoreResponse }
  | { request: { type: 'recorder/seek'; clock: number }; response: StoreResponse }
  | { request: { type: 'recorder/save' }; response: StoreResponse }
  | { request: { type: 'recorder/publish' }; response: StoreResponse }
  | { request: { type: 'recorder/update'; changes: RecorderUpdate }; response: StoreResponse }
  | { request: { type: 'recorder/insertAudio'; uri: Uri; clock: number }; response: StoreResponse }
  | { request: { type: 'recorder/deleteAudio'; id: string }; response: StoreResponse }
  | { request: { type: 'recorder/updateAudio'; audio: Partial<AudioTrack> & { id: string } }; response: StoreResponse }
  | { request: { type: 'recorder/insertVideo'; uri: Uri; clock: number }; response: StoreResponse }
  | { request: { type: 'recorder/deleteVideo'; id: string }; response: StoreResponse }
  | { request: { type: 'recorder/updateVideo'; video: Partial<VideoTrack> & { id: string } }; response: StoreResponse }
  // | { request: { type: 'toggleRecorderStudio' }; response: StoreResponse }
  | { request: { type: 'deleteSession'; sessionId: string }; response: StoreResponse }
  | { request: { type: 'getStore' }; response: StoreResponse }
  | { request: { type: 'showOpenDialog'; options: OpenDialogOptions }; response: UrisResponse }
  | { request: { type: 'confirmForkFromPlayer'; clock: number }; response: BooleanResponse }
  | { request: { type: 'confirmEditFromPlayer'; clock: number }; response: BooleanResponse }
  | { request: { type: 'test'; value: any }; response: StoreResponse }
  | { request: { type: 'audio'; event: FrontendMediaEvent }; response: OKResponse }
  | { request: { type: 'video'; event: FrontendMediaEvent }; response: OKResponse };

export type FrontendMediaEvent =
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
  | { type: 'ratechange'; id: string; rate: number }
  | { type: 'seeking'; id: string }
  | { type: 'seeked'; id: string };

export type BackendToFrontendReqRes =
  | { request: { type: 'updateStore'; store: Store }; response: OKResponse }
  | { request: { type: 'todo' }; response: OKResponse }
  | BackendAudioToFrontendReqRes
  | BackendVideoToFrontendReqRes;

export type BackendAudioToFrontendReqRes =
  // | { request: { type: 'audio/load'; src: string; id: string }; response: OKResponse }
  | { request: { type: 'audio/play'; id: string }; response: OKResponse }
  | { request: { type: 'audio/pause'; id: string }; response: OKResponse }
  | { request: { type: 'audio/dispose'; id: string }; response: OKResponse }
  | { request: { type: 'audio/seek'; id: string; clock: number }; response: OKResponse }
  | { request: { type: 'audio/setPlaybackRate'; id: string; rate: number }; response: OKResponse };

export type BackendVideoToFrontendReqRes =
  | { request: { type: 'video/loadTrack'; id: string }; response: OKResponse }
  | { request: { type: 'video/play' }; response: OKResponse }
  | { request: { type: 'video/pause' }; response: OKResponse }
  | { request: { type: 'video/stop' }; response: OKResponse }
  | { request: { type: 'video/seek'; clock: number }; response: OKResponse }
  | { request: { type: 'video/setPlaybackRate'; rate: number }; response: OKResponse };

export type FrontendRequest = FrontendToBackendReqRes['request'];
export type BackendResponse = FrontendToBackendReqRes['response'] | ErrorResponse;

export type BackendRequest = BackendToFrontendReqRes['request'];
export type FrontendResponse = BackendToFrontendReqRes['response'] | ErrorResponse;

export type ReqRes = { request: { type: string }; response: { type: string } };
export type ExtractResponse<RR extends ReqRes, Req extends { type: string }> = Extract<
  RR,
  { request: { type: Req['type'] } }
>['response'];

// export type BackendResponseFor<Req extends FrontendRequest> =

// export type BackendResponseFor<Req extends FrontendRequest> = Extract<
//   FrontendToBackendReqRes,
//   { request: { type: Req['type'] } }
// >['response'];

// export type FrontendResponseFor<Req extends BackendRequest> = Extract<
//   BackendToFrontendReqRes,
//   { request: { type: Req['type'] } }
// >['response'];

export type PostMessageOptions = {
  performDefaultActions: boolean;
};

// export type PostMessageToFrontend = <Req extends BackendRequest>(req: Req) => Promise<FrontendResponseFor<Req>>;
// export type PostMessageToBackend = <Req extends FrontendRequest>(
//   req: Req,
//   options?: PostMessageOptions,
// ) => Promise<BackendResponseFor<Req>>;

export type BackendAudioRequest = BackendAudioToFrontendReqRes['request'];
export type FrontendAudioResponse = BackendAudioToFrontendReqRes['response'] | ErrorResponse;
export type PostAudioMessageToFrontend = (req: BackendAudioRequest) => Promise<FrontendAudioResponse>;

export type BackendVideoRequest = BackendVideoToFrontendReqRes['request'];
export type FrontendVideoResponse = BackendVideoToFrontendReqRes['response'] | ErrorResponse;
export type PostVideoMessageToFrontend = (req: BackendVideoRequest) => Promise<FrontendVideoResponse>;

// export type B2SReqAccountJoin = { type: 'account/join'; credentials: Credentials };
// export type B2SResAccountJoin = { type: 'user'; user: User };

// export type B2SReqAccountLogin = { type: 'account/login'; credentials: Credentials };
// export type B2SResAccountLogin = { type: 'user'; user: User };

// export type B2SReqFeaturedGet = { type: 'featured/get' };
// export type B2SResFeaturedGet = { type: 'sessionSummaries'; sessionSummaries: SessionSummary[] };

export type BackendToServerReqRes =
  | {
      request: { type: 'account/join'; credentials: Credentials };
      response: { type: 'user'; user: User };
    }
  | {
      request: { type: 'account/login'; credentials: Credentials };
      response: { type: 'user'; user: User };
    }
  | {
      request: { type: 'featured/get' };
      response: { type: 'sessionSummaries'; sessionSummaries: SessionSummary[] };
    };
export type BackendToServerRequest = BackendToServerReqRes['request'];
export type ServerResponse = BackendToServerReqRes['response'] | ErrorResponse;
// export type ServerResponseFor<Req extends BackendToServerRequest> = Extract<
//   BackendToServerReqRes,
//   { request: { type: Req['type'] } }
// >['response'];

// const y: ServerResponseFor<{type: 'account/join'; credentials: Credentials}>
// const z: ServerResponseFor<{type: 'account/login'; credentials: Credentials}>

export enum Screen {
  Account,
  Welcome,
  Recorder,
  Player,
}

export type Store = {
  screen: Screen;
  user?: User;
  account?: AccountState;
  welcome?: WelcomeState;
  recorder?: RecorderState;
  player?: PlayerState;
  test?: any;
};

export type User = {
  username: string;
  email: string;
  token: string;
  avatar?: string;
  joinTimestamp: string;
  tokenTimestamp: string;
};

export type UserSummary = {
  username: string;
  email: string;
  avatar?: string;
  joinTimestamp: string;
};

export type DBUser = {
  username: string;
  hash: string;
  email: string;
  token: string;
  avatar?: string;
  join_timestamp: string;
  token_timestamp: string;
};

export type Credentials = {
  username: string;
  password: string;
  email: string;
};

export type AccountState = {
  credentials: Credentials;
  join: boolean;
  error?: string;
};

export type AccountUpdate = Partial<AccountState>;

export type WelcomeState = {
  workspace: SessionSummary[];
  featured: SessionSummary[];
  history: SessionsHistory;
};

export type RecorderState = {
  tabId: RecorderTabId;
  mustScan: boolean;
  loaded: boolean;
  recording: boolean;
  playing: boolean;
  clock: number;
  sessionSummary: SessionSummary;
  workspace?: string;
  // fork?: { clock: number };
  history?: SessionHistory;
  audioTracks?: AudioTrack[];
  videoTracks?: VideoTrack[];
  webviewUris?: WebviewUris;
};

export type RecorderTabId = 'editor-view' | 'details-view';

export type RecorderUpdate = {
  title?: string;
  description?: string;
  workspace?: string;
};

export type PlayerState = {
  loaded: boolean;
  playing: boolean;
  sessionSummary: SessionSummary;
  clock: number;
  workspace?: string;
  history?: SessionHistory;
  audioTracks?: AudioTrack[];
  videoTracks?: VideoTrack[];
  webviewUris?: WebviewUris;
};

// export type PlayerUpdate = {
//   workspace?: string;
//   // clock?: number;
// };

// export type Setup = {
//   sessionSummary: SessionSummary;
//   baseSessionSummary?: SessionSummary;
//   fork?: { clock: number };
//   workspace?: string;
//   isNew?: boolean;
//   dirty?: boolean;
// };

export type TocItem = { title: string; clock: number };

export type SessionSummary = {
  id: string;
  title: string;
  description: string;
  author?: UserSummary;
  // published: boolean;
  // publishedUri?: Uri;
  duration: number;
  views: number;
  likes: number;
  publishTimestamp?: string;
  modificationTimestamp: string;
  toc: TocItem[];
  forkedFrom?: string;
};

export type SessionSummaryMap = { [key: string]: SessionSummary | undefined };

export type DBSessionSummary = {
  id: string;
  title: string;
  description: string;
  author: string;
  duration: number;
  views: number;
  likes: number;
  publish_timestamp: string;
  modification_timestamp: string;
  forked_from?: string;
};

export type SessionBody = {
  editorTrack: InternalEditorTrack;
  audioTracks: AudioTrack[];
  videoTracks: VideoTrack[];
};

export type ClockRange = {
  start: number;
  end: number;
};

export type InternalEditorTrack = {
  initSnapshot: InternalEditorTrackSnapshot;
  events: EditorEvent[];
  defaultEol: EndOfLine;
};

export type RangedTrack = {
  id: string;
  clockRange: ClockRange;
  title: string;
};

export type RangedTrackFile = RangedTrack & { file: File };

/**
 * Multiple audio tracks may refer to the same file.
 */
export type AudioTrack = RangedTrackFile;

/**
 * Multiple video tracks may refer to the same file.
 */
export type VideoTrack = RangedTrackFile;

export type WebviewUris = { [key: string]: Uri };

export type InternalEditorTrackSnapshot = {
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

export interface Session {
  workspace: AbsPath;
  summary: SessionSummary;
  body?: SessionBody;
  loaded: boolean;
  readFile(file: File): Promise<Uint8Array>;
  copyToBlob(src: AbsPath, sha1: string): Promise<void>;
}

export interface EditorEventStepper {
  applyEditorEvent(e: EditorEvent, direction: Direction, uriSet?: UriSet): Promise<void>;
  applyTextChangeEvent(e: TextChangeEvent, direction: Direction, uriSet?: UriSet): Promise<void>;
  applyOpenTextDocumentEvent(e: OpenTextDocumentEvent, direction: Direction, uriSet?: UriSet): Promise<void>;
  applyCloseTextDocumentEvent(e: CloseTextDocumentEvent, direction: Direction, uriSet?: UriSet): Promise<void>;
  applyShowTextEditorEvent(e: ShowTextEditorEvent, direction: Direction, uriSet?: UriSet): Promise<void>;
  applyCloseTextEditorEvent(e: CloseTextEditorEvent, direction: Direction, uriSet?: UriSet): Promise<void>;
  applySelectEvent(e: SelectEvent, direction: Direction, uriSet?: UriSet): Promise<void>;
  applyScrollEvent(e: ScrollEvent, direction: Direction, uriSet?: UriSet): Promise<void>;
  applySaveEvent(e: SaveEvent, direction: Direction, uriSet?: UriSet): Promise<void>;
}

export type EditorEvent =
  | TextChangeEvent
  | OpenTextDocumentEvent
  | CloseTextDocumentEvent
  | ShowTextEditorEvent
  | CloseTextEditorEvent
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
  text?: string;
  eol: EndOfLine;
  isInWorktree: boolean;
};

export type CloseTextDocumentEvent = {
  type: 'closeTextDocument';
  clock: number;
  uri: Uri;
  revText: string;
  revEol: EndOfLine;
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

export type CloseTextEditorEvent = {
  type: 'closeTextEditor';
  clock: number;
  uri: Uri;
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

export type UriSet = { [key: Uri]: true | undefined };

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
  history: SessionsHistory;
};

export type SessionsHistory = { [key: string]: SessionHistory };

export type SessionHistory = {
  id: string;
  lastRecordedTimestamp?: string;
  lastWatchedTimestamp?: string;
  lastWatchedClock?: number;
  workspace: AbsPath;
};

export type SeekData = { events: EditorEvent[]; direction: Direction; i: number; clock: number };

export type Vec2 = [number, number];
export type Rect = { top: number; right: number; bottom: number; left: number };
