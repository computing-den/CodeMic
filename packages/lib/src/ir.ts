import _ from 'lodash';
import type * as t from './types.js';
import * as lib from './lib.js';
import * as path from './path.js';
import assert from './assert.js';

// Not every TextDocument may be attached to a TextEditor. At least not until the
// TextEditor is opened.
export class Session {
  constructor(
    public root: t.AbsPath,
    public initCheckpoint: t.Checkpoint,
    public events: t.PlaybackEvent[],
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
    defaultEol: t.EndOfLine,
    summary: t.SessionSummary,
  ): Session {
    const session = new Session(root, checkpoint, events, defaultEol, summary);
    session.restoreCheckpoint(checkpoint);
    return session;
  }

  static fromJSON(root: t.AbsPath, json: t.SessionJSON, summary: t.SessionSummary): Session {
    const { events, initCheckpoint, defaultEol } = json;
    const session = new Session(root, initCheckpoint, events, defaultEol, summary);
    session.restoreCheckpoint(initCheckpoint);
    return session;
  }

  toJSON(): t.SessionJSON {
    assert(this.summary);
    return {
      events: this.events,
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

  // async writeToFile(filename: string) {
  //   const plainSession = this.toPlain();
  //   await fs.promises.writeFile(filename, JSON.stringify(plainSession, null, 2), 'utf8');
  // }

  toWorkspaceUri(p: t.AbsPath): t.Uri {
    return path.workspaceUriFromAbsPath(this.root, p);
  }

  // toAbsUri(uri: t.Uri): t.Uri {
  //   return path.toAbsUri(this.root, uri);
  // }
}

/**
 * The document will be the same for the entire lifetime of this text editor.
 */
export class TextEditor {
  constructor(public document: TextDocument, public selections: t.Selection[], public visibleRange: t.Range) {}

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

  applyContentChange(range: t.Range, text: string, calcReverse: boolean): [range: t.Range, text: string] | undefined {
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
    let revRange: t.Range | undefined;
    if (calcReverse) {
      const endPosition = {
        line: range.end.line + extraLineCount,
        character: newLines[newLines.length - 1].length - lastLineSuffix.length,
      };
      revRange = { start: range.start, end: endPosition };
    }

    if (calcReverse) return [revRange!, revText!];
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
  selections: t.Selection[],
  visibleRange: t.Range,
): t.CheckpointTextEditor {
  return { uri, selections, visibleRange };
  // = [{ anchor: { line: 0, character: 0 }, active: { line: 0, character: 0 } }],
  // = { start: { line: 0, character: 0 }, end: { line: 1, character: 0 } },
}
