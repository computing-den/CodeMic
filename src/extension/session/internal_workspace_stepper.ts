import { URI } from 'vscode-uri';
import _ from 'lodash';
import * as t from '../../lib/types.js';
import * as lib from '../../lib/lib.js';
import assert from '../../lib/assert.js';
import workspaceStepperDispatch from './workspace_stepper_dispatch.js';
import InternalWorkspace, { LiveWorktree } from './internal_workspace.js';
import InternalTextDocument from './internal_text_document.js';
import { LoadedSession } from './session.js';

// Not every InternalTextDocument may be attached to a TextEditor. At least not until the
// TextEditor is opened.
class InternalWorkspaceStepper implements t.WorkspaceStepper {
  constructor(private session: LoadedSession, private internalWorkspace: InternalWorkspace) {}

  get worktree(): LiveWorktree {
    return this.internalWorkspace.worktree;
  }

  async applyEditorEvent(event: t.EditorEvent, direction: t.Direction, uriSet?: t.UriSet) {
    await workspaceStepperDispatch(this, event, direction, uriSet);
  }

  async applyFsCreateEvent(e: t.FsCreateEvent, direction: t.Direction, uriSet?: t.UriSet) {
    if (uriSet) uriSet.add(e.uri);
    if (direction === t.Direction.Forwards) {
      this.worktree.addOrUpdateFile(e.uri, e.file, { createHierarchy: true });
    } else {
      this.worktree.get(e.uri).closeFile();
    }
  }

  async applyFsChangeEvent(e: t.FsChangeEvent, direction: t.Direction, uriSet?: t.UriSet) {
    if (uriSet) uriSet.add(e.uri);
    if (direction === t.Direction.Forwards) {
      this.worktree.get(e.uri).setFile(e.file);
    } else {
      this.worktree.get(e.uri).setFile(e.revFile);
    }
  }

  async applyFsDeleteEvent(e: t.FsDeleteEvent, direction: t.Direction, uriSet?: t.UriSet) {
    if (uriSet) uriSet.add(e.uri);
    if (direction === t.Direction.Forwards) {
      this.worktree.get(e.uri).closeFile();
    } else {
      this.worktree.addOrUpdateFile(e.uri, e.revFile, { createHierarchy: true });
    }
  }

  async applyTextChangeEvent(e: t.TextChangeEvent, direction: t.Direction, uriSet?: t.UriSet) {
    if (uriSet) uriSet.add(e.uri);
    const item = this.worktree.get(e.uri);
    const textDocument = item.textDocument;
    assert(textDocument);

    if (direction === t.Direction.Forwards) {
      textDocument.applyContentChanges(e.contentChanges, false);
      if (e.updateSelection) {
        await item.openTextEditor({ selections: lib.getSelectionsAfterTextChangeEvent(e) });
      }
    } else {
      textDocument.applyContentChanges(e.revContentChanges, false);
      if (e.updateSelection) {
        await item.openTextEditor({ selections: lib.getSelectionsBeforeTextChangeEvent(e) });
      }
    }
  }

  async applyOpenTextDocumentEvent(e: t.OpenTextDocumentEvent, direction: t.Direction, uriSet?: t.UriSet) {
    if (uriSet) uriSet.add(e.uri);

    if (direction === t.Direction.Forwards) {
      const item = this.worktree.getOpt(e.uri) ?? this.worktree.add(e.uri);
      await item.openTextDocument({ eol: e.eol, languageId: e.languageId });
    } else {
      await this.worktree.get(e.uri).closeTextDocument();
    }
  }

  async applyCloseTextDocumentEvent(e: t.CloseTextDocumentEvent, direction: t.Direction, uriSet?: t.UriSet) {
    if (uriSet) uriSet.add(e.uri);

    if (direction === t.Direction.Forwards) {
      await this.worktree.get(e.uri).closeTextDocument();
    } else {
      const item = this.worktree.getOpt(e.uri) ?? this.worktree.add(e.uri);
      const textDocument = await item.openTextDocument({ eol: e.revEol, languageId: e.revLanguageId });
      if (e.revText !== undefined) {
        textDocument.applyContentChanges([{ range: textDocument.getRange(), text: e.revText }], false);
      }
    }
  }

  async applyUpdateTextDocumentEvent(e: t.UpdateTextDocumentEvent, direction: t.Direction, uriSet?: t.UriSet) {
    if (uriSet) uriSet.add(e.uri);

    const textDocument = this.worktree.get(e.uri).textDocument;
    assert(textDocument);
    if (direction === t.Direction.Forwards) {
      textDocument.languageId = e.languageId;
    } else {
      textDocument.languageId = e.revLanguageId;
    }
  }

  async applyShowTextEditorEvent(e: t.ShowTextEditorEvent, direction: t.Direction, uriSet?: t.UriSet) {
    // In v1, revSelection and revVisibleRange referred to the revUri editor.
    // In v2, revSelection and revVisibleRange refer to the uri editor while the selection
    // and the visible range of the revUri remain untouched.
    // recorderVersion: undefined means latest version.
    //
    // In v1, showTextEditor is not necessarily preceded by an openTextDocument.
    // In v2, the recorder makes sure that showTextEditor is preceded by an openTextDocument.

    if (e.recorderVersion === 1) {
      if (direction === t.Direction.Forwards) {
        if (uriSet) uriSet.add(e.uri);

        const item = this.worktree.get(e.uri);
        if (!item.textDocument) {
          await item.openTextDocument({
            eol: this.session.body.defaultEol,
            languageId: lib.getLangaugeIdFromUri(e.uri),
          });
        }
        await item.openTextEditor({ selections: e.selections, visibleRange: e.visibleRange });
        this.worktree.activeTextEditorUri = e.uri;
      } else {
        if (e.revUri) {
          if (uriSet) uriSet.add(e.revUri);
          const item = this.worktree.get(e.revUri);
          await item.openTextEditor({ selections: e.revSelections, visibleRange: e.revVisibleRange });
          this.worktree.activeTextEditorUri = e.revUri;
        }

        // If this showTextEditor event was to open e.uri for the first time,
        // close it.
        if (e.justOpened) {
          if (uriSet) uriSet.add(e.uri);
          this.worktree.get(e.uri).closeTextEditor();
        }
      }
    } else {
      if (direction === t.Direction.Forwards) {
        if (uriSet) uriSet.add(e.uri);
        const item = this.worktree.get(e.uri);
        await item.openTextEditor({ selections: e.selections, visibleRange: e.visibleRange });
        this.worktree.activeTextEditorUri = e.uri;
      } else {
        // Reverse e.uri's text editor's selection and visible range.
        if (uriSet) uriSet.add(e.uri);
        const item = this.worktree.get(e.uri);
        assert(item.textEditor);
        if (e.revSelections) item.textEditor.select(e.revSelections);
        if (e.revVisibleRange) item.textEditor.scroll(e.revVisibleRange);

        // Go back to e.revUri if any or clear active text editor.
        if (e.revUri && uriSet) uriSet.add(e.revUri);
        this.worktree.activeTextEditorUri = e.revUri;

        // If this showTextEditor event was to open e.uri for the first time,
        // close it.
        if (e.justOpened) {
          item.closeTextEditor();
        }
      }
    }
  }

  async applyCloseTextEditorEvent(e: t.CloseTextEditorEvent, direction: t.Direction, uriSet?: t.UriSet) {
    if (uriSet) uriSet.add(e.uri);

    if (direction === t.Direction.Forwards) {
      this.worktree.get(e.uri).closeTextEditor();
      if (this.worktree.activeTextEditorUri === e.uri) {
        this.worktree.activeTextEditorUri = undefined;
      }
    } else {
      const item = this.worktree.getOpt(e.uri) ?? this.worktree.add(e.uri);
      await item.openTextEditor({ selections: e.revSelections, visibleRange: e.revVisibleRange });
      if (e.active) this.worktree.activeTextEditorUri = e.uri;
    }
  }

  async applySelectEvent(e: t.SelectEvent, direction: t.Direction, uriSet?: t.UriSet) {
    if (uriSet) uriSet.add(e.uri);
    const textEditor = this.worktree.get(e.uri).textEditor;
    assert(textEditor);

    if (direction === t.Direction.Forwards) {
      textEditor.select(e.selections);
    } else {
      textEditor.select(e.revSelections);
    }
  }

  async applyScrollEvent(e: t.ScrollEvent, direction: t.Direction, uriSet?: t.UriSet) {
    if (uriSet) uriSet.add(e.uri);
    const textEditor = this.worktree.get(e.uri).textEditor;
    assert(textEditor);

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
