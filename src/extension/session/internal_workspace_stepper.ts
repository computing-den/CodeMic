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

  async applyFsCreateEvent(e: t.FsCreateEvent, direction: t.Direction, uriSet?: t.UriSet) {
    if (uriSet) uriSet.add(e.uri);
    if (direction === t.Direction.Forwards) {
      this.internalWorkspace.insertOrUpdateFile(e.uri, e.file);
    } else {
      this.internalWorkspace.deleteFileByUri(e.uri);
    }
  }

  async applyFsChangeEvent(e: t.FsChangeEvent, direction: t.Direction, uriSet?: t.UriSet) {
    if (uriSet) uriSet.add(e.uri);
    const item = this.internalWorkspace.getWorktreeItemByUri(e.uri);
    if (direction === t.Direction.Forwards) {
      item.file = e.file;
    } else {
      item.file = e.revFile;
    }
  }

  async applyFsDeleteEvent(e: t.FsDeleteEvent, direction: t.Direction, uriSet?: t.UriSet) {
    if (uriSet) uriSet.add(e.uri);
    if (direction === t.Direction.Forwards) {
      this.internalWorkspace.deleteFileByUri(e.uri);
    } else {
      this.internalWorkspace.insertOrUpdateFile(e.uri, e.revFile);
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
    if (uriSet) uriSet.add(e.uri);

    if (direction === t.Direction.Forwards) {
      // Even untitled uris have fsCreate before openTextDocument.
      await this.internalWorkspace.openTextDocumentByUri(e.uri, e.eol);
    } else {
      this.internalWorkspace.closeTextDocumentByUri(e.uri);
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
    // In v1, revSelection and revVisibleRange referred to the revUri editor.
    // In v2, revSelection and revVisibleRange refer to the uri editor while the selection
    // and the visible range of the revUri remain untouched.
    // recorderVersion: undefined means latest version.

    if (e.recorderVersion === 1) {
      if (direction === t.Direction.Forwards) {
        if (uriSet) uriSet.add(e.uri);
        const textEditor = await this.internalWorkspace.openTextEditorByUri(e.uri, e.selections, e.visibleRange);
        this.internalWorkspace.activeTextEditor = textEditor;
      } else if (e.revUri) {
        if (uriSet) uriSet.add(e.revUri);
        const textEditor = await this.internalWorkspace.openTextEditorByUri(
          e.revUri,
          e.revSelections,
          e.revVisibleRange,
        );
        this.internalWorkspace.activeTextEditor = textEditor;
      }
    } else {
      if (direction === t.Direction.Forwards) {
        if (uriSet) uriSet.add(e.uri);
        const textEditor = await this.internalWorkspace.openTextEditorByUri(e.uri, e.selections, e.visibleRange);
        this.internalWorkspace.activeTextEditor = textEditor;
      } else {
        // Reverse e.uri's text editor's selection and visible range.
        if (uriSet) uriSet.add(e.uri);
        const textEditor = this.internalWorkspace.getTextEditorByUri(e.uri);
        if (e.revSelections) textEditor.select(e.revSelections);
        if (e.revVisibleRange) textEditor.scroll(e.revVisibleRange);

        // Go back to e.revUri if any or clear active text editor.
        if (e.revUri) {
          if (uriSet) uriSet.add(e.revUri);
          const revTextEditor = this.internalWorkspace.getTextEditorByUri(e.revUri);
          this.internalWorkspace.activeTextEditor = revTextEditor;
        } else {
          this.internalWorkspace.activeTextEditor = undefined;
        }
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
