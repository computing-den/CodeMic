/**
 * Issues with vscode.workspace.applyEdit() for the textChange event:
 * 1. applyEdit() will open the text editor when editing a single file
 *   (and maybe multiple files?). Which is a problem when reversing the following
 *   events generated after saving an untitled document to a file:
 *   openTextDocument -> textInsert -> showTextEditor.
 *   So, when reversing the openTextDocument, we check again if there's a text editor
 *   and close it.
 * 2. applyEdit() doesn't open the text editor immediately. It takes a while even
 *   though we await it. Possible report: https://github.com/microsoft/vscode/issues/187396
 */

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
import { pathExists } from '../storage.js';
import config from '../config.js';
import InternalWorkspace from './internal_workspace.js';

class VscWorkspaceStepper implements t.WorkspaceStepper {
  constructor(
    private session: LoadedSession,
    private internalWorkspace: InternalWorkspace,
    private vscWorkspace: VscWorkspace,
  ) {}

  async applyEditorEvent(e: t.EditorEvent, direction: t.Direction) {
    if (config.logVscWorkspaceStepper) {
      console.log(
        `applyEditorEvent ${e.type} ${direction === 0 ? 'forward' : 'backward'} to ${
          e.uri
        }. Before current tabs: ${this.vscWorkspace.getRelevantTabUris()}`,
      );
    }

    await workspaceStepperDispatch(this, e, direction);
  }

  async applySeekStep(step: SeekStep, direction: t.Direction) {
    await this.applyEditorEvent(step.event, direction);
    // this.eventIndex = step.newEventIndex;
  }

  async applyFsCreateEvent(e: t.FsCreateEvent, direction: t.Direction) {
    if (direction === t.Direction.Forwards) {
      await this.session.core.writeFile(e.uri, e.file);

      // Sometimes, fsCreate comes after openTextDocument.
      const vscTextDocument = this.vscWorkspace.findVscTextDocumentByUri(e.uri);
      if (vscTextDocument) {
        await this.vscWorkspace.revertVscTextDocument(vscTextDocument);
      }
    } else {
      await fs.promises.rm(URI.parse(this.session.core.resolveUri(e.uri)).fsPath);
    }
  }

  async applyFsChangeEvent(e: t.FsChangeEvent, direction: t.Direction) {
    const vscTextDocument = this.vscWorkspace.findVscTextDocumentByUri(e.uri);
    const file = direction === t.Direction.Forwards ? e.file : e.revFile;
    await this.session.core.writeFile(e.uri, file);

    // We must revert the document so that vscode won't later warn about the file having
    // been changed when we try to save the file.
    //
    // Then, if the text in the document was different from what's now in the
    // file, we restore that text.
    if (vscTextDocument) {
      await this.vscWorkspace.revertVscTextDocument(vscTextDocument);
      const textInFile = await this.session.core.readFile(file, 'utf8');
      if (vscTextDocument.getText() !== textInFile) {
        await this.vscWorkspace.deferRestoreTextEditorByVscUri(async () => {
          const vscTextEditor = await vscode.window.showTextDocument(vscTextDocument);
          const success = await vscTextEditor.edit(builder => {
            builder.replace(this.vscWorkspace.getVscTextDocumentVscRange(vscTextDocument), textInFile);
          });
          assert(success, 'vscode text editor edit failed');
        });
      }
    }
  }

  async applyFsDeleteEvent(e: t.FsDeleteEvent, direction: t.Direction) {
    if (direction === t.Direction.Forwards) {
      await fs.promises.rm(URI.parse(this.session.core.resolveUri(e.uri)).fsPath);
    } else {
      await this.session.core.writeFile(e.uri, e.revFile);
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
      await this.vscWorkspace.openTextDocumentByUri(e.uri, { createFileIfNecessary: true });
    } else {
      // Cannot close vscode text document directly.
      // We don't want to revert and close a dirty document. The only way vscode,
      // issues a closeTextDocument on a dirty document is when switching language ID.
      // Also, see top of the file for explanation.
      const item = this.internalWorkspace.worktree.getOpt(e.uri);
      if (!(await item?.isDirty())) {
        await this.vscWorkspace.closeVscTextEditorByUri(e.uri, { skipConfirmation: true });
      }
    }
  }

  async applyCloseTextDocumentEvent(e: t.CloseTextDocumentEvent, direction: t.Direction) {
    if (direction === t.Direction.Forwards) {
      // Cannot close vscode text document directly.
      // We don't want to revert and close a dirty document. The only way vscode,
      // issues a closeTextDocument on a dirty document is when switching language ID.
      // Also, see top of the file for explanation.
      const item = this.internalWorkspace.worktree.getOpt(e.uri);
      if (!(await item?.isDirty())) {
        await this.vscWorkspace.closeVscTextEditorByUri(e.uri, { skipConfirmation: true });
      }
    } else {
      await this.vscWorkspace.openTextDocumentByUri(e.uri, { createFileIfNecessary: true });
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

    if (e.recorderVersion === 1) {
      if (direction === t.Direction.Forwards) {
        const vscTextEditor = await this.vscWorkspace.showTextDocumentByUri(e.uri, { preserveFocus: false });
        if (e.selections) {
          vscTextEditor.selections = VscWorkspace.toVscSelections(e.selections);
        }
        if (e.visibleRange) {
          await vscode.commands.executeCommand('revealLine', { lineNumber: e.visibleRange.start, at: 'top' });
        }
      } else if (e.revUri) {
        const vscTextEditor = await this.vscWorkspace.showTextDocumentByUri(e.revUri, { preserveFocus: false });
        if (e.revSelections) {
          vscTextEditor.selections = VscWorkspace.toVscSelections(e.revSelections);
        }
        if (e.revVisibleRange) {
          await vscode.commands.executeCommand('revealLine', { lineNumber: e.revVisibleRange.start, at: 'top' });
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
        if (e.justOpened || !e.revUri) {
          // console.log(
          //   `vsc stepper: reversing applyShowTextEditor, trying to close: ${e.uri} because ${
          //     e.justOpened ? 'was just opened' : 'there is no revUri'
          //   }`,
          // );
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
    //       sometimes comes before the openTextDocument event. In that case,
    //       just ignore it and let openTextDocument event handle it by creating
    //       the file on disk.
    //
    // TODO when an untitled document is saved, does e.uri refer to the untitled
    // document or the one on file?
    throw new Error('TODO');
    // const vscTextDocument = this.vscWorkspace.findVscTextDocumentByUri(e.uri);
    // if (vscTextDocument) {
    //   await fs.promises.writeFile(vscTextDocument.uri.fsPath, vscTextDocument.getText());
    //   await this.vscWorkspace.revertVscTextDocument(vscTextDocument);
    // }
  }

  async applyTextInsertEvent(e: t.TextInsertEvent, direction: t.Direction) {
    await this.applyTextChangeEvent(lib.getTextChangeEventFromTextInsertEvent(e), direction);
  }
}

export default VscWorkspaceStepper;
