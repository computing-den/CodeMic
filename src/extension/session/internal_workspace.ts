import { URI } from 'vscode-uri';
import _ from 'lodash';
import * as t from '../../lib/types.js';
import { LineRange, Selection, lastSortedIndex, getWorkspaceUriHierarchy } from '../../lib/lib.js';
import assert from '../../lib/assert.js';
import { LoadedSession } from './session.js';
import InternalWorkspaceStepper from './internal_workspace_stepper.js';
import InternalTextEditor from './internal_text_editor.js';
import InternalTextDocument from './internal_text_document.js';

// type LiveWorktree = Map<string, LiveWorktreeItem>;
// type LiveWorktreeItem = { file?: t.File; document?: t.InternalDocument; editor?: t.InternalEditor };

export type SeekStep = { event: t.EditorEvent; index: number };
export type SeekData = { steps: SeekStep[]; direction: t.Direction };

/**
 * If we have item.editor.document, then we must have item.document.
 */
export class LiveWorktreeItem {
  private closedDirtyDocument?: t.InternalDocument;

  constructor(
    public worktree: LiveWorktree,
    public readonly uri: string,
    private _file?: t.File,
    private _document?: t.InternalDocument,
    private _editor?: t.InternalEditor,
  ) {}

  get file(): t.File | undefined {
    return this._file;
  }

  get textDocument(): InternalTextDocument | undefined {
    if (this._document instanceof InternalTextDocument) return this._document;
  }

  get textEditor(): InternalTextEditor | undefined {
    if (this._editor instanceof InternalTextEditor) return this._editor;
  }

  setFile(file: t.File) {
    this._file = file;
  }

  closeFile() {
    this._file = undefined;
    this.possiblyDeleteSelf();
  }

  async getContent(): Promise<Uint8Array> {
    if (this._document) return this._document.getContent();
    if (this._file) return this.worktree.session.core.readFile(this._file);
    return new Uint8Array();
  }

  async getContentText(): Promise<string> {
    return new TextDecoder().decode(await this.getContent());
  }

  async isDirty(): Promise<boolean> {
    if (this.closedDirtyDocument) return true;

    const dContent = this._document?.getContent();
    if (dContent) {
      if (this._file) {
        const fContent = await this.worktree.session.core.readFile(this._file);
        const dBuffer = Buffer.from(dContent.buffer, dContent.byteOffset, dContent.byteLength);
        const fBuffer = Buffer.from(fContent.buffer, fContent.byteOffset, fContent.byteLength);
        return !dBuffer.equals(fBuffer);
      } else {
        return dContent.length > 0;
      }
    }

    return false;
  }

  async openTextDocument(opts?: { eol?: t.EndOfLine }): Promise<InternalTextDocument> {
    // Shortcut if document already open.
    if (this.textDocument) return this.textDocument;

    // Shortcut if document was closed while dirty.
    if (this.closedDirtyDocument) {
      assert(
        this.closedDirtyDocument instanceof InternalTextDocument,
        `internal dirty item is not a text document ${this.uri}`,
      );
      const document = this.closedDirtyDocument;
      this.closedDirtyDocument = undefined;

      if (this._editor) this._editor.document = document;
      return (this._document = document);
    }

    // Create new text document.
    const eol = opts?.eol ?? this.worktree.session.body.defaultEol;
    const buffer = await this.getContent();
    const document = InternalTextDocument.fromBuffer(this.uri, buffer, eol);

    // Update document and editor.
    if (this._editor) this._editor.document = document;
    return (this._document = document);
  }

  async closeTextDocument() {
    if (await this.isDirty()) {
      this.closedDirtyDocument = this._document;
    }
    this._document = undefined;
    if (this._editor) this._editor.document = undefined;
    this.possiblyDeleteSelf();
  }

  async openTextEditor(opts?: {
    selections?: Selection[];
    visibleRange?: LineRange;
    eol?: t.EndOfLine;
  }): Promise<InternalTextEditor> {
    // Shortcut if text editor already open with document.
    if (this.textEditor?.document) {
      if (opts?.selections) this.textEditor.select(opts.selections);
      if (opts?.visibleRange) this.textEditor.scroll(opts.visibleRange);
      return this.textEditor;
    }

    // Create new text editor.
    const document = await this.openTextDocument({ eol: opts?.eol });
    const editor = new InternalTextEditor(this.uri, document, opts?.selections, opts?.visibleRange);
    return (this._editor = editor);
  }

  closeTextEditor() {
    this._editor = undefined;
    this.possiblyDeleteSelf();
  }

  private possiblyDeleteSelf() {
    if (!this._file && !this._document && !this._editor && !this.closedDirtyDocument) {
      // Assert that it doesn't have children in worktree.
      if (URI.parse(this.uri).scheme === 'workspace') {
        const children = this.worktree.getUris().filter(uri => uri.startsWith(this.uri + '/'));
        assert(
          children.length === 0,
          `Trying to delete ${this.uri} from internal worktree, but it still has children: ${children.join(', ')}`,
        );
      }

      this.worktree.delete(this.uri);
    }
  }
}

/**
 * LiveWorktree is supposed to hold the entire workspace directory at a particular clock: every
 * file and directory and where to find their contents: dir, file with open TextDocument, or a
 * blob to be read from disk.
 * The file field represents the content on disk. Whereas the document field represents the loaded
 * document which is used in the text editor and it may be unsaved.
 * It is possible for any of the file, document, or editor to be undefined at any point.
 */
export class LiveWorktree {
  activeTextEditorUri?: string;
  private items = new Map<string, LiveWorktreeItem>();

  constructor(public session: LoadedSession) {}

  has(uri: string) {
    return this.items.has(uri);
  }

  get(uri: string): LiveWorktreeItem {
    assert(this.items.has(uri));
    return this.items.get(uri)!;
  }

  getOpt(uri: string): LiveWorktreeItem | undefined {
    return this.items.get(uri);
  }

  getUris(): string[] {
    return Array.from(this.items.keys());
  }

  getItems(): LiveWorktreeItem[] {
    return Array.from(this.items.values());
  }

  getTextDocuments(): InternalTextDocument[] {
    return _.compact(Array.from(this.items.values()).map(item => item.textDocument));
  }

  getTextEditors(): InternalTextEditor[] {
    return _.compact(Array.from(this.items.values()).map(item => item.textEditor));
  }

  add(
    uri: string,
    opts?: { file?: t.File; document?: t.InternalDocument; editor?: t.InternalEditor; createHierarchy?: boolean },
  ): LiveWorktreeItem {
    // insert parent directories
    if (opts?.createHierarchy && URI.parse(uri).scheme === 'workspace') {
      for (const parentUri of getWorkspaceUriHierarchy(uri).slice(0, -1)) {
        if (!this.has(parentUri)) this.add(parentUri, { file: { type: 'dir' } });
      }
    }
    assert(!this.has(uri));
    const item = new LiveWorktreeItem(this, uri, opts?.file, opts?.document, opts?.editor);
    this.items.set(uri, item);
    return item;
  }

  /**
   * Don't call directly. Meant to be used from within LiveWorktreeItem.
   */
  delete(uri: string) {
    this.items.delete(uri);
  }

  addOrUpdateFile(uri: string, file: t.File, opts?: { createHierarchy?: boolean }): LiveWorktreeItem {
    let item = this.items.get(uri);
    if (item) {
      item.setFile(file);
    } else {
      item = this.add(uri, { file, ...opts });
    }
    return item;
  }

  // closeTextEditor(uri: string) {
  //   this.items.get(uri)?.closeTextEditor();
  //   if (this.activeTextEditorUri === uri) {
  //     this.activeTextEditorUri = undefined;
  //   }
  // }
}

// Not every InternalTextDocument may be attached to a InternalTextEditor. At least not until the
// TextEditor is opened.
export default class InternalWorkspace {
  // eventIndex represents the index of the last event that was executed. That is, the effects of that event are visible.
  eventIndex: number;
  worktree: LiveWorktree;
  stepper: InternalWorkspaceStepper;

  constructor(public session: LoadedSession) {
    this.eventIndex = -1;
    this.worktree = new LiveWorktree(session);
    this.stepper = new InternalWorkspaceStepper(session, this);
  }

  /**
   * Returns the last event that was executed. That is, the effects of that event are visible.
   */
  getCurrentEvent(): t.EditorEvent | undefined {
    return this.session.body.editorEvents.at(this.eventIndex);
  }

  /**
   * Apply all events whose clock is 0.
   */
  async restoreInitState() {
    assert(this.eventIndex === -1, 'calling restoreInitState on an already initialized internal workspace');

    await this.seek(0);
  }

  getWorktreeItemByUriOpt(uri: string): LiveWorktreeItem | undefined {
    return this.worktree.get(uri);
  }

  getWorktreeItemByUri(uri: string): LiveWorktreeItem {
    const item = this.worktree.get(uri);
    if (!item) throw new Error(`${uri} not found in internal workspace`);
    return item;
  }

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
}
