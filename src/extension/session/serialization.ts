import * as t from '../../lib/types.js';
import { Range, LineRange, Selection, ContentChange, Position, nextId } from '../../lib/lib.js';
import _ from 'lodash';

type UriMap = Map<string, number>;

export function serializeSessionBody(body: t.SessionBody): t.SessionBodyCompact {
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
    case 'store':
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
      };
    case 'openTextDocument':
      return {
        t: 2,
        u: uriMap.get(e.uri)!,
        c: serializeClock(e.clock),
        x: e.text,
        e: e.eol,
        i: e.isInWorktree,
      };

    case 'closeTextDocument':
      return {
        t: 3,
        u: uriMap.get(e.uri)!,
        c: serializeClock(e.clock),
        rt: e.revText,
        re: e.revEol,
      };

    case 'showTextEditor':
      return {
        t: 4,
        u: uriMap.get(e.uri)!,
        c: serializeClock(e.clock),
        p: e.preserveFocus ? true : undefined,
        s: e.selections?.map(serializeSelection),
        v: e.visibleRange && serializeLineRange(e.visibleRange),
        ru: e.revUri,
        rs: e.revSelections?.map(serializeSelection),
        rv: e.revVisibleRange && serializeLineRange(e.revVisibleRange),
      };

    case 'closeTextEditor':
      return {
        t: 5,
        u: uriMap.get(e.uri)!,
        c: serializeClock(e.clock),
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
      };
  }
}

function serializeContentChange(cc: ContentChange): t.ContentChangeCompact {
  return { t: cc.text, r: serializeRange(cc.range) };
}

function serializeRange(r: Range): t.RangeCompact {
  return [r.start.line, r.start.character, r.end.line, r.end.character];
}

function serializeLineRange(r: LineRange): t.LineRangeCompact {
  return [r.start, r.end];
}

function serializeSelection(r: Selection): t.SelectionCompact {
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
    n: focus.number,
  };
}

export function deserializeSessionBody(compact: any, formatVersion: number): t.SessionBody {
  switch (formatVersion) {
    case 1:
      return deserializeSessionBodyV1(compact as t.BodyFormatV1.SessionBodyCompact);
    case 2:
      return deserializeSessionBodyV2(compact as t.SessionBodyCompact);
    default:
      throw new Error(`Unknown format version ${formatVersion}`);
  }
}

export function deserializeSessionBodyV1(compact: t.BodyFormatV1.SessionBodyCompact): t.SessionBody {
  let editorEvents = _.flatMap(compact.editorTracks, (t, uri) => _.map(t, e => deserializeEditorEventV1(e, uri)));
  editorEvents = _.orderBy(editorEvents, 'clock');
  return {
    editorEvents,
    audioTracks: compact.audioTracks,
    videoTracks: compact.videoTracks,
    defaultEol: compact.defaultEol,
    focusTimeline: compact.focusTimeline.map(f => deserializeFocusV1(f)),
  };
}

export function deserializeSessionBodyV2(compact: t.SessionBodyCompact): t.SessionBody {
  return {
    editorEvents: _.map(compact.editorEvents, t => deserializeEditorEvent(t, compact.uris)),
    audioTracks: compact.audioTracks,
    videoTracks: compact.videoTracks,
    defaultEol: compact.defaultEol,
    focusTimeline: compact.focusTimeline.map(f => deserializeFocus(f, compact.uris)),
  };
}

function deserializeEditorEvent(e: t.EditorEventCompact, uris: string[]): t.EditorEvent {
  switch (e.t) {
    case 0:
      return {
        type: 'store',
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
      };
    case 2:
      return {
        type: 'openTextDocument',
        id: nextId(),
        uri: uris[e.u],
        clock: deserializeClock(e.c),
        text: e.x,
        eol: e.e,
        isInWorktree: e.i,
      };
    case 3:
      return {
        type: 'closeTextDocument',
        id: nextId(),
        uri: uris[e.u],
        clock: deserializeClock(e.c),
        revText: e.rt,
        revEol: e.re,
      };
    case 4:
      return {
        type: 'showTextEditor',
        id: nextId(),
        uri: uris[e.u],
        clock: deserializeClock(e.c),
        preserveFocus: e.p ?? false,
        selections: e.s?.map(deserializeSelection),
        visibleRange: e.v && deserializeLineRange(e.v),
        revUri: e.ru,
        revSelections: e.rs?.map(deserializeSelection),
        revVisibleRange: e.rv && deserializeLineRange(e.rv),
      };
    case 5:
      return {
        type: 'closeTextEditor',
        id: nextId(),
        uri: uris[e.u],
        clock: deserializeClock(e.c),
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
      };
  }
}

function deserializeEditorEventV1(e: t.BodyFormatV1.EditorEventCompact, uri: string): t.EditorEvent {
  switch (e.t) {
    case 0:
      return {
        type: 'store',
        id: nextId(),
        uri,
        clock: deserializeClock(e.c),
        file: e.f,
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
      };
    case 2:
      return {
        type: 'openTextDocument',
        id: nextId(),
        uri,
        clock: deserializeClock(e.c),
        text: e.x,
        eol: e.e,
        isInWorktree: e.i,
      };
    case 3:
      return {
        type: 'closeTextDocument',
        id: nextId(),
        uri,
        clock: deserializeClock(e.c),
        revText: e.rt,
        revEol: e.re,
      };
    case 4:
      return {
        type: 'showTextEditor',
        id: nextId(),
        uri,
        clock: deserializeClock(e.c),
        preserveFocus: e.p ?? false,
        selections: e.s?.map(deserializeSelection),
        visibleRange: e.v && deserializeLineRange(e.v),
        revUri: e.ru,
        revSelections: e.rs?.map(deserializeSelection),
        revVisibleRange: e.rv && deserializeLineRange(e.rv),
      };
    case 5:
      return {
        type: 'closeTextEditor',
        id: nextId(),
        uri,
        clock: deserializeClock(e.c),
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
      };
  }
}

function deserializeContentChange(cc: t.ContentChangeCompact): ContentChange {
  return new ContentChange(cc.t, deserializeRange(cc.r));
}

function deserializeRange(r: t.RangeCompact): Range {
  return new Range(new Position(r[0], r[1]), new Position(r[2], r[3]));
}

function deserializeLineRange(r: t.LineRangeCompact): LineRange {
  return new LineRange(r[0], r[1]);
}

function deserializeSelection(r: t.SelectionCompact): Selection {
  return new Selection(new Position(r[0], r[1]), new Position(r[2], r[3]));
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
    number: focus.n,
    text: focus.t,
  };
}

function deserializeFocusV1(focus: t.BodyFormatV1.FocusCompact): t.Focus {
  return {
    clock: deserializeClock(focus.c),
    uri: focus.u,
    number: focus.n,
    text: focus.t,
  };
}
