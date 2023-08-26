import _ from 'lodash';
import type * as t from './types.js';
import * as lib from './lib.js';
import * as path from './path.js';
import assert from './assert.js';

export class Position implements t.Position {
  constructor(public line: number, public character: number) {}
}

export class Range implements t.Range {
  constructor(public start: Position, public end: Position) {}
}

export class Selection implements t.Selection {
  constructor(public anchor: Position, public active: Position) {}
}

export type EndOfLine = '\n' | '\r\n';

export class Checkpoint {
  constructor(
    public textDocuments: CheckpointTextDocument[],
    public textEditors: CheckpointTextEditor[],
    public activeTextEditorUri?: t.Uri,
  ) {}
}

export class CheckpointTextDocument {
  constructor(public uri: t.Uri, public text: string) {}
}

export class CheckpointTextEditor {
  constructor(public uri: t.Uri, public selections: Selection[], public visibleRange: Range) {}
  // = [{ anchor: { line: 0, character: 0 }, active: { line: 0, character: 0 } }],
  // = { start: { line: 0, character: 0 }, end: { line: 1, character: 0 } },
}

// Not every TextDocument may be attached to a TextEditor. At least not until the
// TextEditor is opened.
export class Session {
  constructor(
    public workspacePath: t.AbsPath,
    public initCheckpoint: Checkpoint,
    public events: t.PlaybackEvent[],
    public defaultEol: t.EndOfLine,
    public textDocuments: TextDocument[] = [],
    public textEditors: TextEditor[] = [],
    public activeTextEditor?: TextEditor,
  ) {}

  /**
   * workspacePath must be already resolved.
   */
  static fromCheckpoint(
    workspacePath: t.AbsPath,
    checkpoint: Checkpoint,
    events: t.PlaybackEvent[],
    defaultEol: t.EndOfLine,
  ): Session {
    const session = new Session(workspacePath, checkpoint, events, defaultEol);
    session.restoreCheckpoint(checkpoint);
    return session;
  }

  static fromJSON(workspacePath: t.AbsPath, json: JSON): Session {
    // const events = playbackEventsFromPlain(plain.events);
    // const checkpoint = Checkpoint.fromPlain(plain.initCheckpoint);
    throw new Error('TODO: session.fromJSON()');
  }

  toJSON(): JSON {
    throw new Error('TODO: session.toJSON()');
    // return {
    //   events: playbackEventsToPlain(this.events),
    //   initCheckpoint: this.initCheckpoint.toPlain(),
    // };
  }

  toCheckpoint(): Checkpoint {
    const textDocuments: CheckpointTextDocument[] = this.textDocuments.map(
      d => new CheckpointTextDocument(d.uri, d.getText()),
    );

    const textEditors: CheckpointTextEditor[] = this.textEditors.map(
      e => new CheckpointTextEditor(e.document.uri, e.selections, e.visibleRange),
    );

    const activeTextEditorUri = this.activeTextEditor?.document.uri;

    return new Checkpoint(textDocuments, textEditors, activeTextEditorUri);
  }

  /**
   * Modify the current session except for the events.
   */
  restoreCheckpoint(checkpoint: Checkpoint) {
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
    return path.workspaceUriFromAbsPath(this.workspacePath, p);
  }

  // toAbsUri(uri: t.Uri): t.Uri {
  //   return path.toAbsUri(this.workspacePath, uri);
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
