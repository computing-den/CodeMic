import _ from 'lodash';
import * as t from '../../lib/types.js';

export function isPositionBefore(a: t.Position, b: t.Position): boolean {
  return a.line < b.line || (a.line === b.line && a.character < b.character);
}

export function isPositionAfter(a: t.Position, b: t.Position): boolean {
  return a.line > b.line || (a.line === b.line && a.character > b.character);
}

export function isPositionEqual(a: t.Position, b: t.Position): boolean {
  return a.line === b.line && a.character === b.character;
}

export function isRangeNonOverlapping(a: t.Range, b: t.Range): boolean {
  return (
    isPositionBefore(a.end, b.start) ||
    isPositionEqual(a.end, b.start) ||
    isPositionAfter(a.start, b.end) ||
    isPositionEqual(a.start, b.end)
  );
}

export function isRangeOverlapping(a: t.Range, b: t.Range): boolean {
  return !isRangeNonOverlapping(a, b);
}

export function compareContentChanges(a: t.ContentChange, b: t.ContentChange): number {
  return compareRange(a.range, b.range);
}

export function compareRange(a: t.Range, b: t.Range): number {
  const lineDelta = a.start.line - b.start.line;
  if (lineDelta !== 0) return lineDelta;

  return a.start.character - b.start.character;
}

export function copyRange(range: t.Range): t.Range {
  return makeRange(copyPosition(range.start), copyPosition(range.end));
}

export function makePosition(line: number, character: number): t.Position {
  return { line, character };
}

export function copyPosition(position: t.Position): t.Position {
  return { line: position.line, character: position.character };
}

export function makeRange(start: t.Position, end: t.Position): t.Range {
  return { start, end };
}

export function makeRangeN(startLine: number, startCharacter: number, endLine: number, endCharacter: number): t.Range {
  return { start: makePosition(startLine, startCharacter), end: makePosition(endLine, endCharacter) };
}

export function getRangeLineCount(range: t.Range): number {
  return range.end.line - range.start.line;
}

export function makeSelection(anchor: t.Position, active: t.Position): t.Selection {
  return { anchor, active };
}

export function makeSelectionN(
  anchorLine: number,
  anchorCharacter: number,
  activeLine: number,
  activeCharacter: number,
): t.Selection {
  return { anchor: makePosition(anchorLine, anchorCharacter), active: makePosition(activeLine, activeCharacter) };
}

export function getSelectionStart(selection: t.Selection): t.Position {
  return isPositionBefore(selection.anchor, selection.active) ? selection.anchor : selection.active;
}

export function getSelectionEnd(selection: t.Selection): t.Position {
  return isPositionAfter(selection.anchor, selection.active) ? selection.anchor : selection.active;
}

export function makeContentChange(text: string, range: t.Range): t.ContentChange {
  return { text, range };
}

// export function makeEmptySnapshot(): t.InternalEditorTrackSnapshot {
//   return {
//     worktree: {},
//     textEditors: [],
//   };
// }

// export function makeEmptyEditorTrackJSON(defaultEol: t.EndOfLine): t.InternalWorkspace {
//   return {
//     events: [],
//     defaultEol,
//     initSnapshot: makeEmptySnapshot(),
//   };
// }

export function makeTextEditorSnapshot(
  uri: t.Uri,
  selections: t.Selection[] = [makeSelectionN(0, 0, 0, 0)],
  visibleRange: t.Range = makeRangeN(0, 0, 1, 0),
): t.TextEditor {
  return { uri, selections, visibleRange };
}
