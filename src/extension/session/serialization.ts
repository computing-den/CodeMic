import * as t from '../../lib/types.js';

export function serializeSessionBody(body: t.SessionBody): t.SessionBodyCompact {
  return {
    audioTracks: body.audioTracks,
    videoTracks: body.videoTracks,
    editorTrack: {
      initSnapshot: body.editorTrack.initSnapshot,
      events: body.editorTrack.events.map(serializeEditorEvent),
      defaultEol: body.editorTrack.defaultEol,
      focusTimeline: body.editorTrack.focusTimeline,
    },
  };
}

function serializeEditorEvent(e: t.EditorEvent): t.EditorEventCompact {
  switch (e.type) {
    case 'textChange':
      return {
        t: 1,
        c: e.clock,
        u: e.uri,
        cc: e.contentChanges.map(serializeContentChange),
        rcc: e.revContentChanges.map(serializeContentChange),
      };
    case 'openTextDocument':
      return {
        t: 2,
        c: e.clock,
        u: e.uri,
        x: e.text,
        e: e.eol,
        i: e.isInWorktree,
      };

    case 'closeTextDocument':
      return {
        t: 3,
        c: e.clock,
        u: e.uri,
        rt: e.revText,
        re: e.revEol,
      };

    case 'showTextEditor':
      return {
        t: 4,
        c: e.clock,
        u: e.uri,
        s: e.selections.map(serializeSelection),
        v: serializeRange(e.visibleRange),
        ru: e.revUri,
        rs: e.revSelections?.map(serializeSelection),
        rv: e.revVisibleRange && serializeRange(e.revVisibleRange),
      };

    case 'closeTextEditor':
      return {
        t: 5,
        c: e.clock,
        u: e.uri,
        rs: e.revSelections?.map(serializeSelection),
        rv: e.revVisibleRange && serializeRange(e.revVisibleRange),
      };
    case 'select':
      return {
        t: 6,
        c: e.clock,
        u: e.uri,
        s: e.selections.map(serializeSelection),
        v: serializeRange(e.visibleRange),
        rs: e.revSelections?.map(serializeSelection),
        rv: e.revVisibleRange && serializeRange(e.revVisibleRange),
      };

    case 'scroll':
      return {
        t: 7,
        c: e.clock,
        u: e.uri,
        v: serializeRange(e.visibleRange),
        rv: e.revVisibleRange && serializeRange(e.revVisibleRange),
      };

    case 'save':
      return {
        t: 8,
        c: e.clock,
        u: e.uri,
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

export function deserializeSessionBody(compact: t.SessionBodyCompact): t.SessionBody {
  return {
    audioTracks: compact.audioTracks,
    videoTracks: compact.videoTracks,
    editorTrack: {
      defaultEol: compact.editorTrack.defaultEol,
      focusTimeline: compact.editorTrack.focusTimeline,
      initSnapshot: {
        worktree: compact.editorTrack.initSnapshot.worktree,
        activeTextEditorUri: compact.editorTrack.initSnapshot.activeTextEditorUri,
        textEditors: compact.editorTrack.initSnapshot.textEditors.map(x => ({
          selections: x.selections.map(
            s =>
              new t.Selection(
                new t.Position(s.anchor.line, s.anchor.character),
                new t.Position(s.active.line, s.active.character),
              ),
          ),
          uri: x.uri,
          visibleRange: new t.Range(x.visibleRange.start, x.visibleRange.end),
        })),
      },
      events: compact.editorTrack.events.map(deserializeEditorEvent),
    },
  };
}

function deserializeEditorEvent(e: t.EditorEventCompact): t.EditorEvent {
  switch (e.t) {
    case 1:
      return {
        type: 'textChange',
        clock: e.c,
        uri: e.u,
        contentChanges: e.cc.map(deserializeContentChange),
        revContentChanges: e.rcc.map(deserializeContentChange),
      };
    case 2:
      return {
        type: 'openTextDocument',
        clock: e.c,
        uri: e.u,
        text: e.x,
        eol: e.e,
        isInWorktree: e.i,
      };
    case 3:
      return {
        type: 'closeTextDocument',
        clock: e.c,
        uri: e.u,
        revText: e.rt,
        revEol: e.re,
      };
    case 4:
      return {
        type: 'showTextEditor',
        clock: e.c,
        uri: e.u,
        selections: e.s.map(deserializeSelection),
        visibleRange: deserializeRange(e.v),
        revUri: e.ru,
        revSelections: e.rs?.map(deserializeSelection),
        revVisibleRange: e.rv && deserializeRange(e.rv),
      };
    case 5:
      return {
        type: 'closeTextEditor',
        clock: e.c,
        uri: e.u,
        revSelections: e.rs?.map(deserializeSelection),
        revVisibleRange: e.rv && deserializeRange(e.rv),
      };
    case 6:
      return {
        type: 'select',
        clock: e.c,
        uri: e.u,
        selections: e.s.map(deserializeSelection),
        visibleRange: deserializeRange(e.v),
        revSelections: e.rs.map(deserializeSelection),
        revVisibleRange: deserializeRange(e.rv),
      };
    case 7:
      return {
        type: 'scroll',
        clock: e.c,
        uri: e.u,
        visibleRange: deserializeRange(e.v),
        revVisibleRange: deserializeRange(e.rv),
      };
    case 8:
      return {
        type: 'save',
        clock: e.c,
        uri: e.u,
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

/**
 * Only used for converting the old session bodies.
 * TODO delete this later.
 */
export function deserializeOldSessionBody(json: any): t.SessionBody {
  return {
    audioTracks: json.audioTracks,
    videoTracks: json.videoTracks,
    editorTrack: {
      defaultEol: json.editorTrack.defaultEol,
      focusTimeline: json.editorTrack.focusTimeline,
      initSnapshot: {
        worktree: json.editorTrack.initSnapshot.worktree,
        activeTextEditorUri: json.editorTrack.initSnapshot.activeTextEditorUri,
        textEditors: json.editorTrack.initSnapshot.textEditors.map(x => ({
          selections: x.selections.map(
            (s: any) =>
              new t.Selection(
                new t.Position(s.anchor.line, s.anchor.character),
                new t.Position(s.active.line, s.active.character),
              ),
          ),
          uri: x.uri,
          visibleRange: new t.Range(x.visibleRange.start, x.visibleRange.end),
        })),
      },
      events: json.editorTrack.events.map((e: any) => {
        switch (e.type) {
          case 'textChange':
            return {
              ...e,
              contentChanges: e.contentChanges.map(
                (cc: any) => new t.ContentChange(cc.text, new t.Range(cc.range.start, cc.range.end)),
              ),
              revContentChanges: e.revContentChanges.map(
                (cc: any) => new t.ContentChange(cc.text, new t.Range(cc.range.start, cc.range.end)),
              ),
            };
          case 'openTextDocument':
          case 'closeTextDocument':
            return e;
          case 'showTextEditor':
            return {
              ...e,
              selections: e.selections.map(
                (s: any) =>
                  new t.Selection(
                    new t.Position(s.anchor.line, s.anchor.character),
                    new t.Position(s.active.line, s.active.character),
                  ),
              ),
              visibleRange: new t.Range(e.visibleRange.start, e.visibleRange.end),
              revSelections:
                e.revSelections &&
                e.revSelections.map(
                  (s: any) =>
                    new t.Selection(
                      new t.Position(s.anchor.line, s.anchor.character),
                      new t.Position(s.active.line, s.active.character),
                    ),
                ),
              revVisibleRange: e.revVisibleRange && new t.Range(e.revVisibleRange.start, e.revVisibleRange.end),
            };
          case 'closeTextEditor':
            return {
              ...e,
              revSelections:
                e.revSelections &&
                e.revSelections.map(
                  (s: any) =>
                    new t.Selection(
                      new t.Position(s.anchor.line, s.anchor.character),
                      new t.Position(s.active.line, s.active.character),
                    ),
                ),
              revVisibleRange: e.revVisibleRange && new t.Range(e.revVisibleRange.start, e.revVisibleRange.end),
            };
          case 'select':
            return {
              ...e,
              selections: e.selections.map(
                (s: any) =>
                  new t.Selection(
                    new t.Position(s.anchor.line, s.anchor.character),
                    new t.Position(s.active.line, s.active.character),
                  ),
              ),
              visibleRange: new t.Range(e.visibleRange.start, e.visibleRange.end),
              revSelections:
                e.revSelections &&
                e.revSelections.map(
                  (s: any) =>
                    new t.Selection(
                      new t.Position(s.anchor.line, s.anchor.character),
                      new t.Position(s.active.line, s.active.character),
                    ),
                ),
              revVisibleRange: e.revVisibleRange && new t.Range(e.revVisibleRange.start, e.revVisibleRange.end),
            };
          case 'scroll':
            return {
              ...e,
              visibleRange: new t.Range(e.visibleRange.start, e.visibleRange.end),
              revVisibleRange: e.revVisibleRange && new t.Range(e.revVisibleRange.start, e.revVisibleRange.end),
            };
          case 'save':
            return e;
        }
      }),
    },
  };
}
