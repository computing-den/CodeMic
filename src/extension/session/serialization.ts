import * as t from '../../lib/types.js';
import { nextId, getLangaugeIdFromUri } from '../../lib/lib.js';
import _ from 'lodash';
import config from '../config.js';

type UriMap = Map<string, number>;

export function serializeSessionBody(body: t.SessionBody): t.SessionBodyExport {
  if (config.exportFullBody) return { full: true, ...body };

  const uris = _.uniq(
    _.concat(
      body.editorEvents.map(e => e.uri),
      body.focusTimeline.map(e => e.uri),
    ),
  );
  const uriMap = new Map(uris.map((uri, i) => [uri, i])); // URI to number
  return {
    uris,
    editorEvents: _.map(body.editorEvents, t => serializeEditorEvent(t, uriMap)),
    audioTracks: body.audioTracks,
    videoTracks: body.videoTracks,
    defaultEol: body.defaultEol,
    focusTimeline: body.focusTimeline.map(f => serializeFocus(f, uriMap)),
  };
}

function serializeEditorEvent(e: t.EditorEvent, uriMap: UriMap): t.EditorEventCompact {
  switch (e.type) {
    case 'fsCreate':
      return {
        t: 0,
        u: uriMap.get(e.uri)!,
        c: serializeClock(e.clock),
        f: e.file,
      };
    case 'textChange':
      return {
        t: 1,
        u: uriMap.get(e.uri)!,
        c: serializeClock(e.clock),
        cc: e.contentChanges.map(serializeContentChange),
        rcc: e.revContentChanges.map(serializeContentChange),
        us: e.updateSelection ? undefined : false,
        // w: e.wasDirty ? undefined : false,
      };
    case 'openTextDocument':
      return {
        t: 2,
        u: uriMap.get(e.uri)!,
        c: serializeClock(e.clock),
        e: e.eol,
        l: e.languageId,
      };

    case 'closeTextDocument':
      return {
        t: 3,
        u: uriMap.get(e.uri)!,
        c: serializeClock(e.clock),
        rt: e.revText,
        re: e.revEol,
        rl: e.revLanguageId,
      };

    case 'showTextEditor':
      return {
        t: 4,
        u: uriMap.get(e.uri)!,
        c: serializeClock(e.clock),
        s: e.selections?.map(serializeSelection),
        v: e.visibleRange && serializeLineRange(e.visibleRange),
        jo: e.justOpened ? true : undefined,
        ru: e.revUri ? uriMap.get(e.revUri) : undefined,
        rs: e.revSelections?.map(serializeSelection),
        rv: e.revVisibleRange && serializeLineRange(e.revVisibleRange),
        rver: e.recorderVersion,
      };

    case 'closeTextEditor':
      return {
        t: 5,
        u: uriMap.get(e.uri)!,
        c: serializeClock(e.clock),
        a: e.active ? undefined : false,
        rs: e.revSelections?.map(serializeSelection),
        rv: e.revVisibleRange && serializeLineRange(e.revVisibleRange),
      };
    case 'select':
      return {
        t: 6,
        u: uriMap.get(e.uri)!,
        c: serializeClock(e.clock),
        s: e.selections.map(serializeSelection),
        // v: serializeRange(e.visibleRange),
        rs: e.revSelections?.map(serializeSelection),
        // rv: e.revVisibleRange && serializeRange(e.revVisibleRange),
      };

    case 'scroll':
      return {
        t: 7,
        u: uriMap.get(e.uri)!,
        c: serializeClock(e.clock),
        v: serializeLineRange(e.visibleRange),
        rv: e.revVisibleRange && serializeLineRange(e.revVisibleRange),
      };

    case 'save':
      return {
        t: 8,
        u: uriMap.get(e.uri)!,
        c: serializeClock(e.clock),
      };
    case 'textInsert':
      return {
        t: 9,
        u: uriMap.get(e.uri)!,
        c: serializeClock(e.clock),
        x: e.text,
        r: serializeRange(e.revRange),
        us: e.updateSelection ? undefined : false,
        // w: e.wasDirty ? undefined : false,
      };
    case 'fsChange':
      return {
        t: 10,
        u: uriMap.get(e.uri)!,
        c: serializeClock(e.clock),
        f: e.file,
        rf: e.revFile,
      };
    case 'fsDelete':
      return {
        t: 11,
        u: uriMap.get(e.uri)!,
        c: serializeClock(e.clock),
        rf: e.revFile,
      };
    case 'updateTextDocument':
      return {
        t: 12,
        u: uriMap.get(e.uri)!,
        c: serializeClock(e.clock),
        l: e.languageId,
        rl: e.revLanguageId,
      };
    default:
      throw new Error(`Unknown event: ${JSON.stringify(e)}`);
  }
}

function serializeContentChange(cc: t.ContentChange): t.ContentChangeCompact {
  return { t: cc.text, r: serializeRange(cc.range) };
}

function serializeRange(r: t.Range): t.RangeCompact {
  return [r.start.line, r.start.character, r.end.line, r.end.character];
}

function serializeLineRange(r: t.LineRange): t.LineRangeCompact {
  return [r.start, r.end];
}

function serializeSelection(r: t.Selection): t.SelectionCompact {
  return [r.anchor.line, r.anchor.character, r.active.line, r.active.character];
}

function serializeClock(clock: number): number {
  return Math.floor(clock * 10);
}

function serializeClockRange(r: t.ClockRange): t.ClockRangeCompact {
  return [serializeClock(r.start), serializeClock(r.end)];
}

function serializeFocus(focus: t.Focus, uriMap: UriMap): t.FocusCompact {
  return {
    c: serializeClock(focus.clock),
    u: uriMap.get(focus.uri)!,
    t: focus.text,
    n: focus.line,
  };
}

export function serializeTestMeta(meta: t.TestMeta): t.TestMetaCompact {
  return {
    dirtyTextDocuments: meta.dirtyTextDocuments,
    openTextEditors: meta.openTextEditors.map(e => ({
      uri: e.uri,
      selections: e.selections.map(serializeSelection),
      visibleRange: serializeLineRange(e.visibleRange),
    })),
    activeTextEditor: meta.activeTextEditor,
    languageIds: meta.languageIds,
  };
}

export function deserializeSessionBody(body: any, formatVersion: number): t.SessionBody {
  switch (formatVersion) {
    case 1:
      return deserializeSessionBodyV1(body as t.BodyFormatV1.SessionBodyCompact);
    case 2:
      return deserializeSessionBodyV2(body as t.SessionBodyExport);
    default:
      throw new Error(`Unknown format version ${formatVersion}`);
  }
}

export function deserializeSessionBodyV1(body: t.BodyFormatV1.SessionBodyCompact): t.SessionBody {
  const untitledRegex = /^untitled:Untitled-\d+$/;
  let editorEvents = _.flatMap(body.editorTracks, (t, uri) => _.map(t, e => deserializeEditorEventV1(e, uri)));
  editorEvents = _.orderBy(editorEvents, 'clock');

  // NOTE: the following removes a showTextEditor. The next showTextEditor's revUri is going to be
  // wrong which causes the wrong value to be set for activeTextEditor (often undefined) when rewinding.
  // // Since v1 didn't support file system events, we had a lot of openTextDocument
  // // for untitled documents that were then immediately saved to file.
  // // They were always openTextDocument->showTextEditor->closeTextEditor.
  // // Remove them.
  // for (let i = 0; i < editorEvents.length - 2; ) {
  //   const [a, b, c] = [editorEvents[i], editorEvents[i + 1], editorEvents[i + 2]];
  //   if (
  //     a.type === 'openTextDocument' &&
  //     untitledRegex.test(a.uri) &&
  //     b.type === 'showTextEditor' &&
  //     b.uri === a.uri &&
  //     c.type === 'closeTextEditor' &&
  //     c.uri === a.uri
  //   ) {
  //     editorEvents.splice(i, 3);
  //   } else {
  //     i++;
  //   }
  // }

  // When creating a new file, we have an openTextDocument with isInWorktree: false.
  // Turn those into fsCreate with blank file if scheme is file.
  for (let i = 0; i < editorEvents.length; ) {
    const a = editorEvents[i];
    if (
      a.type === 'openTextDocument' &&
      !untitledRegex.test(a.uri) &&
      a._isInWorktree === false &&
      !editorEvents.slice(0, i).some(b => a.uri === b.uri && b.type === 'fsCreate')
    ) {
      const fsCreate: t.EditorEvent = {
        type: 'fsCreate',
        id: nextId(),
        uri: a.uri,
        clock: a.clock,
        file: { type: 'blank' },
      };
      editorEvents.splice(i, 0, fsCreate);
      i += 2;
    } else {
      i++;
    }
  }

  // Set showTextEditor.justOpened to true if there's no showTextEditor for that uri
  // before it.
  for (let i = 0; i < editorEvents.length; i++) {
    const a = editorEvents[i];
    if (
      a.type === 'showTextEditor' &&
      !editorEvents.slice(0, i).some(b => a.uri === b.uri && b.type === 'showTextEditor')
    ) {
      a.justOpened = true;
    }
  }

  return {
    editorEvents,
    audioTracks: body.audioTracks.map(deserializeAudioTrackV1),
    videoTracks: body.videoTracks.map(deserializeVideoTrackV1),
    defaultEol: body.defaultEol,
    focusTimeline: body.focusTimeline.map(deserializeFocusV1),
  };
}

export function deserializeSessionBodyV2(body: t.SessionBodyExport): t.SessionBody {
  if (body.full) return _.omit(body, 'full');

  return {
    editorEvents: _.map(body.editorEvents, t => deserializeEditorEvent(t, body.uris)),
    audioTracks: body.audioTracks,
    videoTracks: body.videoTracks,
    defaultEol: body.defaultEol,
    focusTimeline: body.focusTimeline.map(f => deserializeFocus(f, body.uris)),
  };
}

function deserializeEditorEvent(e: t.EditorEventCompact, uris: string[]): t.EditorEvent {
  switch (e.t) {
    case 0:
      return {
        type: 'fsCreate',
        id: nextId(),
        uri: uris[e.u],
        clock: deserializeClock(e.c),
        file: e.f,
      };
    case 1:
      return {
        type: 'textChange',
        id: nextId(),
        uri: uris[e.u],
        clock: deserializeClock(e.c),
        contentChanges: e.cc.map(deserializeContentChange),
        revContentChanges: e.rcc.map(deserializeContentChange),
        updateSelection: e.us ?? true,
        // wasDirty: e.w ?? true,
      };
    case 2:
      return {
        type: 'openTextDocument',
        id: nextId(),
        uri: uris[e.u],
        clock: deserializeClock(e.c),
        eol: e.e,
        languageId: e.l,
      };
    case 3:
      return {
        type: 'closeTextDocument',
        id: nextId(),
        uri: uris[e.u],
        clock: deserializeClock(e.c),
        revText: e.rt,
        revEol: e.re,
        revLanguageId: e.rl,
      };
    case 4:
      return {
        type: 'showTextEditor',
        id: nextId(),
        uri: uris[e.u],
        clock: deserializeClock(e.c),
        selections: e.s?.map(deserializeSelection),
        visibleRange: e.v && deserializeLineRange(e.v),
        justOpened: e.jo ?? false,
        revUri: e.ru === undefined ? undefined : uris[e.ru],
        revSelections: e.rs?.map(deserializeSelection),
        revVisibleRange: e.rv && deserializeLineRange(e.rv),
        recorderVersion: e.rver,
      };
    case 5:
      return {
        type: 'closeTextEditor',
        id: nextId(),
        uri: uris[e.u],
        clock: deserializeClock(e.c),
        active: e.a === undefined ? true : false,
        revSelections: e.rs?.map(deserializeSelection),
        revVisibleRange: e.rv && deserializeLineRange(e.rv),
      };
    case 6:
      return {
        type: 'select',
        id: nextId(),
        uri: uris[e.u],
        clock: deserializeClock(e.c),
        selections: e.s.map(deserializeSelection),
        // visibleRange: deserializeRange(e.v),
        revSelections: e.rs.map(deserializeSelection),
        // revVisibleRange: deserializeRange(e.rv),
      };
    case 7:
      return {
        type: 'scroll',
        id: nextId(),
        uri: uris[e.u],
        clock: deserializeClock(e.c),
        visibleRange: deserializeLineRange(e.v),
        revVisibleRange: deserializeLineRange(e.rv),
      };
    case 8:
      return {
        type: 'save',
        id: nextId(),
        uri: uris[e.u],
        clock: deserializeClock(e.c),
      };
    case 9:
      return {
        type: 'textInsert',
        id: nextId(),
        uri: uris[e.u],
        clock: deserializeClock(e.c),
        text: e.x,
        revRange: deserializeRange(e.r),
        updateSelection: e.us ?? true,
        // wasDirty: e.w ?? true,
      };
    case 10:
      return {
        type: 'fsChange',
        id: nextId(),
        uri: uris[e.u],
        clock: deserializeClock(e.c),
        file: e.f,
        revFile: e.rf,
      };
    case 11:
      return {
        type: 'fsDelete',
        id: nextId(),
        uri: uris[e.u],
        clock: deserializeClock(e.c),
        revFile: e.rf,
      };
    case 12:
      return {
        type: 'updateTextDocument',
        id: nextId(),
        uri: uris[e.u],
        clock: deserializeClock(e.c),
        languageId: e.l,
        revLanguageId: e.rl,
      };
    default:
      throw new Error(`Unknown event: ${JSON.stringify(e)}`);
  }
}

function deserializeEditorEventV1(e: t.BodyFormatV1.EditorEventCompact, uri: string): t.EditorEvent {
  switch (e.t) {
    case 0:
      return {
        type: 'fsCreate',
        id: nextId(),
        uri,
        clock: deserializeClock(e.c),
        file: deserializeFileV1(e.f),
      };
    case 1:
      return {
        type: 'textChange',
        id: nextId(),
        uri,
        clock: deserializeClock(e.c),
        contentChanges: e.cc.map(deserializeContentChange),
        revContentChanges: e.rcc.map(deserializeContentChange),
        updateSelection: e.u ?? true,
        // wasDirty: true,
      };
    case 2:
      return {
        type: 'openTextDocument',
        id: nextId(),
        uri,
        clock: deserializeClock(e.c),
        eol: e.e,
        languageId: getLangaugeIdFromUri(uri),
        _isInWorktree: e.i,
      };
    case 3:
      return {
        type: 'closeTextDocument',
        id: nextId(),
        uri,
        clock: deserializeClock(e.c),
        revText: e.rt,
        revEol: e.re,
        revLanguageId: getLangaugeIdFromUri(uri),
      };
    case 4:
      return {
        type: 'showTextEditor',
        id: nextId(),
        uri,
        clock: deserializeClock(e.c),
        selections: e.s?.map(deserializeSelection) ?? [
          { anchor: { line: 0, character: 0 }, active: { line: 0, character: 0 } },
        ],
        visibleRange: (e.v && deserializeLineRange(e.v)) ?? { start: 0, end: 1 },
        justOpened: false,
        revUri: e.ru,
        revSelections: e.rs?.map(deserializeSelection),
        revVisibleRange: e.rv && deserializeLineRange(e.rv),
        recorderVersion: 1,
      };
    case 5:
      return {
        type: 'closeTextEditor',
        id: nextId(),
        uri,
        clock: deserializeClock(e.c),
        active: true,
        revSelections: e.rs?.map(deserializeSelection),
        revVisibleRange: e.rv && deserializeLineRange(e.rv),
      };
    case 6:
      return {
        type: 'select',
        id: nextId(),
        uri,
        clock: deserializeClock(e.c),
        selections: e.s.map(deserializeSelection),
        // visibleRange: deserializeRange(e.v),
        revSelections: e.rs.map(deserializeSelection),
        // revVisibleRange: deserializeRange(e.rv),
      };
    case 7:
      return {
        type: 'scroll',
        id: nextId(),
        uri,
        clock: deserializeClock(e.c),
        visibleRange: deserializeLineRange(e.v),
        revVisibleRange: deserializeLineRange(e.rv),
      };
    case 8:
      return {
        type: 'save',
        id: nextId(),
        uri,
        clock: deserializeClock(e.c),
      };
    case 9:
      return {
        type: 'textInsert',
        id: nextId(),
        uri,
        clock: deserializeClock(e.c),
        text: e.x,
        revRange: deserializeRange(e.r),
        updateSelection: e.u ?? true,
        // wasDirty: true,
      };
  }
}

function deserializeFileV1(f: t.BodyFormatV1.File): t.File {
  switch (f.type) {
    case 'empty':
      throw new Error('file of type empty is no longer supported in session body');
    case 'dir':
    case 'git':
      return f;
    case 'local':
      return { type: 'blob', sha1: f.sha1 };
  }
}

function deserializeContentChange(cc: t.ContentChangeCompact): t.ContentChange {
  return { text: cc.t, range: deserializeRange(cc.r) };
}

function deserializeRange(r: t.RangeCompact): t.Range {
  return { start: { line: r[0], character: r[1] }, end: { line: r[2], character: r[3] } };
}

function deserializeLineRange(r: t.LineRangeCompact): t.LineRange {
  return { start: r[0], end: r[1] };
}

function deserializeSelection(r: t.SelectionCompact): t.Selection {
  return { anchor: { line: r[0], character: r[1] }, active: { line: r[2], character: r[3] } };
}

function deserializeClock(clock: number): number {
  return clock / 10;
}

function deserializeClockRange(r: t.ClockRangeCompact): t.ClockRange {
  return { start: deserializeClock(r[0]), end: deserializeClock(r[1]) };
}

function deserializeFocus(focus: t.FocusCompact, uris: string[]): t.Focus {
  return {
    clock: deserializeClock(focus.c),
    uri: uris[focus.u],
    line: focus.n,
    text: focus.t,
  };
}

function deserializeFocusV1(focus: t.BodyFormatV1.FocusCompact): t.Focus {
  return {
    clock: deserializeClock(focus.c),
    uri: focus.u,
    line: focus.n,
    text: focus.t,
  };
}

function deserializeAudioTrackV1(track: t.BodyFormatV1.AudioTrack): t.AudioTrack {
  return { ...track, file: deserializeFileV1(track.file) };
}
function deserializeVideoTrackV1(track: t.BodyFormatV1.VideoTrack): t.VideoTrack {
  return { ...track, file: deserializeFileV1(track.file) };
}

export function deserializeTestMeta(compact: t.TestMetaCompact): t.TestMeta {
  return {
    dirtyTextDocuments: compact.dirtyTextDocuments,
    openTextEditors: compact.openTextEditors.map(e => ({
      uri: e.uri,
      selections: e.selections.map(deserializeSelection),
      visibleRange: deserializeLineRange(e.visibleRange),
    })),
    activeTextEditor: compact.activeTextEditor,
    languageIds: compact.languageIds,
  };
}
