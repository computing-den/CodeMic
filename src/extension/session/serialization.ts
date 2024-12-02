import * as t from '../../lib/types.js';
import { Range, LineRange, Selection, ContentChange, Position } from '../../lib/lib.js';
import _ from 'lodash';

export function serializeSessionBodyJSON(body: t.SessionBodyJSON): t.SessionBodyCompact {
  return {
    audioTracks: body.audioTracks,
    videoTracks: body.videoTracks,
    editorTracks: _.mapValues(body.editorTracks, t => t.map(serializeEditorEvent)),
    defaultEol: body.defaultEol,
    focusTimeline: {
      documents: body.focusTimeline.documents.map(serializeDocumentFocus),
      lines: body.focusTimeline.lines.map(serializeLineFocus),
    },
  };
}

function serializeEditorEvent(e: t.EditorEvent): t.EditorEventCompact {
  switch (e.type) {
    case 'init':
      return {
        t: 0,
        c: serializeClock(e.clock),
        f: e.file,
      };
    case 'textChange':
      return {
        t: 1,
        c: serializeClock(e.clock),
        cc: e.contentChanges.map(serializeContentChange),
        rcc: e.revContentChanges.map(serializeContentChange),
        u: e.updateSelection ? undefined : false,
      };
    case 'openTextDocument':
      return {
        t: 2,
        c: serializeClock(e.clock),
        x: e.text,
        e: e.eol,
        i: e.isInWorktree,
      };

    case 'closeTextDocument':
      return {
        t: 3,
        c: serializeClock(e.clock),
        rt: e.revText,
        re: e.revEol,
      };

    case 'showTextEditor':
      return {
        t: 4,
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
        c: serializeClock(e.clock),
        rs: e.revSelections?.map(serializeSelection),
        rv: e.revVisibleRange && serializeLineRange(e.revVisibleRange),
      };
    case 'select':
      return {
        t: 6,
        c: serializeClock(e.clock),
        s: e.selections.map(serializeSelection),
        // v: serializeRange(e.visibleRange),
        rs: e.revSelections?.map(serializeSelection),
        // rv: e.revVisibleRange && serializeRange(e.revVisibleRange),
      };

    case 'scroll':
      return {
        t: 7,
        c: serializeClock(e.clock),
        v: serializeLineRange(e.visibleRange),
        rv: e.revVisibleRange && serializeLineRange(e.revVisibleRange),
      };

    case 'save':
      return {
        t: 8,
        c: serializeClock(e.clock),
      };
    case 'textInsert':
      return {
        t: 9,
        c: serializeClock(e.clock),
        x: e.text,
        r: serializeRange(e.revRange),
        u: e.updateSelection ? undefined : false,
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

function serializeClockRange(cr: t.ClockRange): t.ClockRangeCompact {
  return [serializeClock(cr.start), serializeClock(cr.end)];
}

function serializeDocumentFocus(focus: t.DocumentFocus): t.DocumentFocusCompact {
  return {
    cr: serializeClockRange(focus.clockRange),
    u: focus.uri,
  };
}

function serializeLineFocus(focus: t.LineFocus): t.LineFocusCompact {
  return {
    cr: serializeClockRange(focus.clockRange),
    t: focus.text,
  };
}

export function deserializeSessionBody(compact: t.SessionBodyCompact): t.SessionBodyJSON {
  return {
    audioTracks: compact.audioTracks,
    videoTracks: compact.videoTracks,
    editorTracks: _.mapValues(compact.editorTracks, t => t.map(deserializeEditorEvent)),
    defaultEol: compact.defaultEol,
    focusTimeline: {
      documents: compact.focusTimeline.documents.map(deserializeDocumentFocus),
      lines: compact.focusTimeline.lines.map(deserializeLineFocus),
    },
  };
}

function deserializeEditorEvent(e: t.EditorEventCompact): t.EditorEvent {
  switch (e.t) {
    case 0:
      return {
        type: 'init',
        clock: deserializeClock(e.c),
        file: e.f,
      };
    case 1:
      return {
        type: 'textChange',
        clock: deserializeClock(e.c),
        contentChanges: e.cc.map(deserializeContentChange),
        revContentChanges: e.rcc.map(deserializeContentChange),
        updateSelection: e.u ?? true,
      };
    case 2:
      return {
        type: 'openTextDocument',
        clock: deserializeClock(e.c),
        text: e.x,
        eol: e.e,
        isInWorktree: e.i,
      };
    case 3:
      return {
        type: 'closeTextDocument',
        clock: deserializeClock(e.c),
        revText: e.rt,
        revEol: e.re,
      };
    case 4:
      return {
        type: 'showTextEditor',
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
        clock: deserializeClock(e.c),
        revSelections: e.rs?.map(deserializeSelection),
        revVisibleRange: e.rv && deserializeLineRange(e.rv),
      };
    case 6:
      return {
        type: 'select',
        clock: deserializeClock(e.c),
        selections: e.s.map(deserializeSelection),
        // visibleRange: deserializeRange(e.v),
        revSelections: e.rs.map(deserializeSelection),
        // revVisibleRange: deserializeRange(e.rv),
      };
    case 7:
      return {
        type: 'scroll',
        clock: deserializeClock(e.c),
        visibleRange: deserializeLineRange(e.v),
        revVisibleRange: deserializeLineRange(e.rv),
      };
    case 8:
      return {
        type: 'save',
        clock: deserializeClock(e.c),
      };
    case 9:
      return {
        type: 'textInsert',
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

function deserializeClockRange(cr: t.ClockRangeCompact): t.ClockRange {
  return { start: deserializeClock(cr[0]), end: deserializeClock(cr[1]) };
}

function deserializeDocumentFocus(focus: t.DocumentFocusCompact): t.DocumentFocus {
  return {
    clockRange: deserializeClockRange(focus.cr),
    uri: focus.u,
  };
}

function deserializeLineFocus(focus: t.LineFocusCompact): t.LineFocus {
  return {
    clockRange: deserializeClockRange(focus.cr),
    text: focus.t,
  };
}
