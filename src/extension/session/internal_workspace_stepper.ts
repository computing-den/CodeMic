import { URI } from 'vscode-uri';
import _ from 'lodash';
import * as t from '../../lib/types.js';
import * as lib from '../../lib/lib.js';
import assert from '../../lib/assert.js';
import workspaceStepperDispatch from './workspace_stepper_dispatch.js';
import InternalWorkspace from './internal_workspace.js';
import InternalTextDocument from './internal_text_document.js';
import { LoadedSession } from './session.js';

// Not every InternalTextDocument may be attached to a TextEditor. At least not until the
// TextEditor is opened.
class InternalWorkspaceStepper implements t.WorkspaceStepper {
  constructor(private session: LoadedSession, private internalWorkspace: InternalWorkspace) {}

  async applyEditorEvent(event: t.EditorEvent, direction: t.Direction, uriSet?: t.UriSet) {
    await workspaceStepperDispatch(this, event, direction, uriSet);
  }

  async applyStoreEvent(e: t.StoreEvent, direction: t.Direction, uriSet?: t.UriSet) {
    if (uriSet) uriSet.add(e.uri);
    if (direction === t.Direction.Forwards) {
      this.internalWorkspace.insertFile(e.uri, e.file);
    } else {
      // If we want to reverse the store event, we must delete it from worktree as well as text documents and text editors.
      throw new Error('Cannot reverse store event');
    }
  }

  async applyTextChangeEvent(e: t.TextChangeEvent, direction: t.Direction, uriSet?: t.UriSet) {
    if (uriSet) uriSet.add(e.uri);
    const textDocument = await this.internalWorkspace.openTextDocumentByUri(e.uri);
    if (direction === t.Direction.Forwards) {
      textDocument.applyContentChanges(e.contentChanges, false);
      if (e.updateSelection) {
        const textEditor = await this.internalWorkspace.openTextEditorByUri(e.uri);
        textEditor.select(lib.getSelectionsAfterTextChangeEvent(e));
      }
    } else {
      textDocument.applyContentChanges(e.revContentChanges, false);
      if (e.updateSelection) {
        const textEditor = await this.internalWorkspace.openTextEditorByUri(e.uri);
        textEditor.select(lib.getSelectionsBeforeTextChangeEvent(e));
      }
    }
  }

  async applyOpenTextDocumentEvent(e: t.OpenTextDocumentEvent, direction: t.Direction, uriSet?: t.UriSet) {
    // The document may or may not exist in the worktree.
    // The content must be matched if e.text is given.

    if (uriSet) uriSet.add(e.uri);

    if (direction === t.Direction.Forwards) {
      let textDocument = this.internalWorkspace.findTextDocumentByUri(e.uri);
      if (textDocument && e.text !== undefined && e.text !== textDocument.getText()) {
        textDocument.applyContentChanges([{ range: textDocument.getRange(), text: e.text }], false);
      } else if (!textDocument) {
        let text = '';
        if (e.text !== undefined) {
          text = e.text;
        } else if (this.internalWorkspace.doesUriExist(e.uri)) {
          text = new TextDecoder().decode(await this.internalWorkspace.getContentByUri(e.uri));
        }
        textDocument = InternalTextDocument.fromText(e.uri, text, e.eol);
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
    throw new Error('TODO');
    // if (uriSet) uriSet.add(uri);

    // assert(URI.parse(uri).scheme === 'untitled', 'Must only record closeTextDocument for untitled URIs');

    // if (direction === t.Direction.Forwards) {
    //   this.internalWorkspace.closeAndRemoveTextDocumentByUri(uri);
    // } else {
    //   this.internalWorkspace.insertTextDocument(InternalTextDocument.fromText(uri, e.revText, e.revEol));
    // }
  }

  async applyShowTextEditorEvent(e: t.ShowTextEditorEvent, direction: t.Direction, uriSet?: t.UriSet) {
    if (direction === t.Direction.Forwards) {
      if (uriSet) uriSet.add(e.uri);
      const textEditor = await this.internalWorkspace.openTextEditorByUri(e.uri, e.selections, e.visibleRange);
      if (!e.preserveFocus) {
        this.internalWorkspace.activeTextEditor = textEditor;
      }
    } else if (e.revUri) {
      if (uriSet) uriSet.add(e.revUri);
      const textEditor = await this.internalWorkspace.openTextEditorByUri(e.revUri, e.revSelections, e.revVisibleRange);
      if (!e.preserveFocus) {
        this.internalWorkspace.activeTextEditor = textEditor;
      }
    }
  }

  async applyCloseTextEditorEvent(e: t.CloseTextEditorEvent, direction: t.Direction, uriSet?: t.UriSet) {
    if (uriSet) uriSet.add(e.uri);

    if (direction === t.Direction.Forwards) {
      this.internalWorkspace.closeTextEditorByUri(e.uri);
    } else {
      await this.internalWorkspace.openTextEditorByUri(e.uri, e.revSelections, e.revVisibleRange);
    }
  }

  async applySelectEvent(e: t.SelectEvent, direction: t.Direction, uriSet?: t.UriSet) {
    if (uriSet) uriSet.add(e.uri);
    const textEditor = await this.internalWorkspace.openTextEditorByUri(e.uri);
    if (direction === t.Direction.Forwards) {
      textEditor.select(e.selections);
      // textEditor.scroll(e.visibleRange);
    } else {
      textEditor.select(e.revSelections);
      // textEditor.scroll(e.revVisibleRange);
    }
  }

  async applyScrollEvent(e: t.ScrollEvent, direction: t.Direction, uriSet?: t.UriSet) {
    if (uriSet) uriSet.add(e.uri);
    const textEditor = await this.internalWorkspace.openTextEditorByUri(e.uri);
    if (direction === t.Direction.Forwards) {
      textEditor.scroll(e.visibleRange);
    } else {
      textEditor.scroll(e.revVisibleRange);
    }
  }

  async applySaveEvent(e: t.SaveEvent, direction: t.Direction, uriSet?: t.UriSet) {
    if (uriSet) uriSet.add(e.uri);
    // nothing
  }

  async applyTextInsertEvent(e: t.TextInsertEvent, direction: t.Direction, uriSet?: t.UriSet) {
    await this.applyTextChangeEvent(lib.getTextChangeEventFromTextInsertEvent(e), direction, uriSet);
  }
}
export default InternalWorkspaceStepper;
