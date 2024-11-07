import _ from 'lodash';
import * as t from '../../lib/types.js';
import * as path from '../../lib/path.js';
import * as lib from '../../lib/lib.js';
import assert from '../../lib/assert.js';
import workspaceStepperDispatch from './workspace_stepper_dispatch.js';
import type Session from './session.js';
import InternalWorkspace from './internal_workspace.js';
import InternalTextDocument from './internal_text_document.js';

// Not every InternalTextDocument may be attached to a TextEditor. At least not until the
// TextEditor is opened.
class InternalWorkspaceStepper implements t.WorkspaceStepper {
  constructor(public session: Session) {}

  get internalWorkspace(): InternalWorkspace {
    return this.session.runtime!.internalWorkspace;
  }

  async applyEditorEvent(event: t.EditorEvent, uri: t.Uri, direction: t.Direction, uriSet?: t.UriSet) {
    await workspaceStepperDispatch(this, event, uri, direction, uriSet);
  }

  async applyInitEvent(e: t.InitEvent, uri: t.Uri, direction: t.Direction, uriSet?: t.UriSet) {
    if (uriSet) uriSet.add(uri);
    if (direction === t.Direction.Forwards) {
      this.internalWorkspace.worktree.set(uri, { file: e.file });
    } else {
      // If we want to reverse the init event, we must delete it from worktree as well as text documents and text editors.
      throw new Error('Cannot reverse init event');
    }
  }

  async applyTextChangeEvent(e: t.TextChangeEvent, uri: t.Uri, direction: t.Direction, uriSet?: t.UriSet) {
    if (uriSet) uriSet.add(uri);
    const textDocument = await this.internalWorkspace.openTextDocumentByUri(uri);
    if (direction === t.Direction.Forwards) {
      textDocument.applyContentChanges(e.contentChanges, false);
      if (e.updateSelection) {
        const textEditor = await this.internalWorkspace.openTextEditorByUri(uri);
        textEditor.select(lib.getSelectionsAfterTextChangeEvent(e));
      }
    } else {
      textDocument.applyContentChanges(e.revContentChanges, false);
      if (e.updateSelection) {
        const textEditor = await this.internalWorkspace.openTextEditorByUri(uri);
        textEditor.select(lib.getSelectionsBeforeTextChangeEvent(e));
      }
    }
  }

  async applyOpenTextDocumentEvent(e: t.OpenTextDocumentEvent, uri: t.Uri, direction: t.Direction, uriSet?: t.UriSet) {
    // The document may or may not exist in the worktree.
    // The content must be matched if e.text is given.

    if (uriSet) uriSet.add(uri);

    if (direction === t.Direction.Forwards) {
      let textDocument = this.internalWorkspace.findTextDocumentByUri(uri);
      if (textDocument && e.text !== undefined && e.text !== textDocument.getText()) {
        textDocument.applyContentChanges([{ range: textDocument.getRange(), text: e.text }], false);
      } else if (!textDocument) {
        let text = '';
        if (e.text !== undefined) {
          text = e.text;
        } else if (this.internalWorkspace.doesUriExist(uri)) {
          text = new TextDecoder().decode(await this.internalWorkspace.getContentByUri(uri));
        }
        textDocument = InternalTextDocument.fromText(uri, text, e.eol);
        this.internalWorkspace.insertTextDocument(textDocument); // Will insert into worktree if necessary.
      }
    } else {
      if (e.isInWorktree) {
        this.internalWorkspace.closeTextEditorByUri(uri);
      } else {
        this.internalWorkspace.closeAndRemoveTextDocumentByUri(uri);
      }
    }
  }

  async applyCloseTextDocumentEvent(
    e: t.CloseTextDocumentEvent,
    uri: t.Uri,
    direction: t.Direction,
    uriSet?: t.UriSet,
  ) {
    if (uriSet) uriSet.add(uri);

    assert(path.isUntitledUri(uri), 'Must only record closeTextDocument for untitled URIs');

    if (direction === t.Direction.Forwards) {
      this.internalWorkspace.closeAndRemoveTextDocumentByUri(uri);
    } else {
      this.internalWorkspace.insertTextDocument(InternalTextDocument.fromText(uri, e.revText, e.revEol));
    }
  }

  async applyShowTextEditorEvent(e: t.ShowTextEditorEvent, uri: t.Uri, direction: t.Direction, uriSet?: t.UriSet) {
    if (direction === t.Direction.Forwards) {
      if (uriSet) uriSet.add(uri);
      this.internalWorkspace.activeTextEditor = await this.internalWorkspace.openTextEditorByUri(
        uri,
        e.selections,
        e.visibleRange,
      );
    } else if (e.revUri) {
      if (uriSet) uriSet.add(e.revUri);
      this.internalWorkspace.activeTextEditor = await this.internalWorkspace.openTextEditorByUri(
        e.revUri,
        e.revSelections,
        e.revVisibleRange,
      );
    }
  }

  async applyCloseTextEditorEvent(e: t.CloseTextEditorEvent, uri: t.Uri, direction: t.Direction, uriSet?: t.UriSet) {
    if (uriSet) uriSet.add(uri);

    if (direction === t.Direction.Forwards) {
      this.internalWorkspace.closeTextEditorByUri(uri);
    } else {
      await this.internalWorkspace.openTextEditorByUri(uri, e.revSelections, e.revVisibleRange);
    }
  }

  async applySelectEvent(e: t.SelectEvent, uri: t.Uri, direction: t.Direction, uriSet?: t.UriSet) {
    if (uriSet) uriSet.add(uri);
    const textEditor = await this.internalWorkspace.openTextEditorByUri(uri);
    if (direction === t.Direction.Forwards) {
      textEditor.select(e.selections);
      // textEditor.scroll(e.visibleRange);
    } else {
      textEditor.select(e.revSelections);
      // textEditor.scroll(e.revVisibleRange);
    }
  }

  async applyScrollEvent(e: t.ScrollEvent, uri: t.Uri, direction: t.Direction, uriSet?: t.UriSet) {
    if (uriSet) uriSet.add(uri);
    const textEditor = await this.internalWorkspace.openTextEditorByUri(uri);
    if (direction === t.Direction.Forwards) {
      textEditor.scroll(e.visibleRange);
    } else {
      textEditor.scroll(e.revVisibleRange);
    }
  }

  async applySaveEvent(e: t.SaveEvent, uri: t.Uri, direction: t.Direction, uriSet?: t.UriSet) {
    if (uriSet) uriSet.add(uri);
    // nothing
  }
}
export default InternalWorkspaceStepper;
