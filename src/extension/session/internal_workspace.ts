import _ from 'lodash';
import * as t from '../../lib/types.js';
import * as path from '../../lib/path.js';
import assert from '../../lib/assert.js';
import Session from './session.js';
import InternalWorkspaceStepper from './internal_workspace_stepper.js';
import InternalTextEditor from './internal_text_editor.js';
import InternalTextDocument from './internal_text_document.js';

/**
 * If a document has been loaded into memory, then the latest content is in the document field and
 * it should always be retrieved from there.
 * Otherwise, its uri refers to the base file stored on disk.
 */
type LiveWorktreeItem = { file: t.File; document?: t.InternalDocument; editor?: t.InternalEditor };
type LiveWorktree = Map<t.Uri, LiveWorktreeItem>;

function makeLiveWorktree(worktree: t.Worktree): LiveWorktree {
  const map = new Map<t.Uri, LiveWorktreeItem>();
  for (const [key, file] of Object.entries(worktree)) {
    map.set(key, { file });
  }
  return map;
}

// Not every InternalTextDocument may be attached to a InternalTextEditor. At least not until the
// TextEditor is opened.
export default class InternalWorkspace {
  // These fields change with the clock/eventIndex
  // TODO sync the entire worktree structure including directories.
  // If a InternalTextDocument is in this.textDocuments, it is also in this.worktree.
  // If a InternalTextEditor is in this.textEditors, it is also in this.worktree.
  eventIndex: number;
  worktree: LiveWorktree;
  textDocuments: InternalTextDocument[];
  textEditors: InternalTextEditor[];
  activeTextEditor?: InternalTextEditor;
  stepper: InternalWorkspaceStepper;

  private constructor(public session: Session) {
    this.eventIndex = -1;
    this.worktree = new Map();
    this.textDocuments = [];
    this.textEditors = [];
    this.stepper = new InternalWorkspaceStepper(session);
  }

  get editorTrack(): t.InternalWorkspace {
    return this.session.body!.editorTrack;
  }

  static async fromSession(session: Session): Promise<InternalWorkspace> {
    const track = new InternalWorkspace(session);
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

  findTextDocumentByUri(uri: t.Uri): InternalTextDocument | undefined {
    const textDocument = this.worktree.get(uri)?.document;
    return textDocument instanceof InternalTextDocument ? textDocument : undefined;
  }

  findTextEditorByUri(uri: t.Uri): InternalTextEditor | undefined {
    const textEditor = this.worktree.get(uri)?.editor;
    return textEditor instanceof InternalTextEditor ? textEditor : undefined;
  }

  getTextDocumentByUri(uri: t.Uri): InternalTextDocument {
    const textDocument = this.findTextDocumentByUri(uri);
    assert(textDocument);
    return textDocument;
  }

  getTextEditorByUri(uri: t.Uri): InternalTextEditor {
    const textEditor = this.findTextEditorByUri(uri);
    assert(textEditor);
    return textEditor;
  }

  async openTextDocumentByUri(uri: t.Uri): Promise<InternalTextDocument> {
    const worktreeItem = this.worktree.get(uri);
    if (!worktreeItem) throw new Error(`file not found ${uri}`);

    if (worktreeItem.document) {
      if (!(worktreeItem.document instanceof InternalTextDocument)) {
        throw new Error(`file is not a text document ${uri}`);
      }
      return worktreeItem.document;
    }

    const text = new TextDecoder().decode(await this.session.readFile(worktreeItem.file));
    const textDocument = InternalTextDocument.fromText(uri, text, this.editorTrack.defaultEol);
    this.insertTextDocument(textDocument);
    return textDocument;
  }

  insertTextDocument(textDocument: InternalTextDocument) {
    const item = this.worktree.get(textDocument.uri) ?? { file: { type: 'empty' } };
    item.document = textDocument;
    this.worktree.set(textDocument.uri, item);
    this.textDocuments.push(textDocument);
  }

  async openTextEditorByUri(
    uri: t.Uri,
    selections?: t.Selection[],
    visibleRange?: t.Range,
  ): Promise<InternalTextEditor> {
    const worktreeItem = this.worktree.get(uri);
    if (!worktreeItem) throw new Error(`file not found ${uri}`);

    if (worktreeItem.editor) {
      if (!(worktreeItem.editor instanceof InternalTextEditor)) {
        throw new Error(`file is not a text document ${uri}`);
      }
      if (selections && visibleRange) {
        worktreeItem.editor.select(selections, visibleRange);
      }
      return worktreeItem.editor;
    }

    const textEditor = new InternalTextEditor(await this.openTextDocumentByUri(uri), selections, visibleRange);
    this.insertTextEditor(textEditor);
    return textEditor;
  }

  insertTextEditor(textEditor: InternalTextEditor) {
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

  async applySeekStep(seekData: t.SeekData, stepIndex: number, uriSet?: t.UriSet) {
    const event = seekData.events[stepIndex];
    assert(event, 'applySeekStep: out of bound event index');
    await this.stepper.applyEditorEvent(seekData.events[stepIndex], seekData.direction, uriSet);
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
}
