import * as misc from './misc';
import * as vscode from 'vscode';
import assert from 'assert';
import _ from 'lodash';
import * as fs from 'fs';

export type PlaybackEvent =
  | StopEvent
  | TextChangeEvent
  | OpenDocumentEvent
  | ShowTextEditor
  | SelectEvent
  | ScrollEvent
  | SaveEvent;
// | ReverseEvent;

export type StopEvent = {
  type: 'stop';
  clock: number;
};

export type TextChangeEvent = {
  type: 'textChange';
  clock: number;
  uri: vscode.Uri;
  contentChanges: ContentChange[];
  revSelections: vscode.Selection[];
};

export type OpenDocumentEvent = {
  type: 'openDocument';
  clock: number;
  uri: vscode.Uri;
  text: string;
  eol: vscode.EndOfLine;
};

export type ShowTextEditor = {
  type: 'showTextEditor';
  clock: number;
  uri: vscode.Uri;
  selections: vscode.Selection[];
  revUri?: vscode.Uri;
  // revSelections: vscode.Selection[];
};

export type SelectEvent = {
  type: 'select';
  clock: number;
  uri: vscode.Uri;
  selections: vscode.Selection[];
  visibleRange: vscode.Range;
  revSelections: vscode.Selection[];
  revVisibleRange: vscode.Range;
};

export type ScrollEvent = {
  type: 'scroll';
  clock: number;
  uri: vscode.Uri;
  visibleRange: vscode.Range;
  revVisibleRange: vscode.Range;
};

export type SaveEvent = {
  type: 'save';
  clock: number;
  uri: vscode.Uri;
};

export type ContentChange = {
  range: vscode.Range;
  text: string;
  revRange: vscode.Range;
  revText: string;
};

// Not every TextDocument may be attached to a TextEditor. At least not until the
// TextEditor is opened.
export class Session {
  events: PlaybackEvent[];
  activeTextEditor?: TextEditor;
  textEditors: TextEditor[] = [];
  textDocuments: TextDocument[] = [];

  static fromFile(filename: string): Session {
    const plain = JSON.parse(fs.readFileSync(filename, 'utf8')) as PlainSession;
    return sessionFromPlain(plain);
  }

  constructor(events: PlaybackEvent[] = []) {
    this.events = events;
  }

  writeToFile(filename: string) {
    const plainSession = sessionToPlain(this);
    fs.writeFileSync(filename, JSON.stringify(plainSession, null, 2), 'utf8');
  }

  openTextDocument(vscTextDocument: vscode.TextDocument): TextDocument {
    let textDocument = this.findTextDocument(vscTextDocument);
    if (!textDocument) {
      textDocument = new TextDocument(vscTextDocument);
      this.textDocuments.push(textDocument);
    }
    return textDocument;
  }

  showTextEditor(vscTextEditor: vscode.TextEditor, textDocument: TextDocument): TextEditor {
    let textEditor = this.findTextEditor(vscTextEditor);
    if (!textEditor) {
      textEditor = new TextEditor(vscTextEditor, textDocument);
      this.textEditors.push(textEditor);
      this.activeTextEditor = textEditor;
    }
    return textEditor;
  }

  findTextEditor(vscTextEditor: vscode.TextEditor): TextEditor | undefined {
    return this.textEditors.find(x => x.vscTextEditor === vscTextEditor);
  }

  findTextDocument(vscTextDocument: vscode.TextDocument): TextDocument | undefined {
    return this.textDocuments.find(x => x.vscTextDocument === vscTextDocument);
  }

  // A text editor is returned only if there's only 1 text editor for the given document,
  // or the text editor matches the given vscTextEditor.
  // vscTextEditor is a suggestion, usually the current active text editor is passed.
  // But it's possible that we're trying to get the TextDocument related to a vscTextDocument
  // that was modified in the background and therefore does not have a text editor, or
  // it is not the active text editor.
  getTextDocumentAndEditor(
    vscTextDocument: vscode.TextDocument,
    vscTextEditor?: vscode.TextEditor,
  ): [TextDocument, TextEditor?] {
    const document = this.findTextDocument(vscTextDocument);
    if (!document) {
      throw new Error(`getIRTextDocumentAndEditor: document "${vscTextDocument.fileName}" was not found`);
    }

    const textEditors = this.textEditors.filter(x => x.document === document);
    let textEditor: TextEditor | undefined;
    if (textEditors.length === 1) {
      textEditor = textEditors[0];
    } else if (textEditors.length > 1 && vscTextEditor) {
      textEditor = textEditors.find(x => x.vscTextEditor === vscTextEditor);
    }

    return [document, textEditor];
  }
}

export class TextEditor {
  vscTextEditor: vscode.TextEditor;
  // The document associated with this text editor.
  // The document will be the same for the entire lifetime of this text editor.
  document: TextDocument;
  selections: vscode.Selection[];
  visibleRange: vscode.Range;

  constructor(vscTextEditor: vscode.TextEditor, textDocument: TextDocument) {
    this.vscTextEditor = vscTextEditor;
    this.document = textDocument;
    this.selections = misc.duplicateSelections(vscTextEditor.selections);
    this.visibleRange = misc.duplicateRange(vscTextEditor.visibleRanges[0]);
  }

  select(selections: readonly vscode.Selection[], visibleRange: vscode.Range) {
    this.selections = misc.duplicateSelections(selections);
    this.visibleRange = misc.duplicateRange(visibleRange);
  }

  scroll(visibleRange: vscode.Range) {
    this.visibleRange = misc.duplicateRange(visibleRange);
  }
}

export class TextDocument {
  vscTextDocument: vscode.TextDocument;
  uri: vscode.Uri;
  lines: TextLine[];
  eol: vscode.EndOfLine;
  isDirty: boolean;

  constructor(vscTextDocument: vscode.TextDocument) {
    this.vscTextDocument = vscTextDocument;
    this.uri = vscTextDocument.uri;
    this.lines = _.times(vscTextDocument.lineCount, i => new TextLine(vscTextDocument.lineAt(i).text));
    this.eol = vscTextDocument.eol;
    this.isDirty = vscTextDocument.isDirty;
  }

  getText(range?: vscode.Range): string {
    if (range) {
      assert(this.isRangeValid(range), 'TextDocument getText: invalid range');
      if (range.isSingleLine) {
        return this.lines[range.start.line].text.slice(range.start.character, range.end.character);
      } else {
        let text = this.lines[range.start.line].text.slice(range.start.character);
        for (let i = range.start.line + 1; i < range.end.line; i++) {
          text += '\n' + this.lines[i].text;
        }
        text += '\n' + this.lines[range.end.line].text.slice(0, range.end.character);
        return text;
      }
    } else {
      return this.lines.map(x => x.text).join('\n');
    }
  }

  isRangeValid(range: vscode.Range): boolean {
    return (
      range.start.line >= 0 &&
      range.start.character >= 0 &&
      range.end.line < this.lines.length &&
      range.end.character <= this.lines[this.lines.length - 1].text.length
    );
  }

  applyVscContentChanges(vscContentChanges: readonly vscode.TextDocumentContentChangeEvent[]): ContentChange[] {
    if (vscContentChanges.length > 1) {
      // can the content changes be applied one at a time? or do we need to
      // update the range of the second content change after applying the first?
      throw new Error('TODO textChange: vscContentChanges > 1');
    }

    return vscContentChanges.map(x => this.applyVscContentChange(x));
  }

  applyVscContentChange(vscContentChange: vscode.TextDocumentContentChangeEvent): ContentChange {
    const { range, text } = vscContentChange;
    assert(this.isRangeValid(range), 'applyVscContentChange: invalid range');
    const { lines } = this;
    const revText = this.getText(range);
    const newLines = text.split(/\r?\n/);

    // Prepend [0, range.start.character] of the first old line to the first new line.
    const firstLinePrefix = lines[range.start.line].text.slice(0, range.start.character);
    newLines[0] = firstLinePrefix + newLines[0];

    // Append [range.end.character, END] of the last old line to the last new line.
    const lastLineSuffix = lines[range.end.line].text.slice(range.end.character);
    newLines[newLines.length - 1] += lastLineSuffix;

    const rangeLineCount = range.end.line - range.start.line + 1;
    const extraLineCount = newLines.length - rangeLineCount;

    // Insert or delete extra lines.
    if (extraLineCount > 0) {
      const extraLines = _.times(extraLineCount, () => new TextLine(''));
      lines.splice(range.start.line, 0, ...extraLines);
    } else if (extraLineCount < 0) {
      lines.splice(range.start.line, -extraLineCount);
    }

    // Replace lines.
    for (let i = 0; i < newLines.length; i++) {
      lines[i + range.start.line].text = newLines[i];
    }

    // Calculate revRange.
    const endPosition = new vscode.Position(
      range.end.line + extraLineCount,
      newLines[newLines.length - 1].length - lastLineSuffix.length,
    );
    const revRange = new vscode.Range(range.start, endPosition);

    return {
      range,
      text,
      revRange,
      revText,
    };
  }
}

export class TextLine {
  constructor(public text: string) {}
}

// function playbackEventsToJson(events: PlaybackEvent[]): Object[] {
//   return events.map(playbackEventToJson);
// }

//======================================================
// Plain JSON equivalent of the playback event types
// These are used for serialization and deserialization
//======================================================

type PlainSession = {
  events: PlainPlaybackEvent[];
};

type PlainPlaybackEvent =
  | PlainStopEvent
  | PlainTextChangeEvent
  | PlainOpenDocumentEvent
  | PlainShowTextEditor
  | PlainSelectEvent
  | PlainScrollEvent
  | PlainSaveEvent;
// | ReverseEvent;

type PlainStopEvent = {
  type: 'stop';
  clock: number;
};

type PlainTextChangeEvent = {
  type: 'textChange';
  clock: number;
  uri: PlainUri;
  contentChanges: PlainContentChange[];
  revSelections: PlainSelection[];
};

type PlainOpenDocumentEvent = {
  type: 'openDocument';
  clock: number;
  uri: PlainUri;
  text: string;
  eol: PlainEndOfLine;
};

type PlainShowTextEditor = {
  type: 'showTextEditor';
  clock: number;
  uri: PlainUri;
  selections: PlainSelection[];
  revUri?: PlainUri;
};

type PlainSelectEvent = {
  type: 'select';
  clock: number;
  uri: PlainUri;
  selections: PlainSelection[];
  visibleRange: PlainRange;
  revSelections: PlainSelection[];
  revVisibleRange: PlainRange;
};

type PlainScrollEvent = {
  type: 'scroll';
  clock: number;
  uri: PlainUri;
  visibleRange: PlainRange;
  revVisibleRange: PlainRange;
};

type PlainSaveEvent = {
  type: 'save';
  clock: number;
  uri: PlainUri;
};

type PlainUri = {
  scheme: (typeof misc.SUPPORTED_URI_SCHEMES)[number];
  path: string;
};

type PlainContentChange = {
  range: PlainRange;
  text: string;
  revRange: PlainRange;
  revText: string;
};

type PlainPosition = {
  line: number;
  character: number;
};

type PlainRange = {
  start: PlainPosition;
  end: PlainPosition;
};

type PlainSelection = {
  anchor: PlainPosition;
  active: PlainPosition;
};

type PlainEndOfLine = 'LF' | 'CRLF';

//=========================================================
// Conversion from normal structures to plain json
//=========================================================

function sessionToPlain(session: Session): PlainSession {
  return { events: playbackEventsToPlain(session.events) };
}

function playbackEventsToPlain(es: PlaybackEvent[]): PlainPlaybackEvent[] {
  return es.map(playbackEventToPlain);
}

function playbackEventToPlain(e: PlaybackEvent): PlainPlaybackEvent {
  switch (e.type) {
    case 'stop': {
      return {
        type: e.type,
        clock: e.clock,
      };
    }
    case 'textChange': {
      return {
        type: e.type,
        clock: e.clock,
        uri: uriToPlain(e.uri),
        contentChanges: contentChangesToPlain(e.contentChanges),
        revSelections: selectionsToPlain(e.revSelections),
      };
    }
    case 'openDocument': {
      return {
        type: e.type,
        clock: e.clock,
        uri: uriToPlain(e.uri),
        text: e.text,
        eol: endOfLineToPlain(e.eol),
      };
    }
    case 'showTextEditor': {
      return {
        type: e.type,
        clock: e.clock,
        uri: uriToPlain(e.uri),
        selections: selectionsToPlain(e.selections),
        revUri: e.revUri && uriToPlain(e.revUri),
      };
    }
    case 'select': {
      return {
        type: e.type,
        clock: e.clock,
        uri: uriToPlain(e.uri),
        selections: selectionsToPlain(e.selections),
        visibleRange: rangeToPlain(e.visibleRange),
        revSelections: selectionsToPlain(e.revSelections),
        revVisibleRange: rangeToPlain(e.revVisibleRange),
      };
    }
    case 'scroll': {
      return {
        type: e.type,
        clock: e.clock,
        uri: uriToPlain(e.uri),
        visibleRange: rangeToPlain(e.visibleRange),
        revVisibleRange: rangeToPlain(e.revVisibleRange),
      };
    }
    case 'save': {
      return {
        type: e.type,
        clock: e.clock,
        uri: uriToPlain(e.uri),
      };
    }
    default:
      throw new Error(`playbackEventToJson: unknown type ${(e as any).type || ''}`);
  }
}

function uriToPlain(uri: vscode.Uri): PlainUri {
  assert(uri.scheme === 'untitled' || uri.scheme === 'file');
  return { scheme: uri.scheme, path: uri.path };
}

function contentChangesToPlain(contentChanges: ContentChange[]): PlainContentChange[] {
  return contentChanges.map(contentChangeToPlain);
}

function contentChangeToPlain(contentChange: ContentChange): PlainContentChange {
  return {
    range: rangeToPlain(contentChange.range),
    text: contentChange.text,
    revRange: rangeToPlain(contentChange.revRange),
    revText: contentChange.revText,
  };
}

function endOfLineToPlain(eol: vscode.EndOfLine): PlainEndOfLine {
  const str = vscode.EndOfLine[eol];
  assert(str === 'CRLF' || str === 'LF');
  return str;
}

function positionToPlain(position: vscode.Position): PlainPosition {
  return { line: position.line, character: position.character };
}

function selectionsToPlain(selections: vscode.Selection[]): PlainSelection[] {
  return selections.map(selectionToPlain);
}

function selectionToPlain(selection: vscode.Selection): PlainSelection {
  return {
    anchor: positionToPlain(selection.anchor),
    active: positionToPlain(selection.active),
  };
}

function rangeToPlain(range: vscode.Range): PlainRange {
  return {
    start: positionToPlain(range.start),
    end: positionToPlain(range.end),
  };
}

//=========================================================
// Conversion plain json to normal structures
//=========================================================

function sessionFromPlain(session: PlainSession): Session {
  return new Session(playbackEventsFromPlain(session.events));
}

function playbackEventsFromPlain(es: PlainPlaybackEvent[]): PlaybackEvent[] {
  return es.map(playbackEventFromPlain);
}

function playbackEventFromPlain(e: PlainPlaybackEvent): PlaybackEvent {
  switch (e.type) {
    case 'stop': {
      return {
        type: e.type,
        clock: e.clock,
      };
    }
    case 'textChange': {
      return {
        type: e.type,
        clock: e.clock,
        uri: uriFromPlain(e.uri),
        contentChanges: contentChangesFromPlain(e.contentChanges),
        revSelections: selectionsFromPlain(e.revSelections),
      };
    }
    case 'openDocument': {
      return {
        type: e.type,
        clock: e.clock,
        uri: uriFromPlain(e.uri),
        text: e.text,
        eol: endOfLineFromPlain(e.eol),
      };
    }
    case 'showTextEditor': {
      return {
        type: e.type,
        clock: e.clock,
        uri: uriFromPlain(e.uri),
        selections: selectionsFromPlain(e.selections),
        revUri: e.revUri && uriFromPlain(e.revUri),
      };
    }
    case 'select': {
      return {
        type: e.type,
        clock: e.clock,
        uri: uriFromPlain(e.uri),
        selections: selectionsFromPlain(e.selections),
        visibleRange: rangeFromPlain(e.visibleRange),
        revSelections: selectionsFromPlain(e.revSelections),
        revVisibleRange: rangeFromPlain(e.revVisibleRange),
      };
    }
    case 'scroll': {
      return {
        type: e.type,
        clock: e.clock,
        uri: uriFromPlain(e.uri),
        visibleRange: rangeFromPlain(e.visibleRange),
        revVisibleRange: rangeFromPlain(e.revVisibleRange),
      };
    }
    case 'save': {
      return {
        type: e.type,
        clock: e.clock,
        uri: uriFromPlain(e.uri),
      };
    }
    default:
      throw new Error(`playbackEventToJson: unknown type ${(e as any).type || ''}`);
  }
}

function uriFromPlain(uri: PlainUri): vscode.Uri {
  return vscode.Uri.from(uri);
}

function contentChangesFromPlain(contentChanges: PlainContentChange[]): ContentChange[] {
  return contentChanges.map(contentChangeFromPlain);
}

function contentChangeFromPlain(contentChange: PlainContentChange): ContentChange {
  return {
    range: rangeFromPlain(contentChange.range),
    text: contentChange.text,
    revRange: rangeFromPlain(contentChange.revRange),
    revText: contentChange.revText,
  };
}

function endOfLineFromPlain(eol: PlainEndOfLine): vscode.EndOfLine {
  return vscode.EndOfLine[eol];
}

function positionFromPlain(position: PlainPosition): vscode.Position {
  return new vscode.Position(position.line, position.character);
}

function selectionsFromPlain(selections: PlainSelection[]): vscode.Selection[] {
  return selections.map(selectionFromPlain);
}

function selectionFromPlain(selection: PlainSelection): vscode.Selection {
  return new vscode.Selection(positionFromPlain(selection.anchor), positionFromPlain(selection.active));
}

function rangeFromPlain(range: PlainRange): vscode.Range {
  return new vscode.Range(positionFromPlain(range.start), positionFromPlain(range.end));
}
