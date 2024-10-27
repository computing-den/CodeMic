import _ from 'lodash';
import * as t from '../../lib/types.js';
import * as path from '../../lib/path.js';
import assert from '../../lib/assert.js';
import workspaceStepperDispatch from './workspace_stepper_dispatch.js';
import type Session from './session.js';
import { InternalWorkspace, TextDocument } from './internal_workspace.js';

// Not every TextDocument may be attached to a TextEditor. At least not until the
// TextEditor is opened.
class InternalWorkspaceStepper implements t.WorkspaceStepper {
  constructor(public session: Session) {}

  get internalWorkspace(): InternalWorkspace {
    return this.session.ctrls!.internalWorkspace;
  }

  async applyEditorEvent(e: t.EditorEvent, direction: t.Direction, uriSet?: t.UriSet) {
    await workspaceStepperDispatch(this, e, direction, uriSet);
  }

  async applyTextChangeEvent(e: t.TextChangeEvent, direction: t.Direction, uriSet?: t.UriSet) {
    if (uriSet) uriSet[e.uri] = true;
    const textDocument = await this.internalWorkspace.openTextDocumentByUri(e.uri);
    if (direction === t.Direction.Forwards) {
      textDocument.applyContentChanges(e.contentChanges, false);
    } else {
      textDocument.applyContentChanges(e.revContentChanges, false);
    }
  }

  async applyOpenTextDocumentEvent(e: t.OpenTextDocumentEvent, direction: t.Direction, uriSet?: t.UriSet) {
    // The document may or may not exist in the worktree.
    // The content must be matched if e.text is given.

    if (uriSet) uriSet[e.uri] = true;

    if (direction === t.Direction.Forwards) {
      let textDocument = this.internalWorkspace.findTextDocumentByUri(e.uri);
      if (textDocument && e.text !== undefined && e.text !== textDocument.getText()) {
        textDocument.applyContentChanges([{ range: textDocument.getRange(), text: e.text }], false);
      } else if (!textDocument) {
        let text: string;
        if (e.text !== undefined) {
          text = e.text;
        } else if (path.isUntitledUri(e.uri)) {
          text = '';
        } else {
          text = new TextDecoder().decode(await this.internalWorkspace.getContentByUri(e.uri));
        }
        textDocument = TextDocument.fromText(e.uri, text, e.eol);
        this.internalWorkspace.insertTextDocument(textDocument); // Will insert into worktree if necessary.
      }
    } else {
      if (e.isInWorktree) {
        this.internalWorkspace.closeTextEditorByUri(e.uri);
      } else {
        this.internalWorkspace.closeAndRemoveTextDocumentByUri(e.uri);
      }
    }
  }

  async applyCloseTextDocumentEvent(e: t.CloseTextDocumentEvent, direction: t.Direction, uriSet?: t.UriSet) {
    if (uriSet) uriSet[e.uri] = true;

    assert(path.isUntitledUri(e.uri), 'Must only record closeTextDocument for untitled URIs');

    if (direction === t.Direction.Forwards) {
      this.internalWorkspace.closeAndRemoveTextDocumentByUri(e.uri);
    } else {
      this.internalWorkspace.insertTextDocument(TextDocument.fromText(e.uri, e.revText, e.revEol));
    }
  }

  async applyShowTextEditorEvent(e: t.ShowTextEditorEvent, direction: t.Direction, uriSet?: t.UriSet) {
    if (direction === t.Direction.Forwards) {
      if (uriSet) uriSet[e.uri] = true;
      this.internalWorkspace.activeTextEditor = await this.internalWorkspace.openTextEditorByUri(
        e.uri,
        e.selections,
        e.visibleRange,
      );
    } else if (e.revUri) {
      if (uriSet) uriSet[e.revUri] = true;
      this.internalWorkspace.activeTextEditor = await this.internalWorkspace.openTextEditorByUri(
        e.revUri,
        e.revSelections,
        e.revVisibleRange,
      );
    }
  }

  async applyCloseTextEditorEvent(e: t.CloseTextEditorEvent, direction: t.Direction, uriSet?: t.UriSet) {
    if (uriSet) uriSet[e.uri] = true;

    if (direction === t.Direction.Forwards) {
      this.internalWorkspace.closeTextEditorByUri(e.uri);
    } else {
      await this.internalWorkspace.openTextEditorByUri(e.uri, e.revSelections, e.revVisibleRange);
    }
  }

  async applySelectEvent(e: t.SelectEvent, direction: t.Direction, uriSet?: t.UriSet) {
    if (uriSet) uriSet[e.uri] = true;
    const textEditor = await this.internalWorkspace.openTextEditorByUri(e.uri);
    if (direction === t.Direction.Forwards) {
      textEditor.select(e.selections, e.visibleRange);
    } else {
      textEditor.select(e.revSelections, e.revVisibleRange);
    }
  }

  async applyScrollEvent(e: t.ScrollEvent, direction: t.Direction, uriSet?: t.UriSet) {
    if (uriSet) uriSet[e.uri] = true;
    const textEditor = await this.internalWorkspace.openTextEditorByUri(e.uri);
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
export default InternalWorkspaceStepper;
