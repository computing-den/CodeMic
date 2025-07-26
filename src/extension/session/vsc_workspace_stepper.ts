import * as t from '../../lib/types.js';
import * as lib from '../../lib/lib.js';
import assert from '../../lib/assert.js';
import workspaceStepperDispatch from './workspace_stepper_dispatch.js';
import type { SeekStep } from './internal_workspace.js';
import * as vscode from 'vscode';
import fs from 'fs';
import _ from 'lodash';
import { LoadedSession } from './session.js';
import VscWorkspace from './vsc_workspace.js';
import { URI } from 'vscode-uri';
import * as storage from '../storage.js';
import config from '../config.js';
import InternalWorkspace from './internal_workspace.js';

class VscWorkspaceStepper implements t.WorkspaceStepper {
  constructor(
    private session: LoadedSession,
    private internalWorkspace: InternalWorkspace,
    private vscWorkspace: VscWorkspace,
  ) {}

  async applyEditorEvent(e: t.EditorEvent, direction: t.Direction) {
    await this.logBeforeAfterStep(e, direction, true);
    await workspaceStepperDispatch(this, e, direction);
    await this.logBeforeAfterStep(e, direction, false);
  }

  private async logBeforeAfterStep(e: t.EditorEvent, direction: t.Direction, before: boolean) {
    if (!config.logVscWorkspaceStepper) return;

    // const data = before
    //   ? '-'
    //   : await this.vscWorkspace.deferRestoreTextEditorByVscUri(async () => {
    //       const vscTextEditor = await this.vscWorkspace.showTextDocumentByUri('workspace:src/main.c');
    //       return JSON.stringify(VscWorkspace.fromVscSelection(vscTextEditor.selection));
    //     });
    const data = '-';

    const prefix = before ? 'applyEditorEvent' : '----------------';
    const line = `${prefix} ${direction === 0 ? '->' : '<-'} ${e.id} ${e.type} to ${e.uri}`;
    console.log(`${line}: ${data}`);
  }

  async applySeekStep(step: SeekStep, direction: t.Direction) {
    await this.applyEditorEvent(step.event, direction);
    // this.eventIndex = step.newEventIndex;
  }

  async applyFsCreateEvent(e: t.FsCreateEvent, direction: t.Direction) {
    if (direction === t.Direction.Forwards) {
      await this.writeUnderlyingFileWithoutChangingDocument(e.uri, e.file);
    } else {
      await fs.promises.rm(URI.parse(this.session.core.resolveUri(e.uri)).fsPath, { recursive: true, force: true });
    }
  }

  async applyFsChangeEvent(e: t.FsChangeEvent, direction: t.Direction) {
    const file = direction === t.Direction.Forwards ? e.file : e.revFile;
    await this.writeUnderlyingFileWithoutChangingDocument(e.uri, file);
  }

  async applyFsDeleteEvent(e: t.FsDeleteEvent, direction: t.Direction) {
    if (direction === t.Direction.Forwards) {
      await fs.promises.rm(URI.parse(this.session.core.resolveUri(e.uri)).fsPath, { recursive: true, force: true });
    } else {
      await this.writeUnderlyingFileWithoutChangingDocument(e.uri, e.revFile);
    }
  }

  async applyTextChangeEvent(e: t.TextChangeEvent, direction: t.Direction) {
    // // We use WorkspaceEdit here because we don't necessarily want to focus on the text editor yet.
    // // There will be a separate select event after this if the editor had focus during recording.

    const vscUri = this.vscWorkspace.uriToVsc(e.uri);
    await this.vscWorkspace.deferRestoreTextEditorByVscUri(async () => {
      const vscTextEditor = await this.vscWorkspace.showTextDocumentByVscUri(vscUri);
      const success = await vscTextEditor.edit(builder => {
        if (direction === t.Direction.Forwards) {
          for (const cc of e.contentChanges) {
            builder.replace(VscWorkspace.toVscRange(cc.range), cc.text);
          }
        } else {
          for (const cc of e.revContentChanges) {
            builder.replace(VscWorkspace.toVscRange(cc.range), cc.text);
          }
        }
      });
      assert(success, 'vscode text editor edit failed');

      if (e.updateSelection) {
        if (direction === t.Direction.Forwards) {
          vscTextEditor.selections = VscWorkspace.toVscSelections(lib.getSelectionsAfterTextChangeEvent(e));
        } else {
          vscTextEditor.selections = VscWorkspace.toVscSelections(lib.getSelectionsBeforeTextChangeEvent(e));
        }
      }
    });
  }

  async applyOpenTextDocumentEvent(e: t.OpenTextDocumentEvent, direction: t.Direction) {
    if (direction === t.Direction.Forwards) {
      await this.openTextDocument(e.uri, e.languageId, e.eol);
    } else {
      await this.vscWorkspace.closeVscTextEditorByUri(e.uri, { skipConfirmation: true });

      // Cannot close vscode text document directly.
      // We don't want to revert and close a dirty document. The only way vscode,
      // issues a closeTextDocument on a dirty document is when switching language ID.
      // const item = this.internalWorkspace.worktree.getOpt(e.uri);
      // if (!(await item?.isDirty())) {
      //   await this.vscWorkspace.closeVscTextEditorByUri(e.uri, { skipConfirmation: true });
      // }
    }
  }

  async applyCloseTextDocumentEvent(e: t.CloseTextDocumentEvent, direction: t.Direction) {
    if (direction === t.Direction.Forwards) {
      await this.vscWorkspace.closeVscTextEditorByUri(e.uri, { skipConfirmation: true });

      // // Cannot close vscode text document directly.
      // // We don't want to revert and close a dirty document. The only way vscode,
      // // issues a closeTextDocument on a dirty document is when switching language ID.
      // const item = this.internalWorkspace.worktree.getOpt(e.uri);
      // if (!(await item?.isDirty())) {
      //   await this.vscWorkspace.closeVscTextEditorByUri(e.uri, { skipConfirmation: true });
      // }
    } else {
      await this.openTextDocument(e.uri, e.revLanguageId, e.revEol);
    }
  }

  async applyUpdateTextDocumentEvent(e: t.UpdateTextDocumentEvent, direction: t.Direction) {
    let vscTextDocument = await this.vscWorkspace.openTextDocumentByUri(e.uri);
    if (direction === t.Direction.Forwards) {
      if (e.eol) {
        await this.vscWorkspace.deferRestoreTextEditorByVscUri(async () => {
          const vscTextEditor = await vscode.window.showTextDocument(vscTextDocument);
          const success = await vscTextEditor.edit(builder => {
            builder.setEndOfLine(VscWorkspace.toVscEol(e.eol!));
          });
          assert(success, 'vscode text editor edit failed');
        });
      }
      if (e.languageId) {
        vscTextDocument = await vscode.languages.setTextDocumentLanguage(vscTextDocument, e.languageId);
      }
    } else if (direction === t.Direction.Backwards) {
      if (e.revEol) {
        await this.vscWorkspace.deferRestoreTextEditorByVscUri(async () => {
          const vscTextEditor = await vscode.window.showTextDocument(vscTextDocument);
          const success = await vscTextEditor.edit(builder => {
            builder.setEndOfLine(VscWorkspace.toVscEol(e.revEol!));
          });
          assert(success, 'vscode text editor edit failed');
        });
      }
      if (e.revLanguageId) {
        vscTextDocument = await vscode.languages.setTextDocumentLanguage(vscTextDocument, e.revLanguageId);
      }
    }
  }

  async applyShowTextEditorEvent(e: t.ShowTextEditorEvent, direction: t.Direction) {
    // console.log(
    //   `vsc stepper: applyShowTextEditor ${direction === 0 ? 'forward' : 'backward'}: ${
    //     e.uri
    //   }   (at ${performance.now()})`,
    // );
    // In v1, revSelection and revVisibleRange referred to the revUri editor.
    // In v2, revSelection and revVisibleRange refer to the uri editor while the selection
    // and the visible range of the revUri remain untouched.
    // recorderVersion: undefined means latest version.
    //
    // In v1, showTextEditor is not necessarily preceded by an openTextDocument.
    // In v2, the recorder makes sure that showTextEditor is preceded by an openTextDocument.

    if (e.recorderVersion === 1) {
      if (direction === t.Direction.Forwards) {
        const vscTextEditor = await this.vscWorkspace.showTextDocumentByUri(e.uri, { preserveFocus: false });
        if (e.selections) {
          vscTextEditor.selections = VscWorkspace.toVscSelections(e.selections);
        }
        if (e.visibleRange) {
          await vscode.commands.executeCommand('revealLine', { lineNumber: e.visibleRange.start, at: 'top' });
        }
      } else {
        if (e.revUri) {
          const vscTextEditor = await this.vscWorkspace.showTextDocumentByUri(e.revUri, { preserveFocus: false });
          if (e.revSelections) {
            vscTextEditor.selections = VscWorkspace.toVscSelections(e.revSelections);
          }
          if (e.revVisibleRange) {
            await vscode.commands.executeCommand('revealLine', { lineNumber: e.revVisibleRange.start, at: 'top' });
          }
        }

        // If this showTextEditor event was to open e.uri for the first time,
        // close it.
        if (e.justOpened) {
          await this.vscWorkspace.closeVscTextEditorByUri(e.uri, { skipConfirmation: true });
        }
      }
    } else {
      if (direction === t.Direction.Forwards) {
        const vscTextEditor = await this.vscWorkspace.showTextDocumentByUri(e.uri, { preserveFocus: false });
        if (e.selections) {
          vscTextEditor.selections = VscWorkspace.toVscSelections(e.selections);
        }
        if (e.visibleRange) {
          await vscode.commands.executeCommand('revealLine', { lineNumber: e.visibleRange.start, at: 'top' });
        }
      } else {
        // Reverse text e.uri's text editor's selection and visible range.
        assert(vscode.window.activeTextEditor, `Expected active text editor to be ${e.uri}, but none is open`);
        const vscActiveUri = this.vscWorkspace.uriFromVsc(vscode.window.activeTextEditor.document.uri);
        assert(vscActiveUri === e.uri, `Expected active text editor to be ${e.uri}, but it is ${vscActiveUri}`);
        if (e.revSelections) {
          vscode.window.activeTextEditor.selections = VscWorkspace.toVscSelections(e.revSelections);
        }
        if (e.revVisibleRange) {
          await vscode.commands.executeCommand('revealLine', { lineNumber: e.revVisibleRange.start, at: 'top' });
        }

        // Go back to e.revUri if any and set its selections and visible range based on internal text editor.
        // If there's no e.revUri, clear active text editor.
        if (e.revUri) {
          const vscTextEditor = await this.vscWorkspace.showTextDocumentByUri(e.revUri);
          const internalTextEditor = this.internalWorkspace.worktree.get(e.revUri).textEditor;
          assert(internalTextEditor);
          vscTextEditor.selections = VscWorkspace.toVscSelections(internalTextEditor.selections);
          await vscode.commands.executeCommand('revealLine', {
            lineNumber: internalTextEditor.visibleRange.start,
            at: 'top',
          });
        }

        // If this showTextEditor event was to open e.uri for the first time,
        // close it.
        if (e.justOpened) {
          await this.vscWorkspace.closeVscTextEditorByUri(e.uri, { skipConfirmation: true });
        }
      }
    }
  }

  async applyCloseTextEditorEvent(e: t.CloseTextEditorEvent, direction: t.Direction) {
    if (direction === t.Direction.Forwards) {
      await this.vscWorkspace.closeVscTextEditorByUri(e.uri, { skipConfirmation: true });
    } else {
      const vscTextEditor = await this.vscWorkspace.showTextDocumentByUri(e.uri);
      if (e.revSelections) {
        vscTextEditor.selections = VscWorkspace.toVscSelections(e.revSelections);
      }
      if (e.revVisibleRange) {
        await vscode.commands.executeCommand('revealLine', { lineNumber: e.revVisibleRange.start, at: 'top' });
      }
    }
  }

  async applySelectEvent(e: t.SelectEvent, direction: t.Direction) {
    const vscTextEditor = await this.vscWorkspace.showTextDocumentByUri(e.uri, { preserveFocus: false });

    if (direction === t.Direction.Forwards) {
      vscTextEditor.selections = VscWorkspace.toVscSelections(e.selections);
    } else {
      vscTextEditor.selections = VscWorkspace.toVscSelections(e.revSelections);
    }
  }

  async applyScrollEvent(e: t.ScrollEvent, direction: t.Direction) {
    await this.vscWorkspace.showTextDocumentByUri(e.uri, { preserveFocus: false });

    if (direction === t.Direction.Forwards) {
      await vscode.commands.executeCommand('revealLine', { lineNumber: e.visibleRange.start, at: 'top' });
    } else {
      await vscode.commands.executeCommand('revealLine', { lineNumber: e.revVisibleRange.start, at: 'top' });
    }
  }

  async applySaveEvent(e: t.SaveEvent, direction: t.Direction) {
    // NOTE: This is only for old body format v1. We no longer store save events.
    // NOTE: if we open an untitled document and then save it, the save event
    //       sometimes comes before the openTextDocument event.

    if (direction === t.Direction.Forwards) {
      let vscTextDocument = this.vscWorkspace.findVscTextDocumentByUri(e.uri);
      if (!vscTextDocument) return;

      await storage.writeString(vscTextDocument.uri.fsPath, vscTextDocument.getText());
      vscTextDocument = await this.vscWorkspace.revertVscTextDocument(vscTextDocument, {
        restoreEol: true,
        restoreLanguageId: true,
      });
    } else {
      // nothing
    }
  }

  async applyTextInsertEvent(e: t.TextInsertEvent, direction: t.Direction) {
    await this.applyTextChangeEvent(lib.getTextChangeEventFromTextInsertEvent(e), direction);
  }

  private async writeUnderlyingFileWithoutChangingDocument(uri: string, file: t.File) {
    let vscTextDocument = this.vscWorkspace.findVscTextDocumentByUri(uri);
    const originalText = vscTextDocument?.getText();

    // Writing the file may automatically revert the document in vscode if it wasn't dirty.
    await this.session.core.writeFile(uri, file);

    // We revert the document so that vscode won't later warn about the file having
    // been changed when we try to save the file.
    //
    // Then, if the text in the document was different from what's now in the
    // file, we restore that text.
    if (vscTextDocument) {
      await this.vscWorkspace.deferRestoreTextEditorByVscUri(async () => {
        vscTextDocument = await this.vscWorkspace.revertVscTextDocument(vscTextDocument!, {
          restoreEol: true,
          restoreLanguageId: true,
        });
        const textInFile = await this.session.core.readFile(file, 'utf8');
        if (originalText !== textInFile) {
          await this.replaceTextDocumentContent(vscTextDocument, originalText!);
        }
      });
    }
  }

  private async replaceTextDocumentContent(vscTextDocument: vscode.TextDocument, text: string) {
    const vscTextEditor = await vscode.window.showTextDocument(vscTextDocument);
    const success = await vscTextEditor.edit(builder => {
      builder.replace(this.vscWorkspace.getVscTextDocumentVscRange(vscTextDocument), text);
    });
    assert(success, 'vscode text editor edit failed');
  }

  private async openTextDocument(uri: string, languageId: string, eol: t.EndOfLine) {
    const vscTextDocument = await this.vscWorkspace.openTextDocumentByUri(uri, { createFileIfNecessary: true });
    if (vscTextDocument.languageId !== languageId) {
      await vscode.languages.setTextDocumentLanguage(vscTextDocument, languageId);
    }

    // If we have these events:
    // + openTextDocument (for a workspace uri that doesn't exist yet)
    // + textChange
    // + showTextEditor
    // + fsCreate
    // Then if we sync back to clock 0, the file will be deleted and the text editor
    // will be closed, but the vscode text document may stay there.
    // Then later when we try to step through the same events, we open the text document
    // with the old content instead of empty. There is no way to close a vscode text document
    // directly.
    // So here we must make sure that the content always matches the internal document.
    const item = this.internalWorkspace.worktree.get(uri);
    const text = await item.getContentText();
    const vscEol = VscWorkspace.toVscEol(eol);
    if (text !== vscTextDocument.getText() || vscTextDocument.eol !== vscEol) {
      await this.vscWorkspace.deferRestoreTextEditorByVscUri(async () => {
        const vscTextEditor = await vscode.window.showTextDocument(vscTextDocument);
        const success = await vscTextEditor.edit(builder => {
          if (vscTextDocument.eol !== vscEol) {
            builder.setEndOfLine(vscEol);
          }
          if (text !== vscTextDocument.getText()) {
            if (config.debug && text) {
              console.log('vsc workspace stepper: openTextDocument mustUpdateText with non-empty', {
                actual: vscTextDocument.getText(),
                expected: text,
              });
            }
            builder.replace(this.vscWorkspace.getVscTextDocumentVscRange(vscTextDocument), text);
          }
        });
        assert(success, 'vscode text editor edit failed');
      });
    }
  }
}

export default VscWorkspaceStepper;
