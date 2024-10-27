import _ from 'lodash';
import * as t from '../../lib/types.js';
import * as path from '../../lib/path.js';
import assert from '../../lib/assert.js';
import workspaceStepperDispatch from './workspace_stepper_dispatch.js';

// Not every TextDocument may be attached to a TextEditor. At least not until the
// TextEditor is opened.
export class InternalEditorTrackCtrl implements t.WorkspaceStepper {
  // These fields change with the clock/eventIndex
  // TODO sync the entire worktree structure including directories.
  // If a TextDocument is in this.textDocuments, it is also in this.worktree.
  // If a TextEditor is in this.textEditors, it is also in this.worktree.
  eventIndex: number;
  worktree: LiveWorktree;
  textDocuments: TextDocument[];
  textEditors: TextEditor[];
  activeTextEditor?: TextEditor;

  private constructor(public session: t.Session) {
    this.eventIndex = -1;
    this.worktree = new Map();
    this.textDocuments = [];
    this.textEditors = [];
  }

  get editorTrack(): t.InternalEditorTrack {
    return this.session.body!.editorTrack;
  }

  static async fromSession(session: t.Session): Promise<InternalEditorTrackCtrl> {
    const track = new InternalEditorTrackCtrl(session);
    await track.restoreInitSnapshot();
    return track;
  }

  async restoreInitSnapshot() {
    this.eventIndex = -1;
    this.worktree = makeLiveWorktree(this.editorTrack.initSnapshot.worktree);
    this.textDocuments = [];
    this.textEditors = [];

    for (const textEditor of this.editorTrack.initSnapshot.textEditors) {
      await this.openTextEditorByUri(textEditor.uri, textEditor.selections, textEditor.visibleRange);
    }

    if (this.editorTrack.initSnapshot.activeTextEditorUri) {
      this.activeTextEditor = this.findTextEditorByUri(this.editorTrack.initSnapshot.activeTextEditorUri);
    }
  }

  doesUriExist(uri: t.Uri): boolean {
    return Boolean(this.worktree.get(uri));
  }

  getWorktreeUris(): t.Uri[] {
    return Array.from(this.worktree.keys());
  }

  async getContentByUri(uri: t.Uri): Promise<Uint8Array> {
    const item = this.worktree.get(uri);
    assert(item);

    if (item.document) {
      return item.document.getContent();
    }

    if (item.file.type === 'local') {
      return this.session.readFile(item.file);
    }

    if (item.file.type === 'empty') {
      return new Uint8Array();
    }

    throw new Error(`getContentByUri ${uri} type "${item.file}" not supported`);
  }

  findTextDocumentByUri(uri: t.Uri): TextDocument | undefined {
    const textDocument = this.worktree.get(uri)?.document;
    return textDocument instanceof TextDocument ? textDocument : undefined;
  }

  findTextEditorByUri(uri: t.Uri): TextEditor | undefined {
    const textEditor = this.worktree.get(uri)?.editor;
    return textEditor instanceof TextEditor ? textEditor : undefined;
  }

  getTextDocumentByUri(uri: t.Uri): TextDocument {
    const textDocument = this.findTextDocumentByUri(uri);
    assert(textDocument);
    return textDocument;
  }

  getTextEditorByUri(uri: t.Uri): TextEditor {
    const textEditor = this.findTextEditorByUri(uri);
    assert(textEditor);
    return textEditor;
  }

  async openTextDocumentByUri(uri: t.Uri): Promise<TextDocument> {
    const worktreeItem = this.worktree.get(uri);
    if (!worktreeItem) throw new Error(`file not found ${uri}`);

    if (worktreeItem.document) {
      if (!(worktreeItem.document instanceof TextDocument)) {
        throw new Error(`file is not a text document ${uri}`);
      }
      return worktreeItem.document;
    }

    const text = new TextDecoder().decode(await this.session.readFile(worktreeItem.file));
    const textDocument = TextDocument.fromText(uri, text, this.editorTrack.defaultEol);
    this.insertTextDocument(textDocument);
    return textDocument;
  }

  insertTextDocument(textDocument: TextDocument) {
    const item = this.worktree.get(textDocument.uri) ?? { file: { type: 'empty' } };
    item.document = textDocument;
    this.worktree.set(textDocument.uri, item);
    this.textDocuments.push(textDocument);
  }

  async openTextEditorByUri(uri: t.Uri, selections?: t.Selection[], visibleRange?: t.Range): Promise<TextEditor> {
    const worktreeItem = this.worktree.get(uri);
    if (!worktreeItem) throw new Error(`file not found ${uri}`);

    if (worktreeItem.editor) {
      if (!(worktreeItem.editor instanceof TextEditor)) {
        throw new Error(`file is not a text document ${uri}`);
      }
      if (selections && visibleRange) {
        worktreeItem.editor.select(selections, visibleRange);
      }
      return worktreeItem.editor;
    }

    const textEditor = new TextEditor(await this.openTextDocumentByUri(uri), selections, visibleRange);
    this.insertTextEditor(textEditor);
    return textEditor;
  }

  insertTextEditor(textEditor: TextEditor) {
    const item = this.worktree.get(textEditor.document.uri) ?? {
      file: { type: 'empty' },
      document: textEditor.document,
    };
    item.editor = textEditor;
    this.worktree.set(textEditor.document.uri, item);
    this.textEditors.push(textEditor);
  }

  toWorkspaceUri(p: t.AbsPath): t.Uri {
    return path.workspaceUriFromAbsPath(this.session.workspace, p);
  }

  closeAndRemoveTextDocumentByUri(uri: t.Uri) {
    this.closeTextEditorByUri(uri);
    this.textDocuments = this.textDocuments.filter(x => x.uri !== uri);
    this.worktree.delete(uri);
  }

  closeTextEditorByUri(uri: t.Uri) {
    if (this.worktree.get(uri)?.editor) {
      this.worktree.get(uri)!.editor = undefined;
      this.textEditors = this.textEditors.filter(x => x.document.uri !== uri);
    }
    if (this.activeTextEditor?.document.uri === uri) {
      this.activeTextEditor = undefined;
    }
  }

  /**
   * Returns 0 for i === -1. Otherwise, i must be in range.
   */
  clockAt(i: number): number {
    return i < 0 ? 0 : this.eventAt(i).clock;
  }

  private eventAt(i: number): t.EditorEvent {
    assert(i >= 0 && i < this.editorTrack.events.length, 'out of bound event index');
    return this.editorTrack.events[i];
  }

  getSeekData(toClock: number): t.SeekData {
    // FORWARD

    // events/clock:        -1  0  1  2  3  4  5  6
    // clock:                   ^
    // i:                    ^
    // apply:                   ^
    // new i:                   ^

    // events/clock:        -1  0  1  2  3  4  5  6
    // clock:                          ^
    // i:                       ^
    // apply:                      ^  ^
    // new i:                         ^

    // events/clock:        -1  0  1  2  3  4  5  6
    // clock:                            ^
    // i:                                ^
    // apply:
    // new i:                            ^

    // events/clock:        -1  0  1  2  3  4  5  6
    // clock:                             ^
    // i:                                ^
    // apply:
    // new i:                            ^

    // events/clock:        -1  0  1  2  3  4  5  6
    // clock:                                     ^
    // i:                                         ^
    // apply:
    // new i:                                     ^

    // BACKWARD

    // events/clock:        -1  0  1  2  3  4  5  6
    // clock:                                   ^
    // i:                                         ^
    // apply reverse:                             ^
    // new i:                                  ^

    // events/clock:        -1  0  1  2  3  4  5  6
    // clock:                                  ^
    // i:                                      ^
    // apply reverse:
    // new i:                                  ^

    // events/clock:        -1  0  1  2  3  4  5  6
    // clock:                            ^
    // i:                                      ^
    // apply reverse:                       ^  ^
    // new i:                            ^

    // events/clock:        -1  0  1  2  3  4  5  6
    // clock:                   ^
    // i:                             ^
    // apply reverse:              ^  ^
    // new i:                   ^

    // events/clock:        -1  0  1  2  3  4  5  6
    // clock:                   ^
    // i:                          ^
    // apply reverse:              ^
    // new i:                   ^

    // events/clock:        -1  0  1  2  3  4  5  6
    // clock:                   ^
    // i:                       ^
    // apply reverse:
    // new i:                   ^

    const events = [];
    const n = this.editorTrack.events.length;
    let direction = t.Direction.Forwards;
    let i = this.eventIndex;
    if (i < 0 || toClock > this.clockAt(i)) {
      // go forwards
      for (let j = i + 1; j < n && toClock >= this.clockAt(j); j++) {
        events.push(this.eventAt(j));
        i = j;
      }
    } else if (toClock < this.clockAt(i)) {
      // go backwards
      direction = t.Direction.Backwards;
      for (; i >= 0 && toClock <= this.clockAt(i); i--) {
        events.push(this.eventAt(i));
      }
    }

    const clock = Math.max(0, toClock);
    return { events, direction, i, clock };

    // const clock = Math.max(0, Math.min(this.clockRange.end, toClock));
    // const stop = clock === this.clockRange.end;

    // return { events, direction, i, clock, stop };
  }

  async seek(seekData: t.SeekData, uriSet?: t.UriSet) {
    for (let i = 0; i < seekData.events.length; i++) {
      await this.applySeekStep(seekData, i, uriSet);
    }
    this.finalizeSeek(seekData);
  }

  async applyEditorEvent(e: t.EditorEvent, direction: t.Direction, uriSet?: t.UriSet) {
    await workspaceStepperDispatch(this, e, direction, uriSet);
  }

  async applySeekStep(seekData: t.SeekData, stepIndex: number, uriSet?: t.UriSet) {
    const event = seekData.events[stepIndex];
    assert(event, 'applySeekStep: out of bound event index');
    await this.applyEditorEvent(seekData.events[stepIndex], seekData.direction, uriSet);
    const sign = seekData.direction === t.Direction.Forwards ? 1 : -1;
    this.eventIndex += sign * (stepIndex + 1);
  }

  finalizeSeek(seekData: t.SeekData) {
    this.eventIndex = seekData.i;
  }

  /**
   * Cuts the sessions at clock.
   * Current clock must be < cut clock.
   */
  cut(clock: number) {
    // Cut events
    {
      const i = this.editorTrack.events.findIndex(e => e.clock > clock);
      assert(this.eventIndex < i);
      if (i >= 0) this.editorTrack.events.length = i;
    }

    // Cut focusTimeline
    {
      this.cutFocusItems(this.editorTrack.focusTimeline.documents, clock);
      this.cutFocusItems(this.editorTrack.focusTimeline.lines, clock);
    }
  }

  private cutFocusItems(focusItems: t.FocusItem[], clock: number) {
    for (const [i, focus] of focusItems.entries()) {
      if (focus.clockRange.start >= clock) {
        focusItems.length = i;
        break;
      }
      focus.clockRange.end = Math.min(focus.clockRange.end, clock);
    }
  }

  async applyTextChangeEvent(e: t.TextChangeEvent, direction: t.Direction, uriSet?: t.UriSet) {
    if (uriSet) uriSet[e.uri] = true;
    const textDocument = await this.openTextDocumentByUri(e.uri);
    if (direction === t.Direction.Forwards) {
      textDocument.applyContentChanges(e.contentChanges, false);
    } else {
      textDocument.applyContentChanges(e.revContentChanges, false);
    }
  }

  async applyOpenTextDocumentEvent(e: t.OpenTextDocumentEvent, direction: t.Direction, uriSet?: t.UriSet) {
    // The document may or may not exist in the worktree.
    // The content must be matched if e.text is given.

    if (uriSet) uriSet[e.uri] = true;

    if (direction === t.Direction.Forwards) {
      let textDocument = this.findTextDocumentByUri(e.uri);
      if (textDocument && e.text !== undefined && e.text !== textDocument.getText()) {
        textDocument.applyContentChanges([{ range: textDocument.getRange(), text: e.text }], false);
      } else if (!textDocument) {
        let text: string;
        if (e.text !== undefined) {
          text = e.text;
        } else if (path.isUntitledUri(e.uri)) {
          text = '';
        } else {
          text = new TextDecoder().decode(await this.getContentByUri(e.uri));
        }
        textDocument = TextDocument.fromText(e.uri, text, e.eol);
        this.insertTextDocument(textDocument); // Will insert into worktree if necessary.
      }
    } else {
      if (e.isInWorktree) {
        this.closeTextEditorByUri(e.uri);
      } else {
        this.closeAndRemoveTextDocumentByUri(e.uri);
      }
    }
  }

  async applyCloseTextDocumentEvent(e: t.CloseTextDocumentEvent, direction: t.Direction, uriSet?: t.UriSet) {
    if (uriSet) uriSet[e.uri] = true;

    assert(path.isUntitledUri(e.uri), 'Must only record closeTextDocument for untitled URIs');

    if (direction === t.Direction.Forwards) {
      this.closeAndRemoveTextDocumentByUri(e.uri);
    } else {
      this.insertTextDocument(TextDocument.fromText(e.uri, e.revText, e.revEol));
    }
  }

  async applyShowTextEditorEvent(e: t.ShowTextEditorEvent, direction: t.Direction, uriSet?: t.UriSet) {
    if (direction === t.Direction.Forwards) {
      if (uriSet) uriSet[e.uri] = true;
      this.activeTextEditor = await this.openTextEditorByUri(e.uri, e.selections, e.visibleRange);
    } else if (e.revUri) {
      if (uriSet) uriSet[e.revUri] = true;
      this.activeTextEditor = await this.openTextEditorByUri(e.revUri, e.revSelections, e.revVisibleRange);
    }
  }

  async applyCloseTextEditorEvent(e: t.CloseTextEditorEvent, direction: t.Direction, uriSet?: t.UriSet) {
    if (uriSet) uriSet[e.uri] = true;

    if (direction === t.Direction.Forwards) {
      this.closeTextEditorByUri(e.uri);
    } else {
      await this.openTextEditorByUri(e.uri, e.revSelections, e.revVisibleRange);
    }
  }

  async applySelectEvent(e: t.SelectEvent, direction: t.Direction, uriSet?: t.UriSet) {
    if (uriSet) uriSet[e.uri] = true;
    const textEditor = await this.openTextEditorByUri(e.uri);
    if (direction === t.Direction.Forwards) {
      textEditor.select(e.selections, e.visibleRange);
    } else {
      textEditor.select(e.revSelections, e.revVisibleRange);
    }
  }

  async applyScrollEvent(e: t.ScrollEvent, direction: t.Direction, uriSet?: t.UriSet) {
    if (uriSet) uriSet[e.uri] = true;
    const textEditor = await this.openTextEditorByUri(e.uri);
    if (direction === t.Direction.Forwards) {
      textEditor.scroll(e.visibleRange);
    } else {
      textEditor.scroll(e.revVisibleRange);
    }
  }

  async applySaveEvent(e: t.SaveEvent, direction: t.Direction, uriSet?: t.UriSet) {
    if (uriSet) uriSet[e.uri] = true;
    // nothing
  }
}

/**
 * If a document has been loaded into memory, then the latest content is in the document field and
 * it should always be retrieved from there.
 * Otherwise, its uri refers to the base file stored on disk.
 */
type LiveWorktreeItem = { file: t.File; document?: Document; editor?: Editor };
type LiveWorktree = Map<t.Uri, LiveWorktreeItem>;

function makeLiveWorktree(worktree: t.Worktree): LiveWorktree {
  const map = new Map<t.Uri, LiveWorktreeItem>();
  for (const [key, file] of Object.entries(worktree)) {
    map.set(key, { file });
  }
  return map;
}

export interface Document {
  getContent(): Uint8Array;
}

export class TextDocument implements Document {
  constructor(public uri: t.Uri, public lines: string[], public eol: t.EndOfLine) {}

  static fromText(uri: t.Uri, text: string, defaultEol: t.EndOfLine): TextDocument {
    const eol = (text.match(/\r?\n/)?.[0] as t.EndOfLine) || defaultEol;
    const lines = text.split(/\r?\n/);
    return new TextDocument(uri, lines, eol);
  }

  getContent(): Uint8Array {
    return new TextEncoder().encode(this.getText());
  }

  getText(range?: t.Range): string {
    if (range) {
      assert(this.isRangeValid(range), 'TextDocument getText: invalid range');
      if (range.start.line === range.end.line) {
        return this.lines[range.start.line].slice(range.start.character, range.end.character);
      } else {
        let text = this.lines[range.start.line].slice(range.start.character);
        for (let i = range.start.line + 1; i < range.end.line; i++) {
          text += this.eol + this.lines[i];
        }
        text += this.eol + this.lines[range.end.line].slice(0, range.end.character);
        return text;
      }
    } else {
      return this.lines.map(x => x).join(this.eol);
    }
  }

  isRangeValid(range: t.Range): boolean {
    return (
      range.start.line >= 0 &&
      range.start.character >= 0 &&
      range.end.line < this.lines.length &&
      range.end.character <= this.lines[range.end.line].length
    );
  }

  /**
   * Must be in increasing order and without overlaps.
   * We calculate in increasing order instead of doing it in reverse because it makes calculating
   * the line and character shifts for the reverse content changes easier.
   */
  applyContentChanges(contentChanges: t.ContentChange[], calcReverse: true): t.ContentChange[];
  applyContentChanges(contentChanges: t.ContentChange[], calcReverse: false): undefined;
  applyContentChanges(contentChanges: t.ContentChange[], calcReverse: boolean) {
    const { lines } = this;
    let revContentChanges: t.ContentChange[] | undefined;
    let totalLineShift: number = 0;
    let lastLineShifted = 0;
    let lastLineCharShift = 0;
    if (calcReverse) {
      revContentChanges = [];
    }

    for (let { range, text } of contentChanges) {
      const origRange = range;

      // Apply shifts.
      range = copyRange(range);
      range.start.line += totalLineShift;
      range.start.character += lastLineShifted === range.start.line ? lastLineCharShift : 0;
      range.end.line += totalLineShift;
      range.end.character += lastLineShifted === range.end.line ? lastLineCharShift : 0;

      const newLines = text.split(/\r?\n/);

      // Calculate reverse text.
      let revText: string | undefined;
      if (calcReverse) revText = this.getText(range);

      // Prepend [0, range.start.character] of the first old line to the first new line.
      const firstLinePrefix = lines[range.start.line].slice(0, range.start.character);
      newLines[0] = firstLinePrefix + newLines[0];

      // Append [range.end.character, END] of the last old line to the last new line.
      const lastLineSuffix = lines[range.end.line].slice(range.end.character);
      newLines[newLines.length - 1] += lastLineSuffix;

      const rangeLineCount = range.end.line - range.start.line + 1;
      const extraLineCount = newLines.length - rangeLineCount;

      // Insert or delete extra lines.
      if (extraLineCount > 0) {
        const extraLines = _.times(extraLineCount, () => '');
        lines.splice(range.start.line, 0, ...extraLines);
      } else if (extraLineCount < 0) {
        lines.splice(range.start.line, -extraLineCount);
      }

      // Replace lines.
      for (let i = 0; i < newLines.length; i++) {
        lines[i + range.start.line] = newLines[i];
      }

      // Calculate final position.
      const finalPosition = {
        line: range.end.line + extraLineCount,
        character: newLines[newLines.length - 1].length - lastLineSuffix.length,
      };

      // Insert into revContentChanges.
      if (revContentChanges) {
        // Calculate reverse range
        const revRange = { start: range.start, end: finalPosition };
        revContentChanges!.push({ range: revRange, text: revText! });
      }

      // Calculate shifts for next loop iteration.
      lastLineShifted = finalPosition.line;
      lastLineCharShift = finalPosition.character - origRange.end.character;
      totalLineShift += extraLineCount;
    }

    return revContentChanges;
  }

  getRange(): t.Range {
    if (!this.lines.length) return makeRangeN(0, 0, 0, 0);
    return makeRangeN(0, 0, this.lines.length - 1, this.lines[this.lines.length - 1].length);
  }
}

export interface Editor {
  document: Document;
}

/**
 * The document will be the same for the entire lifetime of this text editor.
 */
export class TextEditor implements Editor {
  constructor(
    public document: TextDocument,
    public selections: t.Selection[] = [makeSelectionN(0, 0, 0, 0)],
    public visibleRange: t.Range = makeRangeN(0, 0, 1, 0),
  ) {}

  select(selections: t.Selection[], visibleRange: t.Range) {
    this.selections = selections;
    this.visibleRange = visibleRange;
  }

  scroll(visibleRange: t.Range) {
    this.visibleRange = visibleRange;
  }
}

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

// export function makeEmptyEditorTrackJSON(defaultEol: t.EndOfLine): t.InternalEditorTrack {
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
