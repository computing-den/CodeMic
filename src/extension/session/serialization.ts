import * as t from '../../lib/types.js';
import _ from 'lodash';

export function serializeSessionBodyJSON(body: t.SessionBodyJSON): t.SessionBodyCompact {
  return {
    audioTracks: body.audioTracks,
    videoTracks: body.videoTracks,
    internalWorkspace: {
      editorTracks: _.mapValues(body.internalWorkspace.editorTracks, t => t.map(serializeEditorEvent)),
      defaultEol: body.internalWorkspace.defaultEol,
      focusTimeline: body.internalWorkspace.focusTimeline,
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
        s: e.selections.map(serializeSelection),
        v: serializeRange(e.visibleRange),
        ru: e.revUri,
        rs: e.revSelections?.map(serializeSelection),
        rv: e.revVisibleRange && serializeRange(e.revVisibleRange),
      };

    case 'closeTextEditor':
      return {
        t: 5,
        c: serializeClock(e.clock),
        rs: e.revSelections?.map(serializeSelection),
        rv: e.revVisibleRange && serializeRange(e.revVisibleRange),
      };
    case 'select':
      return {
        t: 6,
        c: serializeClock(e.clock),
        s: e.selections.map(serializeSelection),
        v: serializeRange(e.visibleRange),
        rs: e.revSelections?.map(serializeSelection),
        rv: e.revVisibleRange && serializeRange(e.revVisibleRange),
      };

    case 'scroll':
      return {
        t: 7,
        c: serializeClock(e.clock),
        v: serializeRange(e.visibleRange),
        rv: e.revVisibleRange && serializeRange(e.revVisibleRange),
      };

    case 'save':
      return {
        t: 8,
        c: serializeClock(e.clock),
      };
  }
}

function serializeContentChange(cc: t.ContentChange): t.ContentChangeCompact {
  return { t: cc.text, r: serializeRange(cc.range) };
}

function serializeRange(r: t.Range): t.RangeCompact {
  return [r.start.line, r.start.character, r.end.line, r.end.character];
}

function serializeSelection(r: t.Selection): t.SelectionCompact {
  return [r.anchor.line, r.anchor.character, r.active.line, r.active.character];
}

function serializeClock(clock: number): number {
  return Math.floor(clock * 1000);
}

export function deserializeSessionBody(compact: t.SessionBodyCompact): t.SessionBodyJSON {
  return {
    audioTracks: compact.audioTracks,
    videoTracks: compact.videoTracks,
    internalWorkspace: {
      editorTracks: _.mapValues(compact.internalWorkspace.editorTracks, t => t.map(deserializeEditorEvent)),
      defaultEol: compact.internalWorkspace.defaultEol,
      focusTimeline: compact.internalWorkspace.focusTimeline,
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
        selections: e.s.map(deserializeSelection),
        visibleRange: deserializeRange(e.v),
        revUri: e.ru,
        revSelections: e.rs?.map(deserializeSelection),
        revVisibleRange: e.rv && deserializeRange(e.rv),
      };
    case 5:
      return {
        type: 'closeTextEditor',
        clock: deserializeClock(e.c),
        revSelections: e.rs?.map(deserializeSelection),
        revVisibleRange: e.rv && deserializeRange(e.rv),
      };
    case 6:
      return {
        type: 'select',
        clock: deserializeClock(e.c),
        selections: e.s.map(deserializeSelection),
        visibleRange: deserializeRange(e.v),
        revSelections: e.rs.map(deserializeSelection),
        revVisibleRange: deserializeRange(e.rv),
      };
    case 7:
      return {
        type: 'scroll',
        clock: deserializeClock(e.c),
        visibleRange: deserializeRange(e.v),
        revVisibleRange: deserializeRange(e.rv),
      };
    case 8:
      return {
        type: 'save',
        clock: deserializeClock(e.c),
      };
  }
}

function deserializeContentChange(cc: t.ContentChangeCompact): t.ContentChange {
  return new t.ContentChange(cc.t, deserializeRange(cc.r));
}

function deserializeRange(r: t.RangeCompact): t.Range {
  return new t.Range(new t.Position(r[0], r[1]), new t.Position(r[2], r[3]));
}

function deserializeSelection(r: t.SelectionCompact): t.Selection {
  return new t.Selection(new t.Position(r[0], r[1]), new t.Position(r[2], r[3]));
}

function deserializeClock(clock: number): number {
  return clock / 1000;
}
