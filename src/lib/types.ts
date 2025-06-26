// import type { Position, Range, LineRange, Selection, ContentChange } from './lib.js';

// Having the response types separately improves typescript error messages.
export type StoreResponse = { type: 'store'; store: Store };
export type UrisResponse = { type: 'uris'; uris?: string[] };
export type BooleanResponse = { type: 'boolean'; value: boolean };
export type OKResponse = { type: 'ok' };
export type ErrorResponse = { type: 'error'; message?: string };

export type FrontendToBackendReqRes =
  | { request: { type: 'webviewLoaded' }; response: OKResponse }
  | { request: { type: 'account/open'; join?: boolean }; response: OKResponse }
  | { request: { type: 'account/update'; changes: AccountUpdate }; response: OKResponse }
  | { request: { type: 'account/join' }; response: OKResponse }
  | { request: { type: 'account/login' }; response: OKResponse }
  | { request: { type: 'account/logout' }; response: OKResponse }
  | { request: { type: 'welcome/open' }; response: OKResponse }
  | { request: { type: 'welcome/earlyAccessEmail'; email: string }; response: OKResponse }
  | { request: { type: 'welcome/openSessionInPlayer'; sessionId: string }; response: OKResponse }
  | {
      request: { type: 'welcome/openSessionInRecorder'; sessionId: string; clock?: number; fork?: boolean };
      response: OKResponse;
    }
  | { request: { type: 'welcome/openNewSessionInRecorder' }; response: OKResponse }
  | { request: { type: 'welcome/deleteSession'; sessionId: string }; response: OKResponse }
  | { request: { type: 'welcome/likeSession'; sessionId: string; value: boolean }; response: OKResponse }
  | { request: { type: 'player/openInRecorder' }; response: OKResponse }
  | { request: { type: 'player/load' }; response: OKResponse }
  | { request: { type: 'player/play' }; response: OKResponse }
  | { request: { type: 'player/pause' }; response: OKResponse }
  | { request: { type: 'player/seek'; clock: number }; response: OKResponse }
  | { request: { type: 'player/comment'; text: string; clock?: number }; response: OKResponse }
  | { request: { type: 'player/likeSession'; value: boolean }; response: OKResponse }
  | { request: { type: 'player/syncWorkspace' }; response: OKResponse }
  | { request: { type: 'recorder/openTab'; tabId: RecorderUITabId }; response: OKResponse }
  | { request: { type: 'recorder/load'; skipConfirmation?: boolean }; response: OKResponse }
  | { request: { type: 'recorder/play' }; response: OKResponse }
  | { request: { type: 'recorder/record' }; response: OKResponse }
  | { request: { type: 'recorder/pause' }; response: OKResponse }
  | { request: { type: 'recorder/seek'; clock: number; useStepper?: boolean }; response: OKResponse }
  | { request: { type: 'recorder/syncWorkspace'; clock?: number }; response: OKResponse }
  | { request: { type: 'recorder/save' }; response: OKResponse }
  | { request: { type: 'recorder/publish' }; response: OKResponse }
  | { request: { type: 'recorder/undo' }; response: OKResponse }
  | { request: { type: 'recorder/redo' }; response: OKResponse }
  | { request: { type: 'recorder/setSelection'; selection?: RecorderSelection }; response: OKResponse }
  | { request: { type: 'recorder/extendSelection'; clock: number }; response: OKResponse }
  | { request: { type: 'recorder/updateDetails'; changes: SessionDetailsUpdate }; response: OKResponse }
  | { request: { type: 'recorder/insertAudio'; uri: string; clock: number }; response: OKResponse }
  | { request: { type: 'recorder/deleteAudio'; id: string }; response: OKResponse }
  | { request: { type: 'recorder/updateAudio'; update: Partial<AudioTrack> }; response: OKResponse }
  | { request: { type: 'recorder/insertVideo'; uri: string; clock: number }; response: OKResponse }
  | { request: { type: 'recorder/deleteVideo'; id: string }; response: OKResponse }
  | { request: { type: 'recorder/updateVideo'; update: Partial<VideoTrack> }; response: OKResponse }
  | { request: { type: 'recorder/setCover'; uri: string }; response: OKResponse }
  | { request: { type: 'recorder/deleteCover' }; response: OKResponse }
  | { request: { type: 'recorder/changeSpeed'; range: ClockRange; factor: number }; response: OKResponse }
  | { request: { type: 'recorder/merge'; range: ClockRange }; response: OKResponse }
  | { request: { type: 'recorder/insertGap'; clock: number; dur: number }; response: OKResponse }
  | { request: { type: 'recorder/insertChapter'; title: string; clock: number }; response: OKResponse }
  | { request: { type: 'recorder/updateChapter'; index: number; update: Partial<TocItem> }; response: OKResponse }
  | { request: { type: 'recorder/deleteChapter'; index: number }; response: OKResponse }
  | { request: { type: 'recorder/crop'; clock: number }; response: OKResponse }
  | { request: { type: 'recorder/makeTest' }; response: OKResponse }
  | { request: { type: 'getStore' }; response: StoreResponse }
  | { request: { type: 'showOpenDialog'; options: OpenDialogOptions }; response: UrisResponse }
  | { request: { type: 'readyToLoadMedia' }; response: OKResponse }
  | { request: { type: 'media/error'; id: string; mediaType: MediaType; error: string }; response: OKResponse };

export type BackendToFrontendReqRes =
  | { request: { type: 'updateStore'; store: Store }; response: OKResponse }
  | BackendToFrontendMediaReqRes;

export type BackendToFrontendMediaReqRes =
  | {
      request: {
        type: 'media/load';
        mediaType: MediaType;
        id: string;
        src: string;
        clock: number;
        loop?: boolean;
        blank?: boolean;
      };
      response: OKResponse;
    }
  | { request: { type: 'media/play'; mediaType: MediaType; id: string }; response: OKResponse }
  | { request: { type: 'media/pause'; mediaType: MediaType; id: string }; response: OKResponse }
  | { request: { type: 'media/pauseAll' }; response: OKResponse }
  | { request: { type: 'media/stop'; mediaType: MediaType; id: string }; response: OKResponse }
  | { request: { type: 'media/dispose'; mediaType: MediaType; id: string }; response: OKResponse }
  | { request: { type: 'media/seek'; mediaType: MediaType; id: string; clock: number }; response: OKResponse }
  | {
      request: { type: 'media/setPlaybackRate'; mediaType: MediaType; id: string; rate: number };
      response: OKResponse;
    }
  | { request: { type: 'media/statuses' }; response: { type: 'mediaStatuses'; mediaStatuses: MediaStatuses } };

export type FrontendRequest = FrontendToBackendReqRes['request'];
export type BackendResponse = FrontendToBackendReqRes['response'] | ErrorResponse;

export type BackendRequest = BackendToFrontendReqRes['request'];
export type FrontendResponse = BackendToFrontendReqRes['response'] | ErrorResponse;

export type BackendMediaRequest = BackendToFrontendMediaReqRes['request'];
export type FrontendMediaResponse = BackendToFrontendMediaReqRes['response'] | ErrorResponse;

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

// export type PostMessageOptions = {
//   performDefaultActions: boolean;
// };

// export type PostMessageToFrontend = <Req extends BackendRequest>(req: Req) => Promise<FrontendResponseFor<Req>>;
// export type PostMessageToBackend = <Req extends FrontendRequest>(
//   req: Req,
//   options?: PostMessageOptions,
// ) => Promise<BackendResponseFor<Req>>;

// export type B2SReqAccountJoin = { type: 'account/join'; credentials: Credentials };
// export type B2SResAccountJoin = { type: 'user'; user: User };

// export type B2SReqAccountLogin = { type: 'account/login'; credentials: Credentials };
// export type B2SResAccountLogin = { type: 'user'; user: User };

// export type B2SReqFeaturedGet = { type: 'featured/get' };
// export type B2SResFeaturedGet = { type: 'sessionHeads'; sessionHeads: SessionHead[] };

export type BackendToServerReqRes =
  | {
      request: { type: 'earlyAccessEmail'; email: string };
      response: BooleanResponse;
    }
  | {
      request: { type: 'user/join'; credentials: Credentials };
      response: { type: 'user'; user: User };
    }
  | {
      request: { type: 'user/login'; credentials: Credentials };
      response: { type: 'user'; user: User };
    }
  | {
      request: { type: 'user/metadata' };
      response: { type: 'userMetadata'; metadata: UserMetadata };
    }
  | {
      request: { type: 'sessions/featured' };
      response: {
        type: 'sessionHeadsAndPublications';
        heads: SessionHead[];
        publications: Record<string, SessionPublication>;
      };
    }
  | {
      request: { type: 'sessions/publications'; sessionIds: string[] };
      response: { type: 'sessionPublications'; publications: Record<string, SessionPublication> };
    }
  | {
      request: { type: 'session/comment/post'; sessionId: string; text: string; clock?: number };
      response: OKResponse;
    }
  | {
      request: { type: 'session/like/post'; sessionId: string; value: boolean };
      response: OKResponse;
    };
export type BackendToServerRequest = BackendToServerReqRes['request'];
export type ServerResponse = BackendToServerReqRes['response'] | ErrorResponse;
// export type ServerResponseFor<Req extends BackendToServerRequest> = Extract<
//   BackendToServerReqRes,
//   { request: { type: Req['type'] } }
// >['response'];

// const y: ServerResponseFor<{type: 'account/join'; credentials: Credentials}>
// const z: ServerResponseFor<{type: 'account/login'; credentials: Credentials}>

export type MediaType = 'audio' | 'video' | 'image';
export type MediaStatuses = Record<string, MediaStatus>;
export type MediaStatus = {
  type: MediaType;
  readyState: number;
  networkState: number;
  currentTime: number;
  volume: number;
  muted: boolean;
  duration: number;
  playbackRate: number;
  paused: boolean;
  seeking: boolean;
  ended: boolean;
  error: string;
  currentSrc: string;
  src: string;
};

export enum Screen {
  Account,
  Welcome,
  Recorder,
  Player,
  Loading,
}

export type WebviewConfig = {
  logWebviewVideoEvents: boolean;
  logWebviewAudioEvents: boolean;
  webviewUriBase: string;
  debug: boolean;
  extensionWebviewUri: string;
  server: string;
};

export type Store = {
  earlyAccessEmail?: string;
  screen: Screen;
  user?: UserUI;
  account?: AccountUIState;
  welcome?: WelcomeUIState;
  recorder?: RecorderUIState;
  player?: PlayerUIState;
  session?: SessionUIState;
  cache: CacheUIState;
  dev: DevUIState;
};

export type DevUIState = {
  lastestFormatVersion: number;
};

export type CacheUIState = {
  avatarsPath: string;
  coversPath: string;
  version: number;
};

export type User = {
  username: string;
  email: string;
  token: string;
  joinTimestamp: string;
  tokenTimestamp: string;
};

export type UserMetadata = {
  likes: string[];
};

export type UserUI = User & { metadata?: UserMetadata };

// export type UserSummary = {
//   username: string;
//   email: string;
//   // avatar?: string;
//   joinTimestamp: string;
// };

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

export type AccountUIState = AccountState;

export type AccountUpdate = Partial<AccountState>;

export type WelcomeUIState = {
  sessions: SessionUIListing[];
  loadingFeatured: boolean;
  error?: string;
};

export type RecorderUIState = {
  workspace?: string;
  tabId: RecorderUITabId;
  canUndo: boolean;
  canRedo: boolean;
  selection?: RecorderSelection;
};
export type RecorderUITabId = 'editor-view' | 'details-view';

export type RecorderSelection = RecorderSelectionEditor | RecorderSelectionTrack | RecorderSelectionChapter;
export type RecorderSelectionEditor = { type: 'editor'; focus: number; anchor: number };
export type RecorderSelectionTrack = { type: 'track'; trackType: MediaType; id: string };
export type RecorderSelectionChapter = { type: 'chapter'; index: number };

export type PlayerUIState = {
  // nothing yet.
};

export type SessionUIState = {
  local: boolean;
  temp: boolean;
  mustScan: boolean;
  loaded: boolean;
  playing: boolean;
  recording: boolean;
  head: SessionHead;
  clock: number;
  workspace: string;
  dataPath: string;
  // coverUri: string;
  workspaceFocusTimeline?: Focus[];
  audioTracks?: AudioTrack[];
  videoTracks?: VideoTrack[];
  history?: SessionHistory;
  publication?: SessionPublication;
  // blobsUriMap?: UriMap;
};

export type LoadedSessionUIState = SessionUIState & {
  workspaceFocusTimeline: Focus[];
  audioTracks: AudioTrack[];
  videoTracks: VideoTrack[];
  // blobsUriMap: UriMap;
};

export type SessionDetailsUpdate = {
  workspace?: string;
  title?: string;
  handle?: string;
  description?: string;
  ignorePatterns?: string;
};

export type TocItem = { title: string; clock: number };

export type SessionHead = {
  id: string;
  handle: string;
  title: string;
  description: string;
  author?: string;
  duration: number;
  modificationTimestamp: string;
  toc: TocItem[];
  forkedFrom?: string;
  hasCover: boolean;
  ignorePatterns: string;
  formatVersion: number;
};

export type SessionPublication = {
  comments: Comment[];
  likes: number;
  views: number;
  publishTimestamp: string;
};

// session id -> publication
// export type SessionPublicationMap = Record<string, SessionPublication>;

export type SessionListing = {
  group: 'recent' | 'current' | 'remote';
  local: boolean;
  head: SessionHead;
  workspace?: string;
};
export type SessionUIListing = SessionListing & {
  history?: SessionHistory;
  publication?: SessionPublication;
};

export type SessionPublishRes = {
  head: SessionHead;
  publication: SessionPublication;
};

// export type SessionMetadataRecord = Record<string, SessionPublication | undefined>;

export type Comment = {
  id: string;
  author: string;
  clock?: number;
  text: string;
  likes: number;
  dislikes: number;
  creationTimestamp: string;
  // modification_timestamp: string;
};

export type ClockRange = {
  start: number;
  end: number;
};

export type ClockRangeCompact = [number, number];

export type SessionBody = {
  editorEvents: EditorEvent[];
  audioTracks: AudioTrack[];
  videoTracks: VideoTrack[];
  focusTimeline: Focus[];
  defaultEol: EndOfLine;
};

export type SessionBodyExport = ({ full: true } & SessionBody) | ({ full?: false } & SessionBodyCompact);

export type SessionBodyCompact = {
  uris: string[];
  editorEvents: EditorEventCompact[];
  audioTracks: AudioTrack[];
  videoTracks: VideoTrack[];
  focusTimeline: FocusCompact[];
  defaultEol: EndOfLine;
};

export type Focus = {
  uri: string;
  number: number;
  text: string;
  clock: number;
};

export type FocusCompact = {
  u: number;
  t: string;
  n: number;
  c: number;
};

export type RangedTrack = {
  id: string;
  type: MediaType;
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

// export type UriMap = { [key: string]: string };

export type OpenDialogOptions = {
  canSelectFiles?: boolean;
  canSelectFolders?: boolean;
  canSelectMany?: boolean;
  defaultUri?: string;
  filters?: { [name: string]: string[] };
  title?: string;
};

export interface WorkspaceStepper {
  applyEditorEvent(e: EditorEvent, direction: Direction, uriSet?: UriSet): Promise<void>;
  applyFsCreateEvent(e: FsCreateEvent, direction: Direction, uriSet?: UriSet): Promise<void>;
  applyFsChangeEvent(e: FsChangeEvent, direction: Direction, uriSet?: UriSet): Promise<void>;
  applyFsDeleteEvent(e: FsDeleteEvent, direction: Direction, uriSet?: UriSet): Promise<void>;
  applyTextChangeEvent(e: TextChangeEvent, direction: Direction, uriSet?: UriSet): Promise<void>;
  applyOpenTextDocumentEvent(e: OpenTextDocumentEvent, direction: Direction, uriSet?: UriSet): Promise<void>;
  applyCloseTextDocumentEvent(e: CloseTextDocumentEvent, direction: Direction, uriSet?: UriSet): Promise<void>;
  applyUpdateTextDocumentEvent(e: UpdateTextDocumentEvent, direction: Direction, uriSet?: UriSet): Promise<void>;
  applyShowTextEditorEvent(e: ShowTextEditorEvent, direction: Direction, uriSet?: UriSet): Promise<void>;
  applyCloseTextEditorEvent(e: CloseTextEditorEvent, direction: Direction, uriSet?: UriSet): Promise<void>;
  applySelectEvent(e: SelectEvent, direction: Direction, uriSet?: UriSet): Promise<void>;
  applyScrollEvent(e: ScrollEvent, direction: Direction, uriSet?: UriSet): Promise<void>;
  applySaveEvent(e: SaveEvent, direction: Direction, uriSet?: UriSet): Promise<void>;
  applyTextInsertEvent(e: TextInsertEvent, direction: Direction, uriSet?: UriSet): Promise<void>;
}

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

export type ContentChange = {
  text: string;
  range: Range;
};

export type LineRange = {
  start: number;
  end: number;
};

export type EditorEvent =
  | FsCreateEvent
  | FsChangeEvent
  | FsDeleteEvent
  | TextChangeEvent
  | OpenTextDocumentEvent
  | CloseTextDocumentEvent
  | UpdateTextDocumentEvent
  | ShowTextEditorEvent
  | CloseTextEditorEvent
  | SelectEvent
  | ScrollEvent
  | SaveEvent
  | TextInsertEvent;

export type FsCreateEvent = {
  type: 'fsCreate';
  id: number;
  uri: string;
  clock: number;
  file: File;
};

export type FsChangeEvent = {
  type: 'fsChange';
  id: number;
  uri: string;
  clock: number;
  file: File;
  revFile: File;
};

export type FsDeleteEvent = {
  type: 'fsDelete';
  id: number;
  uri: string;
  clock: number;
  revFile: File;
};

export type TextChangeEvent = {
  type: 'textChange';
  id: number;
  uri: string;
  clock: number;
  contentChanges: ContentChange[];
  revContentChanges: ContentChange[];
  updateSelection: boolean;
};

export type OpenTextDocumentEvent = {
  type: 'openTextDocument';
  id: number;
  uri: string;
  clock: number;
  // text?: string;
  eol: EndOfLine;
  languageId: string;
  // isInWorktree?: boolean;
};

export type CloseTextDocumentEvent = {
  type: 'closeTextDocument';
  id: number;
  uri: string;
  clock: number;
  // revText: string;
  revEol: EndOfLine;
  revLanguageId: string;
};

export type UpdateTextDocumentEvent = {
  type: 'updateTextDocument';
  id: number;
  uri: string;
  clock: number;
  // eol: EndOfLine;
  languageId: string;
  revLanguageId: string;
};

export type ShowTextEditorEvent = {
  type: 'showTextEditor';
  id: number;
  uri: string;
  clock: number;
  // preserveFocus: boolean;
  selections: Selection[];
  visibleRange: LineRange;
  revUri?: string;
  justOpened: boolean;

  // The following are the reverse selection and visible range of the uri, not the revUri
  revSelections?: Selection[];
  revVisibleRange?: LineRange;

  // Recorder behavior changed between v1 and v2.
  // undefined means latest version.
  recorderVersion?: number;
};

export type CloseTextEditorEvent = {
  type: 'closeTextEditor';
  id: number;
  uri: string;
  clock: number;
  active: boolean;
  revSelections?: Selection[];
  revVisibleRange?: LineRange;
  // revSelections: Selection[];
};

export type SelectEvent = {
  type: 'select';
  id: number;
  uri: string;
  clock: number;
  selections: Selection[];
  // visibleRange: Range;
  revSelections: Selection[];
  // revVisibleRange: Range;
};

export type ScrollEvent = {
  type: 'scroll';
  id: number;
  uri: string;
  clock: number;
  visibleRange: LineRange;
  revVisibleRange: LineRange;
};

export type SaveEvent = {
  type: 'save';
  id: number;
  uri: string;
  clock: number;
};

export type TextInsertEvent = {
  type: 'textInsert';
  id: number;
  uri: string;
  clock: number;
  text: string;
  revRange: Range; // range.start is the position before text insert, while range.end is the position after text insert
  updateSelection: boolean;
};

export type EditorEventCompact =
  | FsCreateEventCompact
  | TextChangeEventCompact
  | OpenTextDocumentEventCompact
  | CloseTextDocumentEventCompact
  | ShowTextEditorEventCompact
  | CloseTextEditorEventCompact
  | SelectEventCompact
  | ScrollEventCompact
  | SaveEventCompact
  | TextInsertEventCompact
  | FsChangeEventCompact
  | FsDeleteEventCompact
  | UpdateTextDocumentEventCompact;

export type FsCreateEventCompact = {
  t: 0;
  u: number;
  c: number;
  f: File;
};

export type TextChangeEventCompact = {
  t: 1;
  u: number;
  c: number;
  cc: ContentChangeCompact[];
  rcc: ContentChangeCompact[];
  us?: boolean; // undefined defaults to true
};

export type OpenTextDocumentEventCompact = {
  t: 2;
  u: number;
  c: number;
  // x?: string;
  e: EndOfLine;
  l: string;
  // i?: boolean;
};

export type CloseTextDocumentEventCompact = {
  t: 3;
  u: number;
  c: number;
  // rt: string;
  re: EndOfLine;
  rl: string;
};

export type ShowTextEditorEventCompact = {
  t: 4;
  u: number;
  c: number;
  s: SelectionCompact[];
  v: LineRangeCompact;
  jo?: boolean; // undefined defaults to false
  ru?: number;
  rs?: SelectionCompact[];
  rv?: LineRangeCompact;
  rver?: number;
  // revSelections: Selection[];
};

export type CloseTextEditorEventCompact = {
  t: 5;
  u: number;
  c: number;
  a?: boolean; // undefined means true
  rs?: SelectionCompact[];
  rv?: LineRangeCompact;
};

export type SelectEventCompact = {
  t: 6;
  u: number;
  c: number;
  s: SelectionCompact[];
  // v: RangeCompact;
  rs: SelectionCompact[];
  // rv: RangeCompact;
};

export type ScrollEventCompact = {
  t: 7;
  u: number;
  c: number;
  v: LineRangeCompact;
  rv: LineRangeCompact;
};

export type SaveEventCompact = {
  t: 8;
  u: number;
  c: number;
};

export type TextInsertEventCompact = {
  t: 9;
  u: number;
  c: number;
  x: string;
  r: RangeCompact;
  us?: boolean; // undefined defaults to true
};

export type FsChangeEventCompact = {
  t: 10;
  u: number;
  c: number;
  f: File;
  rf: File;
};
export type FsDeleteEventCompact = {
  t: 11;
  u: number;
  c: number;
  rf: File;
};

export type UpdateTextDocumentEventCompact = {
  t: 12;
  u: number;
  c: number;
  l: string;
  rl: string;
};

export type PositionCompact = [number, number];
export type RangeCompact = [number, number, number, number];
export type LineRangeCompact = [number, number];
export type SelectionCompact = [number, number, number, number];
export type ContentChangeCompact = { t: string; r: [number, number, number, number] };

export enum Direction {
  Forwards,
  Backwards,
}

export type UriSet = Set<string>;

export type SessionSnapshot = {
  // Only some fields of the head are changed in the editor.
  // The rest are changed in the session detail whose undo/redo
  // is tracked separately if at all.
  head: EditableSessionHead;
  body: SessionBody;
  effects: SessionEffect[];
  // coalescing: boolean;
  // description: string;
  // affectedUris: string[];
};

export type SessionPatch = {
  head?: Partial<EditableSessionHead>;
  body?: Partial<SessionBody>;
  effects?: SessionEffect[];
};

export type SessionChange = {
  cur: SessionSnapshot;
  next: SessionSnapshot;
  direction: Direction;
  isTriggeredByUndoRedo: boolean;
};

export type EditableSessionHead = {
  duration: number;
  modificationTimestamp: string;
  toc: TocItem[];
};

export type SessionEffect =
  | {
      type: 'insertEditorEvent';
      event: EditorEvent;
      index: number;
    }
  | {
      type: 'updateEditorEvent';
      eventBefore: EditorEvent;
      eventAfter: EditorEvent;
      index: number;
    }
  | {
      type: 'cropEditorEvents';
      clock: number;
      events: EditorEvent[];
      index: number;
      rrClock: number;
    }
  | {
      type: 'changeSpeed';
      range: ClockRange;
      factor: number;
      rrClock: number;
    }
  | {
      type: 'merge';
      range: ClockRange;
      rrClock: number;
    }
  | {
      type: 'insertGap';
      clock: number;
      duration: number;
      rrClock: number;
    }
  | {
      type: 'setSelection';
      before?: RecorderSelection;
      after?: RecorderSelection;
    };

export interface InternalEditor {
  uri: string;
  document?: InternalDocument;
}

export interface InternalDocument {
  getContent(): Uint8Array;
}

// export type Worktree = { [key: Uri]: File };

export type File = DirFile | BlobFile | GitFile;
export type DirFile = {
  type: 'dir';
};
// export type BlankFile = {
//   type: 'blank';
// };
export type BlobFile = {
  type: 'blob';
  sha1: string;
};
export type GitFile = {
  type: 'git';
  sha1: string;
};

// export type TextEditorJSON = {
//   uri: string;
//   selections: SelectionJSON[];
//   visibleRange: LineRangeJSON;
//   // = [{ anchor: { line: 0, character: 0 }, active: { line: 0, character: 0 } }],
//   // = { start: { line: 0, character: 0 }, end: { line: 1, character: 0 } },
// };

// export type PositionJSON = {
//   line: number;
//   character: number;
// };

// export type SelectionJSON = {
//   anchor: PositionJSON;
//   active: PositionJSON;
// };

// export type LineRangeJSON = {
//   start: number;
//   end: number;
// };

export type EndOfLine = '\n' | '\r\n';

export type Settings = {
  history: SessionsHistory;
};

export type SessionsHistory = Record<string, SessionHistory>;

export type SessionHistory = {
  id: string;
  workspace: string;
  handle: string;
  lastRecordedTimestamp?: string;
  lastWatchedTimestamp?: string;
  lastWatchedClock?: number;
};

export type OSPaths = {
  home: string;
  data: string;
  config: string;
  cache: string;
  log: string;
  temp: string;
};

export type TestMeta = {
  dirtyTextDocuments: string[];
  openTextEditors: TestMetaTextEditor[];
  activeTextEditor?: string;
  languageIds: Record<string, string>;
};

export type TestMetaTextEditor = {
  uri: string;
  selections: Selection[];
  visibleRange: LineRange;
};

export type TestMetaCompact = {
  dirtyTextDocuments: string[];
  openTextEditors: TestMetaTextEditorCompact[];
  activeTextEditor?: string;
  languageIds: Record<string, string>;
};

export type TestMetaTextEditorCompact = {
  uri: string;
  selections: SelectionCompact[];
  visibleRange: LineRangeCompact;
};

export namespace BodyFormatV1 {
  export type SessionBodyCompact = {
    audioTracks: AudioTrack[];
    videoTracks: VideoTrack[];
    editorTracks: Record<string, EditorEventCompact[]>;
    focusTimeline: FocusCompact[];
    defaultEol: EndOfLine;
  };

  export type FocusCompact = {
    u: string;
    t: string;
    n: number;
    c: number;
  };

  export type File = DirFile | EmptyFile | LocalFile | GitFile;
  export type DirFile = {
    type: 'dir';
  };
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

  export type RangedTrack = {
    id: string;
    type: MediaType;
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

  export type EditorEventCompact =
    | FsCreateEventCompact
    | TextChangeEventCompact
    | OpenTextDocumentEventCompact
    | CloseTextDocumentEventCompact
    | ShowTextEditorEventCompact
    | CloseTextEditorEventCompact
    | SelectEventCompact
    | ScrollEventCompact
    | SaveEventCompact
    | TextInsertEventCompact;

  export type FsCreateEventCompact = {
    t: 0;
    c: number;
    f: File;
  };

  export type TextChangeEventCompact = {
    t: 1;
    c: number;
    cc: ContentChangeCompact[];
    rcc: ContentChangeCompact[];
    u?: boolean; // undefined defaults to true
  };

  export type OpenTextDocumentEventCompact = {
    t: 2;
    c: number;
    // x?: string;
    e: EndOfLine;
    // i: boolean;
  };

  export type CloseTextDocumentEventCompact = {
    t: 3;
    c: number;
    rt: string;
    re: EndOfLine;
  };

  export type ShowTextEditorEventCompact = {
    t: 4;
    c: number;
    p?: boolean; // undefined defaults to false
    s?: SelectionCompact[];
    v?: LineRangeCompact;
    ru?: string;
    rs?: SelectionCompact[];
    rv?: LineRangeCompact;
    // revSelections: Selection[];
  };

  export type CloseTextEditorEventCompact = {
    t: 5;
    c: number;
    rs?: SelectionCompact[];
    rv?: LineRangeCompact;
  };

  export type SelectEventCompact = {
    t: 6;
    c: number;
    s: SelectionCompact[];
    // v: RangeCompact;
    rs: SelectionCompact[];
    // rv: RangeCompact;
  };

  export type ScrollEventCompact = {
    t: 7;
    c: number;
    v: LineRangeCompact;
    rv: LineRangeCompact;
  };

  export type SaveEventCompact = {
    t: 8;
    c: number;
  };

  export type TextInsertEventCompact = {
    t: 9;
    c: number;
    x: string;
    r: RangeCompact;
    u?: boolean; // undefined defaults to true
  };
}
