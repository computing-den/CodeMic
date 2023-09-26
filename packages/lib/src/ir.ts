import _ from 'lodash';
import * as t from './types.js';
import * as lib from './lib.js';
import * as path from './path.js';
import assert from './assert.js';

// Not every TextDocument may be attached to a TextEditor. At least not until the
// TextEditor is opened.
export class Session implements t.ApplyPlaybackEvent {
  constructor(
    public root: t.AbsPath,
    public initCheckpoint: t.Checkpoint,
    public events: t.PlaybackEvent[],
    public audioTracks: t.AudioTrack[],
    public defaultEol: t.EndOfLine,
    public summary: t.SessionSummary,
    public textDocuments: TextDocument[] = [],
    public textEditors: TextEditor[] = [],
    public activeTextEditor?: TextEditor,
  ) {}

  /**
   * root must be already resolved.
   */
  static fromCheckpoint(
    root: t.AbsPath,
    checkpoint: t.Checkpoint,
    events: t.PlaybackEvent[],
    audioTracks: t.AudioTrack[],
    defaultEol: t.EndOfLine,
    summary: t.SessionSummary,
  ): Session {
    const session = new Session(root, checkpoint, events, audioTracks, defaultEol, summary);
    session.restoreCheckpoint(checkpoint);
    return session;
  }

  static fromJSON(root: t.AbsPath, json: t.SessionJSON, summary: t.SessionSummary): Session {
    const { events, audioTracks, initCheckpoint, defaultEol } = json;
    const session = new Session(root, initCheckpoint, events, audioTracks, defaultEol, summary);
    session.restoreCheckpoint(initCheckpoint);
    return session;
  }

  toJSON(): t.SessionJSON {
    assert(this.summary);
    return {
      events: this.events,
      audioTracks: this.audioTracks,
      initCheckpoint: this.initCheckpoint,
      defaultEol: this.defaultEol,
    };
  }

  toCheckpoint(): t.Checkpoint {
    const textDocuments: t.CheckpointTextDocument[] = this.textDocuments.map(d =>
      makeCheckpointTextDocument(d.uri, d.getText()),
    );
    const textEditors: t.CheckpointTextEditor[] = this.textEditors.map(e =>
      makeCheckpointTextEditor(e.document.uri, e.selections, e.visibleRange),
    );
    const activeTextEditorUri = this.activeTextEditor?.document.uri;
    return makeCheckpoint(textDocuments, textEditors, activeTextEditorUri);
  }

  /**
   * Modify the current session except for the events.
   */
  restoreCheckpoint(checkpoint: t.Checkpoint) {
    const textDocuments = checkpoint.textDocuments.map(d => TextDocument.fromText(d.uri, d.text, this.defaultEol));
    const textEditors = checkpoint.textEditors.map(e => {
      const textDocument = textDocuments.find(d => d.uri === e.uri);
      assert(textDocument, `restoreCheckpoint: did not find textDocument for the textEditor with uri ${e.uri}`);
      return new TextEditor(textDocument, e.selections, e.visibleRange);
    });
    let activeTextEditor: TextEditor | undefined;
    if (checkpoint.activeTextEditorUri) {
      activeTextEditor = textEditors.find(e => checkpoint.activeTextEditorUri === e.document.uri);
      assert(activeTextEditor, `restoreCheckpoint: did not find textEditor with uri ${checkpoint.activeTextEditorUri}`);
    }

    this.textDocuments = textDocuments;
    this.textEditors = textEditors;
    this.activeTextEditor = activeTextEditor;
  }

  // insertTextDocument(textDocument: TextDocument) {
  //   assert(!this.findTextDocumentByUri(textDocument.uri));
  //   this.textDocuments.push(textDocument);
  // }

  // insertTextEditor(textEditor: TextEditor) {
  //   assert(!this.findTextEditorByUri(textEditor.document.uri));
  //   this.textEditors.push(textEditor);
  // }

  findTextDocumentByUri(uri: t.Uri): TextDocument | undefined {
    return this.textDocuments.find(x => x.uri === uri);
  }

  findTextEditorByUri(uri: t.Uri): TextEditor | undefined {
    return this.textEditors.find(x => x.document.uri === uri);
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

  openTextEditorByUri(uri: t.Uri, selections?: t.Selection[], visibleRange?: t.Range): TextEditor {
    let textEditor = this.findTextEditorByUri(uri);
    if (textEditor && selections && visibleRange) {
      textEditor.select(selections, visibleRange);
    }

    if (!textEditor) {
      textEditor = new TextEditor(this.getTextDocumentByUri(uri), selections, visibleRange);
      this.textEditors.push(textEditor);
    }

    return textEditor;
  }

  // async writeToFile(filename: string) {
  //   const plainSession = this.toPlain();
  //   await fs.promises.writeFile(filename, JSON.stringify(plainSession, null, 2), 'utf8');
  // }

  toWorkspaceUri(p: t.AbsPath): t.Uri {
    return path.workspaceUriFromAbsPath(this.root, p);
  }

  closeTextDocumentByUri(uri: t.Uri) {
    this.closeTextEditorByUri(uri);
    this.textDocuments = this.textDocuments.filter(x => x.uri !== uri);
  }

  closeTextEditorByUri(uri: t.Uri) {
    this.textEditors = this.textEditors.filter(x => x.document.uri !== uri);
    if (this.activeTextEditor?.document.uri === uri) {
      this.activeTextEditor = undefined;
    }
  }

  clockAt(i: number): number {
    return this.events[i]?.clock ?? 0;
  }

  getSeekData(i: number, toClock: number): t.SeekData {
    const events = [];
    const n = this.events.length;
    let direction = t.Direction.Forwards;
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

    const clock = Math.max(0, Math.min(this.summary.duration, toClock));
    const stop = clock >= this.summary.duration;

    return { events, direction, i, clock, stop };
  }

  async seek(seekData: t.SeekData, uriSet?: t.UriSet) {
    for (const event of seekData.events) {
      await lib.dispatchPlaybackEvent(this, event, seekData.direction, uriSet);
    }
  }

  /**
   * Cuts all events whose clock is > clock.
   * Sets summary.duration to clock as well.
   */
  cut(clock: number) {
    const i = this.events.findIndex(e => e.clock > clock);
    if (i >= 0) this.events.length = i;
    this.summary.duration = clock;
  }

  async applyTextChangeEvent(e: t.TextChangeEvent, direction: t.Direction, uriSet?: t.UriSet) {
    if (e.contentChanges.length > 1) {
      throw new Error('applyTextChangeEvent: textChange does not yet support contentChanges.length > 1');
    }
    if (uriSet) uriSet[e.uri] = true;
    const textDocument = this.getTextDocumentByUri(e.uri);
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

  async applyOpenDocumentEvent(e: t.OpenDocumentEvent, direction: t.Direction, uriSet?: t.UriSet) {
    if (uriSet) uriSet[e.uri] = true;
    const textDocument = this.findTextDocumentByUri(e.uri);
    if (direction === t.Direction.Forwards) {
      if (!textDocument) {
        this.textDocuments.push(TextDocument.fromText(e.uri, e.text, e.eol));
      }
    } else {
      // TODO should we remove the document?
      // if (textDocument) this.closeTextDocumentByUri(e.uri);
    }
  }

  async applyShowTextEditorEvent(e: t.ShowTextEditorEvent, direction: t.Direction, uriSet?: t.UriSet) {
    if (direction === t.Direction.Forwards) {
      if (uriSet) uriSet[e.uri] = true;
      this.activeTextEditor = this.openTextEditorByUri(e.uri, e.selections, e.visibleRange);
    } else if (e.revUri) {
      if (uriSet) uriSet[e.revUri] = true;
      this.activeTextEditor = this.openTextEditorByUri(e.revUri, e.revSelections!, e.revVisibleRange!);
    }
  }

  async applySelectEvent(e: t.SelectEvent, direction: t.Direction, uriSet?: t.UriSet) {
    if (uriSet) uriSet[e.uri] = true;
    const textEditor = this.getTextEditorByUri(e.uri);
    if (direction === t.Direction.Forwards) {
      textEditor.select(e.selections, e.visibleRange);
    } else {
      textEditor.select(e.revSelections, e.revVisibleRange);
    }
  }

  async applyScrollEvent(e: t.ScrollEvent, direction: t.Direction, uriSet?: t.UriSet) {
    if (uriSet) uriSet[e.uri] = true;
    const textEditor = this.getTextEditorByUri(e.uri);
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
 * The document will be the same for the entire lifetime of this text editor.
 */
export class TextEditor {
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

export class TextDocument {
  constructor(public uri: t.Uri, public lines: string[], public eol: t.EndOfLine) {}

  static fromText(uri: t.Uri, text: string, defaultEol: t.EndOfLine): TextDocument {
    const eol = (text.match(/\r?\n/)?.[0] as t.EndOfLine) || defaultEol;
    const lines = text.split(/\r?\n/);
    return new TextDocument(uri, lines, eol);
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
      range.end.character <= this.lines[this.lines.length - 1].length
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

export function makeCheckpoint(
  textDocuments: t.CheckpointTextDocument[],
  textEditors: t.CheckpointTextEditor[],
  activeTextEditorUri?: t.Uri,
): t.Checkpoint {
  return { textDocuments, textEditors, activeTextEditorUri };
}

export function makeCheckpointTextDocument(uri: t.Uri, text: string): t.CheckpointTextDocument {
  return { uri, text };
}

export function makeCheckpointTextEditor(
  uri: t.Uri,
  selections: t.Selection[] = [makeSelectionN(0, 0, 0, 0)],
  visibleRange: t.Range = makeRangeN(0, 0, 1, 0),
): t.CheckpointTextEditor {
  return { uri, selections, visibleRange };
}
