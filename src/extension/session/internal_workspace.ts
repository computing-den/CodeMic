import * as path from 'path';
import { URI, Utils as URIUtils } from 'vscode-uri';
import _ from 'lodash';
import * as t from '../../lib/types.js';
import { LineRange, Selection, workspaceUri } from '../../lib/lib.js';
import assert from '../../lib/assert.js';
import { LoadedSession } from './session.js';
import InternalWorkspaceStepper from './internal_workspace_stepper.js';
import InternalTextEditor from './internal_text_editor.js';
import InternalTextDocument from './internal_text_document.js';

/**
 * LiveWorktree is supposed to hold the entire workspace directory at a particular clock: every
 * file and directory and where to find their contents: dir, file with open TextDocument, or a
 * blob to be read from disk.
 * If a document has been loaded into memory, then the latest content is in the document field and
 * it should always be retrieved from there.
 * Otherwise, its uri refers to the base file stored on disk.
 */
type LiveWorktree = Map<string, LiveWorktreeItem>;
type LiveWorktreeItem = { file: t.File; document?: t.InternalDocument; editor?: t.InternalEditor };

export type SeekStep = t.EditorEventWithUri & { newEventIndex: number };
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
    this.stepper = new InternalWorkspaceStepper(session);
  }

  /**
   * Returns the last event that was executed. That is, the effects of that event are visible.
   */
  getCurrentEvent(): t.EditorEventWithUri | undefined {
    return this.session.body.eventContainer.at(this.eventIndex);
  }

  async restoreInitState() {
    assert(this.eventIndex === -1, 'calling restoreInitState on an already initialized internal workspace');
    this.textDocuments = [];
    this.textEditors = [];

    // Apply all events whose clock is 0.
    await this.seek(this.getSeekData(0));
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

  async getContentByUri(uri: string): Promise<Uint8Array> {
    const item = this.worktree.get(uri);
    assert(item);

    if (item.document) {
      return item.document.getContent();
    }

    if (item.file.type === 'local') {
      return this.session.core.readFile(item.file);
    }

    if (item.file.type === 'empty') {
      return new Uint8Array();
    }

    throw new Error(`getContentByUri ${uri} type "${item.file}" not supported`);
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

  async openTextDocumentByUri(uri: string): Promise<InternalTextDocument> {
    const worktreeItem = this.worktree.get(uri);
    if (!worktreeItem) throw new Error(`file not found ${uri}`);

    if (worktreeItem.document) {
      if (!(worktreeItem.document instanceof InternalTextDocument)) {
        throw new Error(`file is not a text document ${uri}`);
      }
      return worktreeItem.document;
    }

    const text = new TextDecoder().decode(await this.session.core.readFile(worktreeItem.file));
    const textDocument = InternalTextDocument.fromText(uri, text, this.session.body.defaultEol);
    this.insertTextDocument(textDocument);
    return textDocument;
  }

  insertFile(uri: string, file: t.File): LiveWorktreeItem {
    let item = this.worktree.get(uri);
    if (item) {
      item.file = file;
    } else {
      console.log('XXX insertFile: ', uri);

      // insert parent directories
      const uriParsed = URI.parse(uri);
      if (uriParsed.scheme === 'workspace') {
        const components = uriParsed.fsPath.split('/');
        for (let i = 0; i < components.length - 1; i++) {
          const p = path.join(...components.slice(0, i + 1));
          const parentUri = workspaceUri(p);
          if (!this.worktree.has(parentUri)) {
            console.log('XXX insertFile parent: ', parentUri);
            this.worktree.set(parentUri, { file: { type: 'dir' } });
          }
        }
      }

      item = { file };
      this.worktree.set(uri, item);
    }
    return item;
  }

  insertTextDocument(textDocument: InternalTextDocument): LiveWorktreeItem {
    const item = this.worktree.get(textDocument.uri) ?? this.insertFile(textDocument.uri, { type: 'empty' });
    item.document = textDocument;
    if (!this.textDocuments.includes(textDocument)) {
      this.textDocuments.push(textDocument);
    }
    return item;
  }

  async openTextEditorByUri(
    uri: string,
    selections?: Selection[],
    visibleRange?: LineRange,
  ): Promise<InternalTextEditor> {
    const worktreeItem = this.worktree.get(uri);
    if (!worktreeItem) throw new Error(`file not found ${uri}`);

    if (worktreeItem.editor) {
      if (!(worktreeItem.editor instanceof InternalTextEditor)) {
        throw new Error(`file is not a text document ${uri}`);
      }
      if (selections && visibleRange) {
        worktreeItem.editor.select(selections);
        worktreeItem.editor.scroll(visibleRange);
      }
      return worktreeItem.editor;
    }

    const textEditor = new InternalTextEditor(await this.openTextDocumentByUri(uri), selections, visibleRange);
    this.insertTextEditor(textEditor);
    return textEditor;
  }

  insertTextEditor(textEditor: InternalTextEditor): LiveWorktreeItem {
    let item = this.worktree.get(textEditor.document.uri) ?? this.insertTextDocument(textEditor.document);
    item.editor = textEditor;
    if (!this.textEditors.includes(textEditor)) {
      this.textEditors.push(textEditor);
    }
    return item;
  }

  // toWorkspaceUri(p: string): string {
  //   return path.workspaceUriFromAbsPath(this.session.workspace, p);
  // }

  closeAndRemoveTextDocumentByUri(uri: string) {
    this.closeTextEditorByUri(uri);
    this.textDocuments = this.textDocuments.filter(x => x.uri !== uri);
    this.worktree.delete(uri);
  }

  closeTextEditorByUri(uri: string) {
    if (this.worktree.get(uri)?.editor) {
      this.worktree.get(uri)!.editor = undefined;
      this.textEditors = this.textEditors.filter(x => x.document.uri !== uri);
    }
    if (this.activeTextEditor?.document.uri === uri) {
      this.activeTextEditor = undefined;
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
    // FORWARD

    const ec = this.session.body.eventContainer;

    const end = ec.getIndexAfterClock(toClock);
    let direction = t.Direction.Forwards;
    const steps: SeekStep[] = [];

    if (this.eventIndex < end) {
      // Go forward
      const from = this.eventIndex + 1;
      ec.forEachExc(from, end, (e, i) => steps.push({ ...e, newEventIndex: i }));
    } else if (this.eventIndex > end) {
      // Go backward
      ec.forEachExc(this.eventIndex, end - 1, (e, i) => steps.push({ ...e, newEventIndex: i - 1 }));
      direction = t.Direction.Backwards;
    }

    return { steps, direction };
  }

  async seek(seekData: SeekData, uriSet?: t.UriSet) {
    for (const step of seekData.steps) {
      await this.applySeekStep(step, seekData.direction, uriSet);
    }
    this.finalizeSeek(seekData);
  }

  async applySeekStep(step: SeekStep, direction: t.Direction, uriSet?: t.UriSet) {
    await this.stepper.applyEditorEvent(step.event, step.uri, direction, uriSet);
    this.eventIndex = step.newEventIndex;
  }

  finalizeSeek(seekData: SeekData) {
    this.eventIndex = seekData.steps.at(-1)?.newEventIndex ?? this.eventIndex;
  }
}
