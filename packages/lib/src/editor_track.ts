import _ from 'lodash';
import * as t from './types.js';
import editorEventStepperDispatch from './editor_event_stepper_dispatch.js';
import * as lib from './lib.js';
import * as path from './path.js';
import assert from './assert.js';

// Not every TextDocument may be attached to a TextEditor. At least not until the
// TextEditor is opened.
export class EditorTrack implements t.EditorEventStepper {
  // These fields remain the same regardless of the clock
  root: t.AbsPath;
  io: t.SessionIO;
  id: string;
  clockRange: t.ClockRange;
  initSnapshot: t.EditorTrackSnapshot;
  events: t.EditorEvent[];
  defaultEol: t.EndOfLine;

  // These fields change with the clock/eventIndex
  // TODO sync the entire worktree structure including directories.
  // If a TextDocument is in this.textDocuments, it is also in this.worktree.
  // If a TextEditor is in this.textEditors, it is also in this.worktree.
  // clock: number;
  eventIndex: number;
  worktree: Worktree;
  textDocuments: TextDocument[];
  textEditors: TextEditor[];
  activeTextEditor?: TextEditor;

  private constructor(root: t.AbsPath, io: t.SessionIO, editorTrack: t.EditorTrack) {
    this.root = root;
    this.io = io;
    // this.summary = summary;
    this.id = editorTrack.id;
    this.clockRange = editorTrack.clockRange;
    this.initSnapshot = editorTrack.initSnapshot;
    this.events = editorTrack.events;
    this.defaultEol = editorTrack.defaultEol;

    this.eventIndex = -1;
    this.worktree = {};
    this.textDocuments = [];
    this.textEditors = [];
  }

  static async fromJSON(root: t.AbsPath, io: t.SessionIO, editorTrackJSON: t.EditorTrack): Promise<EditorTrack> {
    const editorTrack = new EditorTrack(root, io, editorTrackJSON);
    await editorTrack.restoreInitSnapshot();
    return editorTrack;
  }

  toJSON(): t.EditorTrack {
    return {
      id: this.id,
      clockRange: this.clockRange,
      events: this.events,
      defaultEol: this.defaultEol,
      initSnapshot: this.initSnapshot,
    };
  }

  async setInitSnapshotAndRestore(initSnapshot: t.EditorTrackSnapshot) {
    this.initSnapshot = initSnapshot;
    await this.restoreInitSnapshot();
  }

  async restoreInitSnapshot() {
    this.eventIndex = -1;
    this.worktree = makeWorktree(this.initSnapshot.worktree);
    this.textDocuments = [];
    this.textEditors = [];

    for (const textEditor of this.initSnapshot.textEditors) {
      await this.openTextEditorByUri(textEditor.uri, textEditor.selections, textEditor.visibleRange);
    }

    if (this.initSnapshot.activeTextEditorUri) {
      this.activeTextEditor = this.findTextEditorByUri(this.initSnapshot.activeTextEditorUri);
    }
  }

  doesUriExist(uri: t.Uri): boolean {
    return Boolean(this.worktree[uri]);
  }

  getWorktreeUris(): t.Uri[] {
    return Object.keys(this.worktree);
  }

  async getContentByUri(uri: t.Uri): Promise<Uint8Array> {
    const item = this.worktree[uri];
    assert(item);

    if (item.document) {
      return item.document.getContent();
    }

    if (item.file.type === 'local') {
      return this.io.readFile(item.file);
    }

    throw new Error(`getContentByUri ${uri} type "${item.file}" not supported`);
  }

  findTextDocumentByUri(uri: t.Uri): TextDocument | undefined {
    const textDocument = this.worktree[uri]?.document;
    return textDocument instanceof TextDocument ? textDocument : undefined;
  }

  findTextEditorByUri(uri: t.Uri): TextEditor | undefined {
    const textEditor = this.worktree[uri]?.editor;
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
    const worktreeItem = this.worktree[uri];
    if (!worktreeItem) throw new Error(`file not found ${uri}`);

    if (worktreeItem.document) {
      if (!(worktreeItem.document instanceof TextDocument)) {
        throw new Error(`file is not a text document ${uri}`);
      }
      return worktreeItem.document;
    }

    const text = new TextDecoder().decode(await this.io.readFile(worktreeItem.file));
    const textDocument = TextDocument.fromText(uri, text, this.defaultEol);
    this.insertTextDocument(textDocument);
    return textDocument;
  }

  insertTextDocument(textDocument: TextDocument) {
    this.worktree[textDocument.uri] ??= { file: { type: 'empty' } };
    this.worktree[textDocument.uri].document = textDocument;
    this.textDocuments.push(textDocument);
  }

  async openTextEditorByUri(uri: t.Uri, selections?: t.Selection[], visibleRange?: t.Range): Promise<TextEditor> {
    const worktreeItem = this.worktree[uri];
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
    this.worktree[textEditor.document.uri] ??= { file: { type: 'empty' }, document: textEditor.document };
    this.worktree[textEditor.document.uri].editor = textEditor;
    this.textEditors.push(textEditor);
  }

  toWorkspaceUri(p: t.AbsPath): t.Uri {
    return path.workspaceUriFromAbsPath(this.root, p);
  }

  // closeTextDocumentByUri(uri: t.Uri) {
  //   this.closeTextEditorByUri(uri);
  //   this.textDocuments = this.textDocuments.filter(x => x.uri !== uri);
  // }

  closeTextEditorByUri(uri: t.Uri) {
    if (this.worktree[uri].editor) {
      this.worktree[uri].editor = undefined;
      this.textEditors = this.textEditors.filter(x => x.document.uri !== uri);
    }
    if (this.activeTextEditor?.document.uri === uri) {
      this.activeTextEditor = undefined;
    }
  }

  clockAt(i: number): number {
    return this.events[i]?.clock ?? 0;
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
    const n = this.events.length;
    let direction = t.Direction.Forwards;
    let i = this.eventIndex;
    if (i < 0 || toClock > this.clockAt(i)) {
      // go forwards
      for (let j = i + 1; j < n && toClock >= this.clockAt(j); j++) {
        events.push(this.events[j]);
        i = j;
      }
    } else if (toClock < this.clockAt(i)) {
      // go backwards
      direction = t.Direction.Backwards;
      for (; i >= 0 && toClock <= this.clockAt(i); i--) {
        events.push(this.events[i]);
      }
    }

    const clock = Math.max(0, Math.min(this.clockRange.end, toClock));
    const stop = clock === this.clockRange.end;

    return { events, direction, i, clock, stop };
  }

  async seek(seekData: t.SeekData, uriSet?: t.UriSet) {
    for (let i = 0; i < seekData.events.length; i++) {
      await this.applySeekStep(seekData, i, uriSet);
    }
    await this.finalizeSeek(seekData);
  }

  async applyEditorEvent(e: t.EditorEvent, direction: t.Direction, uriSet?: t.UriSet) {
    await editorEventStepperDispatch(this, e, direction, uriSet);
  }

  async applySeekStep(seekData: t.SeekData, stepIndex: number, uriSet?: t.UriSet) {
    await this.applyEditorEvent(seekData.events[stepIndex], seekData.direction, uriSet);
    const sign = seekData.direction === t.Direction.Forwards ? 1 : -1;
    this.eventIndex += sign * (stepIndex + 1);
  }

  async finalizeSeek(seekData: t.SeekData) {
    this.eventIndex = seekData.i;
  }

  /**
   * Cuts all events whose clock is > clock.
   * Sets summary.duration to clock as well.
   */
  cut(clock: number) {
    const i = this.events.findIndex(e => e.clock > clock);
    if (i >= 0) this.events.length = i;
    this.clockRange.end = clock;
  }

  async applyTextChangeEvent(e: t.TextChangeEvent, direction: t.Direction, uriSet?: t.UriSet) {
    if (e.contentChanges.length > 1) {
      throw new Error('applyTextChangeEvent: textChange does not yet support contentChanges.length > 1');
    }
    if (uriSet) uriSet[e.uri] = true;
    const textDocument = await this.openTextDocumentByUri(e.uri);
    if (direction === t.Direction.Forwards) {
      for (const cc of e.contentChanges) {
        textDocument.applyContentChange(cc.range, cc.text, false);
      }
    } else {
      for (const cc of e.contentChanges) {
        textDocument.applyContentChange(cc.revRange, cc.revText, false);
      }
    }
  }

  async applyOpenTextDocumentEvent(e: t.OpenTextDocumentEvent, direction: t.Direction, uriSet?: t.UriSet) {
    // All existing documents should already be in the worktree.
    // TODO: open a new document. Keep worktree, textDocuments, and textEditors in sync.
    throw new Error('TODO openTextDocument');

    // if (uriSet) uriSet[e.uri] = true;
    // const textDocument = this.findTextDocumentByUri(e.uri);
    // if (direction === t.Direction.Forwards) {
    //   if (!textDocument) {
    //     this.textDocuments.push(TextDocument.fromText(e.uri, e.text, e.eol));
    //   }
    // } else {
    //   // TODO should we remove the document?
    //   // if (textDocument) this.closeTextDocumentByUri(e.uri);
    // }
  }

  async applyShowTextEditorEvent(e: t.ShowTextEditorEvent, direction: t.Direction, uriSet?: t.UriSet) {
    if (direction === t.Direction.Forwards) {
      if (uriSet) uriSet[e.uri] = true;
      this.activeTextEditor = await this.openTextEditorByUri(e.uri, e.selections, e.visibleRange);
    } else if (e.revUri) {
      if (uriSet) uriSet[e.revUri] = true;
      this.activeTextEditor = await this.openTextEditorByUri(e.revUri, e.revSelections!, e.revVisibleRange!);
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
export type Worktree = { [key: t.Uri]: WorktreeItem };
type WorktreeItem = { file: t.File; document?: Document; editor?: Editor };

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

  applyContentChange(range: t.Range, text: string, calcReverse: true): [range: t.Range, text: string];
  applyContentChange(range: t.Range, text: string, calcReverse: false): undefined;
  applyContentChange(range: t.Range, text: string, calcReverse: boolean) {
    assert(this.isRangeValid(range), 'applyContentChange: invalid range');
    const { lines } = this;
    const newLines = text.split(/\r?\n/);

    // calculate revText
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

    // Calculate revRange.
    if (calcReverse) {
      const endPosition = {
        line: range.end.line + extraLineCount,
        character: newLines[newLines.length - 1].length - lastLineSuffix.length,
      };
      const revRange = { start: range.start, end: endPosition };
      return [revRange, revText!];
    }
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

export function makePosition(line: number, character: number): t.Position {
  return { line, character };
}

export function makeRange(start: t.Position, end: t.Position): t.Range {
  return { start, end };
}

export function makeRangeN(startLine: number, startCharacter: number, endLine: number, endCharacter: number): t.Range {
  return { start: makePosition(startLine, startCharacter), end: makePosition(endLine, endCharacter) };
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

export function makeEmptySnapshot(): t.EditorTrackSnapshot {
  return {
    worktree: {},
    textEditors: [],
  };
}

export function makeTextEditorSnapshot(
  uri: t.Uri,
  selections: t.Selection[] = [makeSelectionN(0, 0, 0, 0)],
  visibleRange: t.Range = makeRangeN(0, 0, 1, 0),
): t.TextEditor {
  return { uri, selections, visibleRange };
}

function makeWorktree(worktree: t.Worktree): Worktree {
  return _.mapValues(worktree, file => ({ file }));
}
