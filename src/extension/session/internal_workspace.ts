import * as path from 'path';
import { URI } from 'vscode-uri';
import _ from 'lodash';
import * as t from '../../lib/types.js';
import { LineRange, Selection, workspaceUri, lastSortedIndex } from '../../lib/lib.js';
import assert from '../../lib/assert.js';
import { LoadedSession } from './session.js';
import InternalWorkspaceStepper from './internal_workspace_stepper.js';
import InternalTextEditor from './internal_text_editor.js';
import InternalTextDocument from './internal_text_document.js';

/**
 * LiveWorktree is supposed to hold the entire workspace directory at a particular clock: every
 * file and directory and where to find their contents: dir, file with open TextDocument, or a
 * blob to be read from disk.
 * The file field represents the content on disk. Whereas the document field represents the loaded
 * document which is used in the text editor and it may be unsaved.
 * When saving an untitled document to disk, VSCode first opens the document, changes its content,
 * then writes the document to disk. So, between those steps, that item will have an empty file.
 */
type LiveWorktree = Map<string, LiveWorktreeItem>;
type LiveWorktreeItem = { file: t.File; document?: t.InternalDocument; editor?: t.InternalEditor };

export type SeekStep = { event: t.EditorEvent; index: number };
export type SeekData = { steps: SeekStep[]; direction: t.Direction };

// Not every InternalTextDocument may be attached to a InternalTextEditor. At least not until the
// TextEditor is opened.
export default class InternalWorkspace {
  // eventIndex represents the index of the last event that was executed. That is, the effects of that event are visible.
  eventIndex: number;
  activeTextEditor?: InternalTextEditor;
  stepper: InternalWorkspaceStepper;
  textDocuments: InternalTextDocument[];
  textEditors: InternalTextEditor[];

  // If a InternalTextDocument is in this.textDocuments, it is also in this.worktree.
  // If a InternalTextEditor is in this.textEditors, it is also in this.worktree.
  private worktree: LiveWorktree;

  constructor(public session: LoadedSession) {
    this.eventIndex = -1;
    this.worktree = new Map();
    this.textDocuments = [];
    this.textEditors = [];
    this.stepper = new InternalWorkspaceStepper(session, this);
  }

  /**
   * Returns the last event that was executed. That is, the effects of that event are visible.
   */
  getCurrentEvent(): t.EditorEvent | undefined {
    return this.session.body.editorEvents.at(this.eventIndex);
  }

  async restoreInitState() {
    assert(this.eventIndex === -1, 'calling restoreInitState on an already initialized internal workspace');
    this.textDocuments = [];
    this.textEditors = [];

    // Apply all events whose clock is 0.
    await this.seek(0);
  }

  doesUriExist(uri: string): boolean {
    return Boolean(this.worktree.get(uri));
  }

  getWorktreeUris(): string[] {
    return Array.from(this.worktree.keys());
  }

  isDirUri(uri: string): boolean {
    return Boolean(this.worktree.get(uri)?.file.type === 'dir');
  }

  findWorktreeItemByUri(uri: string): LiveWorktreeItem | undefined {
    return this.worktree.get(uri);
  }

  getWorktreeItemByUri(uri: string): LiveWorktreeItem {
    const item = this.worktree.get(uri);
    if (!item) throw new Error(`${uri} not found in internal workspace`);
    return item;
  }

  async getLiveContentByUri(uri: string): Promise<Uint8Array> {
    const item = this.getWorktreeItemByUri(uri);

    if (item.document) {
      return item.document.getContent();
    } else {
      return this.session.core.readFile(item.file);
    }
  }

  findTextDocumentByUri(uri: string): InternalTextDocument | undefined {
    const textDocument = this.worktree.get(uri)?.document;
    return textDocument instanceof InternalTextDocument ? textDocument : undefined;
  }

  findTextEditorByUri(uri: string): InternalTextEditor | undefined {
    const textEditor = this.worktree.get(uri)?.editor;
    return textEditor instanceof InternalTextEditor ? textEditor : undefined;
  }

  getTextDocumentByUri(uri: string): InternalTextDocument {
    const textDocument = this.findTextDocumentByUri(uri);
    assert(textDocument);
    return textDocument;
  }

  getTextEditorByUri(uri: string): InternalTextEditor {
    const textEditor = this.findTextEditorByUri(uri);
    assert(textEditor);
    return textEditor;
  }

  async openTextDocumentByUri(uri: string, eol?: t.EndOfLine): Promise<InternalTextDocument> {
    const item = this.getWorktreeItemByUri(uri);

    if (item.document) {
      if (!(item.document instanceof InternalTextDocument)) {
        throw new Error(`file is not a text document ${uri}`);
      }
      return item.document;
    }

    const text = new TextDecoder().decode(await this.session.core.readFile(item.file));
    const textDocument = InternalTextDocument.fromText(uri, text, eol ?? this.session.body.defaultEol);
    this.insertTextDocument(textDocument);
    return textDocument;
  }

  insertOrUpdateFile(uri: string, file: t.File): LiveWorktreeItem {
    let item = this.worktree.get(uri);
    if (item) {
      item.file = file;
    } else {
      // insert parent directories
      const uriParsed = URI.parse(uri);
      if (uriParsed.scheme === 'workspace') {
        const components = uriParsed.fsPath.split('/');
        for (let i = 0; i < components.length - 1; i++) {
          const p = path.join(...components.slice(0, i + 1));
          const parentUri = workspaceUri(p);
          if (!this.worktree.has(parentUri)) {
            this.worktree.set(parentUri, { file: { type: 'dir' }, document: undefined, editor: undefined });
          }
        }
      }

      item = { file, document: undefined, editor: undefined };
      this.worktree.set(uri, item);
    }
    return item;
  }

  insertTextDocument(textDocument: InternalTextDocument) {
    assert(!this.textDocuments.includes(textDocument));
    const item = this.getWorktreeItemByUri(textDocument.uri);

    item.document = textDocument;
    this.textDocuments.push(textDocument);
  }

  async openTextEditorByUri(
    uri: string,
    selections?: Selection[],
    visibleRange?: LineRange,
  ): Promise<InternalTextEditor> {
    const item = this.getWorktreeItemByUri(uri);

    if (item.editor) {
      if (!(item.editor instanceof InternalTextEditor)) {
        throw new Error(`file is not a text document ${uri}`);
      }
      if (selections && visibleRange) {
        item.editor.select(selections);
        item.editor.scroll(visibleRange);
      }
      return item.editor;
    } else {
      const textEditor = new InternalTextEditor(await this.openTextDocumentByUri(uri), selections, visibleRange);
      this.insertTextEditor(textEditor);
      return textEditor;
    }
  }

  insertTextEditor(textEditor: InternalTextEditor): LiveWorktreeItem {
    let item = this.getWorktreeItemByUri(textEditor.document.uri);

    item.editor = textEditor;
    if (!this.textEditors.includes(textEditor)) {
      this.textEditors.push(textEditor);
    }
    return item;
  }

  // toWorkspaceUri(p: string): string {
  //   return path.workspaceUriFromAbsPath(this.session.workspace, p);
  // }

  deleteFileByUri(uri: string) {
    this.closeTextDocumentByUri(uri);
    this.worktree.delete(uri);
  }

  closeTextDocumentByUri(uri: string) {
    const item = this.getWorktreeItemByUri(uri);

    this.closeTextEditorByUri(uri);
    if (item.document) {
      this.textDocuments = this.textDocuments.filter(x => x !== item.document);
      item.document = undefined;
    }
  }

  // closeAndRemoveTextDocumentByUri(uri: string) {
  //   this.textDocuments = this.textDocuments.filter(x => x.uri !== uri);
  //   this.textEditors = this.textEditors.filter(x => x.document.uri !== uri);
  //   if (this.activeTextEditor?.document.uri === uri) {
  //     this.activeTextEditor = undefined;
  //   }
  // }

  closeTextEditorByUri(uri: string) {
    const item = this.getWorktreeItemByUri(uri);

    if (item.editor) {
      this.textEditors = this.textEditors.filter(x => x !== item.editor);
      if (this.activeTextEditor === item.editor) {
        this.activeTextEditor = undefined;
      }
      item.editor = undefined;
    }
  }

  // /**
  //  * Returns 0 for i === -1. Otherwise, i must be in range.
  //  */
  // clockAt(i: number): number {
  //   return i < 0 ? 0 : this.eventAt(i).clock;
  // }

  // private eventAt(i: number): t.EditorEvent {
  //   assert(i >= 0 && i < this.editorTrack.events.length, 'out of bound event index');
  //   return this.editorTrack.events[i];
  // }

  getSeekData(toClock: number): SeekData {
    const finalIndex = lastSortedIndex(this.session.body.editorEvents, toClock, e => e.clock) - 1;
    return this.getSeekDataByIndex(finalIndex);
  }

  getSeekDataByIndex(finalIndex: number): SeekData {
    // NO MOVEMENT:
    // index          0   1   2   3   4   5   6   7
    // clock          0   1   2   3   4   5   6   7
    // cur index                  |
    // toClock                    |
    // final index                |
    // ---
    // cur index === final index

    // GOING FORWARD:
    // index          0   1   2   3   4   5   6   7
    // clock          0   1   2   3   4   4   6   7
    // cur index                  |
    // toClock                        |   |
    // final index                        |
    // ----
    // cur index < final index
    // apply events at: [cur index + 1, final index]

    // GOING FORWARD:
    // index          0   1   2   3   4   5   6   7
    // clock          0   1   2   3   3   5   6   7
    // cur index                  |
    // toClock                    |   |
    // final index                    |
    // ----
    // cur index < final index
    // apply events at: [cur index + 1, final index]

    // GOING BACKWARD:
    // index          0   1   2   3   4   5   6   7
    // clock          0   1   1   3   4   5   6   7
    // cur index                  |
    // toClock            |   |
    // final index            |
    // ----
    // cur index > final index
    // unapply events at: [final index + 1, cur index] in reverse order

    const { editorEvents } = this.session.body;
    let direction = t.Direction.Forwards;
    let steps: SeekStep[] = [];

    if (this.eventIndex < finalIndex) {
      // Go forward
      const events = editorEvents.slice(this.eventIndex + 1, finalIndex + 1);
      steps = events.map((e, i) => ({ event: e, index: this.eventIndex + i + 1 }));
    } else if (this.eventIndex > finalIndex) {
      // Go backward
      const events = editorEvents.slice(finalIndex + 1, this.eventIndex + 1).reverse();
      steps = events.map((e, i) => ({ event: e, index: this.eventIndex - i }));
      direction = t.Direction.Backwards;
    }

    return { steps, direction };
  }

  async seek(toClock: number, uriSet?: t.UriSet) {
    await this.seekWithData(this.getSeekData(toClock), uriSet);
  }

  async seekWithData(seekData: SeekData, uriSet?: t.UriSet) {
    for (const step of seekData.steps) {
      await this.applySeekStep(step, seekData.direction, uriSet);
    }
    // this.finalizeSeek(seekData);
  }

  async applySeekStep(step: SeekStep, direction: t.Direction, uriSet?: t.UriSet) {
    await this.stepper.applyEditorEvent(step.event, direction, uriSet);
    this.eventIndex = step.index;
    if (direction === t.Direction.Backwards) {
      this.eventIndex--;
    }
  }

  // finalizeSeek(seekData: SeekData) {
  //   this.eventIndex = seekData.steps.at(-1)?.newEventIndex ?? this.eventIndex;
  // }
}

// export function seekHelper(
//   eventIndex: number,
//   finalIndex: number,
// ): { slice: [number, number]; direction: t.Direction } {
//   if (eventIndex <= finalIndex) {
//     return { slice: [eventIndex + 1, finalIndex + 1], direction: t.Direction.Forwards };
//   } else {
//     return { slice: [finalIndex + 1, eventIndex + 1], direction: t.Direction.Backwards };
//   }
// }
