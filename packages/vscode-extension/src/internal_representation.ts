import * as misc from './misc.js';
import * as vscode from 'vscode';
import assert from 'assert';
import _ from 'lodash';
import os from 'os';
import * as fs from 'fs';
import path from 'path';

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
  // revSelections: vscode.Selection[];
};

export type OpenDocumentEvent = {
  type: 'openDocument';
  clock: number;
  uri: vscode.Uri;
  // text: string;
  eol: vscode.EndOfLine;
};

export type ShowTextEditor = {
  type: 'showTextEditor';
  clock: number;
  uri: vscode.Uri;
  selections: vscode.Selection[];
  visibleRange: vscode.Range;
  revUri?: vscode.Uri;
  revSelections?: vscode.Selection[];
  revVisibleRange?: vscode.Range;
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
  textDocuments: TextDocument[] = [];
  textEditors: TextEditor[] = [];
  activeTextEditor?: TextEditor;

  // checkpoints: Checkpoint[];
  // debug: Map<vscode.TextEditor, number> = new Map();

  constructor(public initCheckpoint: Checkpoint, public events: PlaybackEvent[], public workspacePath: string) {}

  /**
   * workspacePath must be already resolved.
   */
  static async fromWorkspace(workspacePath: string): Promise<Session> {
    const checkpoint = await Checkpoint.fromWorkspace(workspacePath);
    return Session.fromCheckpoint(checkpoint, [], workspacePath);
  }

  /**
   * workspacePath must be already resolved.
   */
  static fromCheckpoint(checkpoint: Checkpoint, events: PlaybackEvent[], workspacePath: string): Session {
    const session = new Session(checkpoint, events, workspacePath);
    session.restoreCheckpoint(checkpoint);
    return session;
  }

  /**
   * workspacePath must be already resolved.
   */
  static async fromFile(filename: string, workspacePath: string): Promise<Session> {
    const plain = JSON.parse(await fs.promises.readFile(filename, 'utf8')) as PlainSession;
    const events = playbackEventsFromPlain(plain.events);
    const checkpoint = Checkpoint.fromPlain(plain.initCheckpoint);
    return Session.fromCheckpoint(checkpoint, events, workspacePath);
  }

  /**
   * Modify the current session except for the events.
   */
  restoreCheckpoint(checkpoint: Checkpoint) {
    const textDocuments = checkpoint.textDocuments.map(d => TextDocument.fromText(d.uri, d.text));
    const textEditors = checkpoint.textEditors.map(e => {
      const textDocument = textDocuments.find(d => misc.isEqualUri(d.uri, e.uri));
      assert(textDocument, `restoreCheckpoint: did not find textDocument for the textEditor with uri ${e.uri}`);
      return new TextEditor(textDocument, e.selections, e.visibleRange);
    });
    let activeTextEditor: TextEditor | undefined;
    if (checkpoint.activeTextEditorUri) {
      activeTextEditor = textEditors.find(e => misc.isEqualUri(checkpoint.activeTextEditorUri!, e.document.uri));
      assert(activeTextEditor, `restoreCheckpoint: did not find textEditor with uri ${checkpoint.activeTextEditorUri}`);
    }

    this.textDocuments = textDocuments;
    this.textEditors = textEditors;
    this.activeTextEditor = activeTextEditor;
  }

  async syncToVscodeAndDisk(targetUris?: vscode.Uri[]) {
    // Vscode does not let us close a TextDocument. We can only close tabs and tab groups.

    // all tabs that are not in this.textEditors should be closed
    for (const tabGroup of vscode.window.tabGroups.all) {
      for (const tab of tabGroup.tabs) {
        if (tab.input instanceof vscode.TabInputText) {
          const partialUri = this.getPartialUri(tab.input.uri);
          if (partialUri) {
            if (!this.findTextEditorByUri(partialUri)) {
              const vscTextDocument = await vscode.workspace.openTextDocument(tab.input.uri);
              await vscTextDocument.save();
              await vscode.window.tabGroups.close(tab);
            }
          }
        }
      }
    }

    if (targetUris) {
      // all files in targetUris that are no longer in this.textDocuments should be deleted
      for (const targetUri of targetUris) {
        if (!this.findTextDocumentByUri(targetUri)) {
          await fs.promises.rm(targetUri.path, { force: true });
        }
      }
    } else {
      // targetUris is undefined when we need to restore a checkpoint completely, meaning that
      // any file that is not in this.textDocuments should be deleted and any text editor not in
      // this.textEditors should be closed.

      // save all tabs and close them
      // for (const tabGroup of vscode.window.tabGroups.all) {
      //   for (const tab of tabGroup.tabs) {
      //     if (tab.input instanceof vscode.TabInputText) {
      //       const partialUri = this.getPartialUri(tab.input.uri);
      //       if (partialUri) {
      //         const vscTextDocument = await vscode.workspace.openTextDocument(tab.input.uri);
      //         await vscTextDocument.save();
      //         await vscode.window.tabGroups.close(tab);
      //       }
      //     }
      //   }
      // }

      // all files in workspace that are not in this.textDocuments should be deleted
      const workspaceFileUris = await misc.readDirRecursivelyUri(this.workspacePath, { includeFiles: true });
      for (const fileUri of workspaceFileUris) {
        if (!this.findTextDocumentByUri(fileUri)) {
          await fs.promises.rm(this.getFullUri(fileUri).path, { force: true });
        }
      }

      // set targetUris to this.textDocument's uris
      targetUris = this.textDocuments.map(d => d.uri);
    }

    // for now, just delete empty directories
    const workspaceDirUris = await misc.readDirRecursivelyUri(this.workspacePath, { includeDirs: true });
    for (const dirUri of workspaceDirUris) {
      assert(os.platform() === 'linux', 'FIXME: the / separator is hardcoded here');
      const dirIsEmpty = !this.textDocuments.some(
        d => d.uri.scheme === dirUri.scheme && d.uri.path.startsWith(dirUri.path + '/'),
      );
      if (dirIsEmpty) await fs.promises.rm(this.getFullUri(dirUri).path, { force: true, recursive: true });
    }

    // for each targetUri
    //   if there's a textDocument open in vscode, replace its content
    //   else, mkdir and write to file
    for (const targetUri of targetUris) {
      const fullUri = this.getFullUri(targetUri);
      const textDocument = this.findTextDocumentByUri(targetUri);
      if (!textDocument) continue; // already deleted above

      const vscTextDocument = vscode.workspace.textDocuments.find(d => misc.isEqualUri(d.uri, fullUri));
      if (vscTextDocument) {
        const vscTextEditor = await vscode.window.showTextDocument(vscTextDocument, { preserveFocus: true });
        await vscTextEditor.edit(editBuilder => {
          const range = misc.getWholeTextDocumentRange(vscTextDocument);
          editBuilder.replace(range, textDocument.getText());
        });
        await vscTextDocument.save();
      } else {
        await fs.promises.mkdir(path.dirname(fullUri.path), { recursive: true });
        await fs.promises.writeFile(fullUri.path, textDocument.getText(), 'utf8');
      }
    }

    // open all this.textEditors
    for (const textEditor of this.textEditors) {
      const fullUri = this.getFullUri(textEditor.document.uri);
      await vscode.window.showTextDocument(fullUri, {
        preview: false,
        preserveFocus: true,
        selection: textEditor.selections[0],
        viewColumn: vscode.ViewColumn.One,
      });
    }

    // show this.activeTextEditor
    if (this.activeTextEditor) {
      const fullUri = this.getFullUri(this.activeTextEditor.document.uri);
      await vscode.window.showTextDocument(fullUri, {
        preview: false,
        preserveFocus: false,
        selection: this.activeTextEditor.selections[0],
        viewColumn: vscode.ViewColumn.One,
      });
    }
  }

  openTextDocument(vscTextDocument: vscode.TextDocument): TextDocument {
    const uri = this.getPartialUri(vscTextDocument.uri);
    assert(uri);
    let textDocument = this.findTextDocumentByUri(uri);
    if (!textDocument) {
      textDocument = TextDocument.fromVscTextDocument(vscTextDocument, uri);
      this.textDocuments.push(textDocument);
    }
    return textDocument;
  }

  openTextEditor(
    vscTextDocument: vscode.TextDocument,
    selections: vscode.Selection[],
    visibleRange: vscode.Range,
  ): TextEditor {
    const textDocument = this.openTextDocument(vscTextDocument);
    let textEditor = this.findTextEditorByUri(textDocument.uri);
    if (!textEditor) {
      textEditor = new TextEditor(textDocument, selections, visibleRange);
      this.textEditors.push(textEditor);
    } else {
      textEditor.select(selections, visibleRange);
    }
    return textEditor;
  }

  findTextDocumentByUri(uri: vscode.Uri): TextDocument | undefined {
    return this.textDocuments.find(x => misc.isEqualUri(x.uri, uri));
  }

  findTextEditorByUri(uri: vscode.Uri): TextEditor | undefined {
    return this.textEditors.find(x => misc.isEqualUri(x.document.uri, uri));
  }

  getTextDocumentByUri(uri: vscode.Uri): TextDocument {
    const textDocument = this.findTextDocumentByUri(uri);
    assert(textDocument);
    return textDocument;
  }

  getTextEditorByUri(uri: vscode.Uri): TextEditor {
    const textEditor = this.findTextEditorByUri(uri);
    assert(textEditor);
    return textEditor;
  }

  toPlain() {
    return {
      events: playbackEventsToPlain(this.events),
      initCheckpoint: this.initCheckpoint.toPlain(),
    };
  }

  async writeToFile(filename: string) {
    const plainSession = this.toPlain();
    await fs.promises.writeFile(filename, JSON.stringify(plainSession, null, 2), 'utf8');
  }

  getPartialUri(uri: vscode.Uri): vscode.Uri | undefined {
    return misc.getPartialUri(this.workspacePath, uri);
  }

  getFullUri(uri: vscode.Uri): vscode.Uri {
    return misc.getFullUri(this.workspacePath, uri);
  }
}

// We cannot hold a reference to vscode.TextEditor because its identity is not stable.
// Vscode may give us two different instances of vscode.TextEditor for what appears to
// be the same editor for the same document in the same tab.
export class TextEditor {
  // The document associated with this text editor.
  // The document will be the same for the entire lifetime of this text editor.
  document: TextDocument;
  selections: vscode.Selection[];
  visibleRange: vscode.Range;

  constructor(textDocument: TextDocument, selections: vscode.Selection[], visibleRange: vscode.Range) {
    this.document = textDocument;
    this.selections = selections;
    this.visibleRange = visibleRange;
  }

  select(selections: vscode.Selection[], visibleRange: vscode.Range) {
    this.selections = selections;
    this.visibleRange = visibleRange;
  }

  scroll(visibleRange: vscode.Range) {
    this.visibleRange = misc.duplicateRange(visibleRange);
  }
}

export class TextDocument {
  // vscTextDocument: vscode.TextDocument;
  // isDirty: boolean;

  constructor(public uri: vscode.Uri, public lines: string[], public eol: vscode.EndOfLine) {}

  static fromText(uri: vscode.Uri, text: string): TextDocument {
    const eolStr = text.match(/\r?\n/)?.[0] || os.EOL;
    const eol = eolStr === '\r\n' ? vscode.EndOfLine.CRLF : vscode.EndOfLine.LF;
    const lines = text.split(/\r?\n/);
    return new TextDocument(uri, lines, eol);
  }

  static fromVscTextDocument(vscTextDocument: vscode.TextDocument, uri: vscode.Uri): TextDocument {
    const lines = _.times(vscTextDocument.lineCount, i => vscTextDocument.lineAt(i).text);
    const eol = vscTextDocument.eol;
    return new TextDocument(uri, lines, eol);
  }

  getEolString(): string {
    return this.eol === vscode.EndOfLine.LF ? '\n' : '\r\n';
  }

  getText(range?: vscode.Range): string {
    const eolString = this.getEolString();
    if (range) {
      assert(this.isRangeValid(range), 'TextDocument getText: invalid range');
      if (range.isSingleLine) {
        return this.lines[range.start.line].slice(range.start.character, range.end.character);
      } else {
        let text = this.lines[range.start.line].slice(range.start.character);
        for (let i = range.start.line + 1; i < range.end.line; i++) {
          text += eolString + this.lines[i];
        }
        text += eolString + this.lines[range.end.line].slice(0, range.end.character);
        return text;
      }
    } else {
      return this.lines.map(x => x).join(eolString);
    }
  }

  isRangeValid(range: vscode.Range): boolean {
    return (
      range.start.line >= 0 &&
      range.start.character >= 0 &&
      range.end.line < this.lines.length &&
      range.end.character <= this.lines[this.lines.length - 1].length
    );
  }

  // applyVscContentChanges(vscContentChanges: readonly vscode.TextDocumentContentChangeEvent[]): ContentChange[] {
  //   if (vscContentChanges.length > 1) {
  //     // can the content changes be applied one at a time? or do we need to
  //     // update the range of the second content change after applying the first?
  //     throw new Error('TODO textChange: vscContentChanges > 1');
  //   }

  //   return vscContentChanges.map(x => this.applyContentChange(x));
  // }

  applyContentChange(
    range: vscode.Range,
    text: string,
    calcReverse: boolean,
  ): [range: vscode.Range, text: string] | undefined {
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
    let revRange: vscode.Range | undefined;
    if (calcReverse) {
      const endPosition = new vscode.Position(
        range.end.line + extraLineCount,
        newLines[newLines.length - 1].length - lastLineSuffix.length,
      );
      revRange = new vscode.Range(range.start, endPosition);
    }

    if (calcReverse) return [revRange!, revText!];
  }
}

class Checkpoint {
  constructor(
    public textDocuments: CheckpointTextDocument[],
    public textEditors: CheckpointTextEditor[],
    public activeTextEditorUri?: vscode.Uri,
  ) {}

  /**
   * workspacePath must be already resolved.
   */
  static async fromWorkspace(workspacePath: string): Promise<Checkpoint> {
    for (const vscTextDocument of vscode.workspace.textDocuments) {
      if (vscTextDocument.isDirty) {
        throw new Error('Checkpoint.fromWorkspace: there are unsaved files in the current workspace.');
      }
    }

    const textDocuments = await CheckpointTextDocument.fromWorkspace(workspacePath);

    // Get textEditors from vscode.window.visibleTextEditors first. These have selections and visible range.
    // Then get the rest from vscode.window.tabGroups. These don't have selections and range.
    const textEditors = _.compact(
      vscode.window.visibleTextEditors.map(e => CheckpointTextEditor.fromVsc(workspacePath, e)),
    );
    const openTextDocumentUris: vscode.Uri[] = [];
    for (const tabGroup of vscode.window.tabGroups.all) {
      for (const tab of tabGroup.tabs) {
        if (tab.input instanceof vscode.TabInputText) {
          const partialUri = misc.getPartialUri(workspacePath, tab.input.uri);
          if (partialUri) openTextDocumentUris.push(partialUri);
        }
      }
    }
    for (const uri of openTextDocumentUris) {
      if (!textEditors.some(e => misc.isEqualUri(e.uri, uri))) {
        textEditors.push(new CheckpointTextEditor(uri));
      }
    }

    const activeTextEditorUri =
      vscode.window.activeTextEditor?.document.uri &&
      misc.getPartialUri(workspacePath, vscode.window.activeTextEditor?.document.uri);

    return new Checkpoint(textDocuments, textEditors, activeTextEditorUri);
  }

  static fromSession(session: Session): Checkpoint {
    const textDocuments: CheckpointTextDocument[] = session.textDocuments.map(d => ({
      uri: d.uri,
      text: d.getText(),
    }));

    const textEditors: CheckpointTextEditor[] = session.textEditors.map(e => ({
      uri: e.document.uri,
      selections: e.selections,
      visibleRange: e.visibleRange,
    }));

    const activeTextEditorUri = session.activeTextEditor?.document.uri;

    return new Checkpoint(textDocuments, textEditors, activeTextEditorUri);
  }

  static fromPlain(plain: PlainCheckpoint): Checkpoint {
    const textDocuments = plain.textDocuments.map(d => ({
      uri: uriFromPlain(d.uri),
      text: d.text,
    }));
    const textEditors = plain.textEditors.map(e => ({
      uri: uriFromPlain(e.uri),
      selections: selectionsFromPlain(e.selections),
      visibleRange: rangeFromPlain(e.visibleRange),
    }));
    const activeTextEditorUri = plain.activeTextEditorUri && uriFromPlain(plain.activeTextEditorUri);
    return new Checkpoint(textDocuments, textEditors, activeTextEditorUri);
  }

  toPlain(): PlainCheckpoint {
    return {
      textDocuments: this.textDocuments.map(d => ({
        uri: uriToPlain(d.uri),
        text: d.text,
      })),
      textEditors: this.textEditors.map(e => ({
        uri: uriToPlain(e.uri),
        selections: selectionsToPlain(e.selections),
        visibleRange: rangeToPlain(e.visibleRange),
      })),
      activeTextEditorUri: this.activeTextEditorUri && uriToPlain(this.activeTextEditorUri),
    };
  }
}

class CheckpointTextDocument {
  constructor(public uri: vscode.Uri, public text: string) {}

  static async fromWorkspace(root: string): Promise<CheckpointTextDocument[]> {
    const res: CheckpointTextDocument[] = [];
    const uris = await misc.readDirRecursivelyUri(root, { includeFiles: true });
    for (const uri of uris) {
      const text = await fs.promises.readFile(path.join(root, uri.path), 'utf8');
      res.push(new CheckpointTextDocument(uri, text));
    }
    return res;
  }
}

class CheckpointTextEditor {
  constructor(
    public uri: vscode.Uri,
    public selections: vscode.Selection[] = [new vscode.Selection(0, 0, 0, 0)],
    public visibleRange: vscode.Range = new vscode.Range(0, 0, 1, 0),
  ) {}

  /**
   * workspacePath must be already resolved.
   */
  static fromVsc(workspacePath: string, vscTextEditor: vscode.TextEditor): CheckpointTextEditor | undefined {
    const uri = misc.getPartialUri(workspacePath, vscTextEditor.document.uri);
    if (!uri) return undefined;
    const selections = misc.duplicateSelections(vscTextEditor.selections);
    const visibleRange = misc.duplicateRange(vscTextEditor.visibleRanges[0]);
    return new CheckpointTextEditor(uri, selections, visibleRange);
  }
}

//======================================================
// Plain JSON equivalent of the playback event types
// These are used for serialization and deserialization
//======================================================

type PlainSession = {
  events: PlainPlaybackEvent[];
  initCheckpoint: PlainCheckpoint;
};

export type PlainCheckpoint = {
  // base: CheckpointBaseGit;
  textDocuments: PlainCheckpointTextDocument[];
  textEditors: PlainCheckpointTextEditor[];
  activeTextEditorUri?: PlainUri;
};

export type PlainCheckpointTextDocument = {
  uri: PlainUri;
  text: string;
};

export type PlainCheckpointTextEditor = {
  uri: PlainUri;
  selections: PlainSelection[];
  visibleRange: PlainRange;
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
  // revSelections: PlainSelection[];
};

type PlainOpenDocumentEvent = {
  type: 'openDocument';
  clock: number;
  uri: PlainUri;
  // text: string;
  eol: PlainEndOfLine;
};

type PlainShowTextEditor = {
  type: 'showTextEditor';
  clock: number;
  uri: PlainUri;
  selections: PlainSelection[];
  visibleRange: PlainRange;
  revUri?: PlainUri;
  revSelections?: PlainSelection[];
  revVisibleRange?: PlainRange;
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
  scheme: 'file';
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

export function playbackEventsToPlain(es: PlaybackEvent[]): PlainPlaybackEvent[] {
  return es.map(playbackEventToPlain);
}

export function playbackEventToPlain(e: PlaybackEvent): PlainPlaybackEvent {
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
        // revSelections: selectionsToPlain(e.revSelections),
      };
    }
    case 'openDocument': {
      return {
        type: e.type,
        clock: e.clock,
        uri: uriToPlain(e.uri),
        // text: e.text,
        eol: endOfLineToPlain(e.eol),
      };
    }
    case 'showTextEditor': {
      return {
        type: e.type,
        clock: e.clock,
        uri: uriToPlain(e.uri),
        selections: selectionsToPlain(e.selections),
        visibleRange: rangeToPlain(e.visibleRange),
        revUri: e.revUri && uriToPlain(e.revUri),
        revSelections: e.revSelections && selectionsToPlain(e.revSelections),
        revVisibleRange: e.revVisibleRange && rangeToPlain(e.revVisibleRange),
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
      misc.unreachable(e, `playbackEventToJson: unknown type ${(e as any).type || ''}`);
  }
}

function uriToPlain(uri: vscode.Uri): PlainUri {
  assert(uri.scheme === 'file');
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
        // revSelections: selectionsFromPlain(e.revSelections),
      };
    }
    case 'openDocument': {
      return {
        type: e.type,
        clock: e.clock,
        uri: uriFromPlain(e.uri),
        // text: e.text,
        eol: endOfLineFromPlain(e.eol),
      };
    }
    case 'showTextEditor': {
      return {
        type: e.type,
        clock: e.clock,
        uri: uriFromPlain(e.uri),
        selections: selectionsFromPlain(e.selections),
        visibleRange: rangeFromPlain(e.visibleRange),
        revUri: e.revUri && uriFromPlain(e.revUri),
        revSelections: e.revSelections && selectionsFromPlain(e.revSelections),
        revVisibleRange: e.revVisibleRange && rangeFromPlain(e.revVisibleRange),
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
      misc.unreachable(e, `playbackEventToJson: unknown type ${(e as any).type || ''}`);
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
