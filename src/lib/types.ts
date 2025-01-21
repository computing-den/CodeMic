import type { Position, Range, LineRange, Selection, ContentChange } from './lib.js';

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
  | { request: { type: 'player/open'; sessionId: string }; response: OKResponse }
  | { request: { type: 'player/load' }; response: OKResponse }
  | { request: { type: 'player/play' }; response: OKResponse }
  | { request: { type: 'player/pause' }; response: OKResponse }
  | { request: { type: 'player/seek'; clock: number }; response: OKResponse }
  // | { request: { type: 'player/update'; changes: PlayerUpdate }; response: OKResponse }
  | {
      request: { type: 'recorder/open'; sessionId?: string; clock?: number; fork?: boolean };
      response: OKResponse;
    }
  | { request: { type: 'recorder/openTab'; tabId: RecorderUITabId }; response: OKResponse }
  | { request: { type: 'recorder/load' }; response: OKResponse }
  | { request: { type: 'recorder/play' }; response: OKResponse }
  | { request: { type: 'recorder/record' }; response: OKResponse }
  | { request: { type: 'recorder/pause' }; response: OKResponse }
  | { request: { type: 'recorder/seek'; clock: number }; response: OKResponse }
  | { request: { type: 'recorder/save' }; response: OKResponse }
  | { request: { type: 'recorder/publish' }; response: OKResponse }
  | { request: { type: 'recorder/undo' }; response: OKResponse }
  | { request: { type: 'recorder/redo' }; response: OKResponse }
  | { request: { type: 'recorder/updateDetails'; changes: SessionDetailsUpdate }; response: OKResponse }
  // | { request: { type: 'recorder/updateDuration'; duration: number }; response: OKResponse }
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
  // | { request: { type: 'toggleRecorderStudio' }; response: OKResponse }
  | { request: { type: 'deleteSession'; sessionId: string }; response: OKResponse }
  | { request: { type: 'getStore' }; response: StoreResponse }
  | { request: { type: 'showOpenDialog'; options: OpenDialogOptions }; response: UrisResponse }
  | { request: { type: 'confirmForkFromPlayer' }; response: BooleanResponse }
  | { request: { type: 'confirmEditFromPlayer'; clock: number }; response: BooleanResponse }
  | { request: { type: 'test'; value: any }; response: OKResponse }
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
  // | { request: { type: 'updateCacheVersion'; version: number }; response: OKResponse }
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
  | { request: { type: 'video/loadTrack'; track: VideoTrack }; response: OKResponse }
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
// export type B2SResFeaturedGet = { type: 'sessionHeads'; sessionHeads: SessionHead[] };

export type BackendToServerReqRes =
  | {
      request: { type: 'earlyAccessEmail'; email: string };
      response: BooleanResponse;
    }
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
      response: { type: 'sessionHeads'; sessionHeads: SessionHead[] };
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
  Loading,
}

export type WebviewConfig = {
  webviewUriBase: string;
  debug: boolean;
  extensionWebviewUri: string;
};

export type Store = {
  earlyAccessEmail?: string;
  screen: Screen;
  user?: User;
  account?: AccountUIState;
  welcome?: WelcomeUIState;
  recorder?: RecorderUIState;
  player?: PlayerUIState;
  session?: SessionUIState;
  // webviewUriBase: string;
  test?: any;
  cache: CacheUIState;
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
  // avatar?: string;
  joinTimestamp: string;
  tokenTimestamp: string;
};

export type UserSummary = {
  username: string;
  email: string;
  // avatar?: string;
  joinTimestamp: string;
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

export type AccountUIState = AccountState;

export type AccountUpdate = Partial<AccountState>;

export type WelcomeUIState = {
  error?: string;
  workspace?: string;
  current?: SessionHead;
  recent: SessionHead[];
  featured: SessionHead[];
  history: SessionsHistory;
  loadingFeatured: boolean;
  // coversUris: UriMap;
};

export type RecorderUIState = {
  workspace?: string;
  tabId: RecorderUITabId;
};
export type RecorderUITabId = 'editor-view' | 'details-view';

export type PlayerUIState = {
  // nothing yet.
};

export type SessionUIState = {
  temp: boolean;
  mustScan: boolean;
  loaded: boolean;
  playing: boolean;
  recording: boolean;
  canUndo: boolean;
  canRedo: boolean;
  head: SessionHead;
  clock: number;
  workspace: string;
  dataPath: string;
  // coverUri: string;
  history?: SessionHistory;
  workspaceFocusTimeline?: Focus[];
  audioTracks?: AudioTrack[];
  videoTracks?: VideoTrack[];
  // blobsUriMap?: UriMap;
  comments?: Comment[];
};

export type LoadedSessionUIState = SessionUIState & {
  workspaceFocusTimeline: Focus[];
  audioTracks: AudioTrack[];
  videoTracks: VideoTrack[];
  // blobsUriMap: UriMap;
  comments: Comment[];
};

export type SessionDetailsUpdate = {
  title?: string;
  handle?: string;
  description?: string;
  workspace?: string;
  ignorePatterns?: string;
};

export type TocItem = { title: string; clock: number };

export type SessionHead = {
  id: string;
  handle: string;
  title: string;
  description: string;
  author?: string;
  // published: boolean;
  // publishedUri?: Uri;
  duration: number;
  views: number;
  likes: number;
  publishTimestamp?: string;
  modificationTimestamp: string;
  toc: TocItem[];
  forkedFrom?: string;
  hasCover: boolean;
  ignorePatterns: string;
  formatVersion: number;
};

export type SessionHeadMap = { [key: string]: SessionHead | undefined };

export type Comment = {
  id: string;
  author: string;
  text: string;
  likes: number;
  dislikes: number;
  creation_timestamp: string;
  // modification_timestamp: string;
};

export type ClockRange = {
  start: number;
  end: number;
};

export type ClockRangeCompact = [number, number];

export type SessionBodyJSON = {
  audioTracks: AudioTrack[];
  videoTracks: VideoTrack[];
  editorTracks: InternalEditorTracksJSON;
  focusTimeline: Focus[];
  defaultEol: EndOfLine;
};

export type SessionBodyCompact = {
  audioTracks: AudioTrack[];
  videoTracks: VideoTrack[];
  editorTracks: InternalEditorTracksCompact;
  focusTimeline: FocusCompact[];
  defaultEol: EndOfLine;
};

export type InternalEditorTracksJSON = Record<string, EditorEvent[]>;
export type InternalEditorTracksCompact = Record<string, EditorEventCompact[]>;

export type Focus = {
  uri: string;
  number: number;
  text: string;
  clock: number;
};

export type FocusCompact = {
  u: string;
  t: string;
  n: number;
  c: number;
};

export type RangedTrack = {
  id: string;
  type: 'audio' | 'video' | 'image';
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
  applyEditorEvent(e: EditorEvent, uri: string, direction: Direction, uriSet?: UriSet): Promise<void>;
  applyInitEvent(e: InitEvent, uri: string, direction: Direction, uriSet?: UriSet): Promise<void>;
  applyTextChangeEvent(e: TextChangeEvent, uri: string, direction: Direction, uriSet?: UriSet): Promise<void>;
  applyOpenTextDocumentEvent(
    e: OpenTextDocumentEvent,
    uri: string,
    direction: Direction,
    uriSet?: UriSet,
  ): Promise<void>;
  applyCloseTextDocumentEvent(
    e: CloseTextDocumentEvent,
    uri: string,
    direction: Direction,
    uriSet?: UriSet,
  ): Promise<void>;
  applyShowTextEditorEvent(e: ShowTextEditorEvent, uri: string, direction: Direction, uriSet?: UriSet): Promise<void>;
  applyCloseTextEditorEvent(e: CloseTextEditorEvent, uri: string, direction: Direction, uriSet?: UriSet): Promise<void>;
  applySelectEvent(e: SelectEvent, uri: string, direction: Direction, uriSet?: UriSet): Promise<void>;
  applyScrollEvent(e: ScrollEvent, uri: string, direction: Direction, uriSet?: UriSet): Promise<void>;
  applySaveEvent(e: SaveEvent, uri: string, direction: Direction, uriSet?: UriSet): Promise<void>;
  applyTextInsertEvent(e: TextInsertEvent, uri: string, direction: Direction, uriSet?: UriSet): Promise<void>;
}

export type EditorEvent =
  | InitEvent
  | TextChangeEvent
  | OpenTextDocumentEvent
  | CloseTextDocumentEvent
  | ShowTextEditorEvent
  | CloseTextEditorEvent
  | SelectEvent
  | ScrollEvent
  | SaveEvent
  | TextInsertEvent;

export type EditorEventWithUri = { event: EditorEvent; uri: string };

export type InitEvent = {
  type: 'init';
  clock: number;
  file: File;
};

export type TextChangeEvent = {
  type: 'textChange';
  clock: number;
  contentChanges: ContentChange[];
  revContentChanges: ContentChange[];
  updateSelection: boolean;
};

export type OpenTextDocumentEvent = {
  type: 'openTextDocument';
  clock: number;
  text?: string;
  eol: EndOfLine;
  isInWorktree: boolean;
};

export type CloseTextDocumentEvent = {
  type: 'closeTextDocument';
  clock: number;
  revText: string;
  revEol: EndOfLine;
};

export type ShowTextEditorEvent = {
  type: 'showTextEditor';
  clock: number;
  preserveFocus: boolean;
  selections?: Selection[];
  visibleRange?: LineRange;
  revUri?: string;
  revSelections?: Selection[];
  revVisibleRange?: LineRange;
  // revSelections: Selection[];
};

export type CloseTextEditorEvent = {
  type: 'closeTextEditor';
  clock: number;
  revSelections?: Selection[];
  revVisibleRange?: LineRange;
  // revSelections: Selection[];
};

export type SelectEvent = {
  type: 'select';
  clock: number;
  selections: Selection[];
  // visibleRange: Range;
  revSelections: Selection[];
  // revVisibleRange: Range;
};

export type ScrollEvent = {
  type: 'scroll';
  clock: number;
  visibleRange: LineRange;
  revVisibleRange: LineRange;
};

export type SaveEvent = {
  type: 'save';
  clock: number;
};

export type TextInsertEvent = {
  type: 'textInsert';
  clock: number;
  text: string;
  revRange: Range; // range.start is the position before text insert, while range.end is the position after text insert
  updateSelection: boolean;
};

export type EditorEventCompact =
  | InitEventCompact
  | TextChangeEventCompact
  | OpenTextDocumentEventCompact
  | CloseTextDocumentEventCompact
  | ShowTextEditorEventCompact
  | CloseTextEditorEventCompact
  | SelectEventCompact
  | ScrollEventCompact
  | SaveEventCompact
  | TextInsertEventCompact;

export type InitEventCompact = {
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
  x?: string;
  e: EndOfLine;
  i: boolean;
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

export type Cmd =
  | InsertEventCmd
  | UpdateTrackLastEventCmd
  | InsertFocusCmd
  | UpdateLastFocusCmd
  | InsertAudioTrackCmd
  | DeleteAudioTrackCmd
  | UpdateAudioTrackCmd
  | InsertVideoTrackCmd
  | DeleteVideoTrackCmd
  | UpdateVideoTrackCmd
  | ChangeSpeedCmd
  | MergeCmd
  | InsertGapCmd
  | InsertChapterCmd
  | UpdateChapterCmd
  | DeleteChapterCmd
  | CropCmd
  | UpdateDurationCmd;

export type InsertEventCmd = {
  type: 'insertEvent';
  // coalescing: boolean;
  index: number;
  uri: string;
  event: EditorEvent;
};

export type UpdateTrackLastEventCmd = {
  type: 'updateTrackLastEvent';
  // coalescing: boolean;
  uri: string;
  update: Partial<EditorEvent>;
  revUpdate: Partial<EditorEvent>;
};

export type InsertFocusCmd = {
  type: 'insertFocus';
  // coalescing: boolean;
  focus: Focus;
};

export type UpdateLastFocusCmd = {
  type: 'updateLastFocus';
  // coalescing: boolean;
  update: Partial<Focus>;
  revUpdate: Partial<Focus>;
};

export type InsertAudioTrackCmd = {
  type: 'insertAudioTrack';
  // coalescing: boolean;
  index: number;
  audioTrack: AudioTrack;
  sessionDuration: number;
  revSessionDuration: number;
};
export type DeleteAudioTrackCmd = {
  type: 'deleteAudioTrack';
  // coalescing: boolean;
  index: number;
  audioTrack: AudioTrack;
};
export type UpdateAudioTrackCmd = {
  type: 'updateAudioTrack';
  // coalescing: boolean;
  id: string;
  update: Partial<AudioTrack>;
  revUpdate: Partial<AudioTrack>;
};
export type InsertVideoTrackCmd = {
  type: 'insertVideoTrack';
  // coalescing: boolean;
  index: number;
  videoTrack: VideoTrack;
  sessionDuration: number;
  revSessionDuration: number;
};
export type DeleteVideoTrackCmd = {
  type: 'deleteVideoTrack';
  // coalescing: boolean;
  index: number;
  videoTrack: VideoTrack;
};
export type UpdateVideoTrackCmd = {
  type: 'updateVideoTrack';
  // coalescing: boolean;
  id: string;
  update: Partial<VideoTrack>;
  revUpdate: Partial<VideoTrack>;
};
export type ChangeSpeedCmd = {
  type: 'changeSpeed';
  // coalescing: boolean;
  range: ClockRange;
  factor: number;
  firstEventIndex: number;
  firstFocusIndex: number;
  firstTocIndex: number;
  revEventClocks: number[];
  revFocusClocks: number[];
  revTocClocks: number[];
  revRrClock: number;
};
export type MergeCmd = {
  type: 'merge';
  // coalescing: boolean;
  range: ClockRange;
  firstEventIndex: number;
  firstFocusIndex: number;
  firstTocIndex: number;
  revEventClocks: number[];
  revFocusClocks: number[];
  revTocClocks: number[];
  revRrClock: number;
};
// export type MergeCmd = {
//   type: 'merge';
//   coalescing: boolean;
// };
export type InsertGapCmd = {
  type: 'insertGap';
  clock: number;
  duration: number;
};
export type InsertChapterCmd = {
  type: 'insertChapter';
  clock: number;
  title: string;
};
export type UpdateChapterCmd = {
  type: 'updateChapter';
  index: number;
  update: Partial<TocItem>;
  revUpdate: Partial<TocItem>;
};
export type DeleteChapterCmd = {
  type: 'deleteChapter';
  index: number;
  chapter: TocItem;
};
export type CropCmd = {
  type: 'crop';
  clock: number;
  firstEventIndex: number;
  firstFocusIndex: number;
  firstTocIndex: number;
  revEvents: EditorEventWithUri[];
  revFocusTimeline: Focus[];
  revDuration: number;
  revToc: TocItem[];
  revRrClock: number;
};
export type UpdateDurationCmd = {
  type: 'updateDuration';
  // coalescing: boolean;
  duration: number;
  revDuration: number;
};

export interface InternalEditor {
  document: InternalDocument;
}

export interface InternalDocument {
  getContent(): Uint8Array;
}

// export type Worktree = { [key: Uri]: File };

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

export type TextEditor = {
  uri: string;
  selections: Selection[];
  visibleRange: LineRange;
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
