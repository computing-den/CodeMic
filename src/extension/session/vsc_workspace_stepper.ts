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
    await workspaceStepperDispatch(this, e, direction);
  }

  async applySeekStep(step: SeekStep, direction: t.Direction) {
    await this.applyEditorEvent(step.event, direction);
    // this.eventIndex = step.newEventIndex;
  }

  async applyFsCreateEvent(e: t.FsCreateEvent, direction: t.Direction) {
    if (direction === t.Direction.Forwards) {
      await this.session.core.writeFile(e.uri, e.file);
    } else {
      await this.vscWorkspace.closeVscTextEditorByUri(e.uri, { skipConfirmation: true });
      await fs.promises.rm(URI.parse(this.session.core.resolveUri(e.uri)).fsPath);
    }
  }

  async applyFsChangeEvent(e: t.FsChangeEvent, direction: t.Direction) {
    const vscTextDocument = this.vscWorkspace.findVscTextDocumentByUri(e.uri);
    const text = vscTextDocument?.getText();
    let file: t.File;

    if (direction === t.Direction.Forwards) {
      file = e.file;
    } else {
      file = e.revFile;
    }

    await this.session.core.writeFile(e.uri, file);

    // We must revert the document so that vscode won't later warn about the file having
    // been changed when we try to save the file.
    //
    // Then, if the text in the document was different from what's now in the
    // file, we restore that text.
    if (vscTextDocument) {
      await this.vscWorkspace.revertVscTextDocument(vscTextDocument);
      const textInFile = new TextDecoder().decode(await this.session.core.readFile(file));
      if (text !== textInFile) {
        const edit = new vscode.WorkspaceEdit();
        edit.replace(vscTextDocument.uri, this.vscWorkspace.getVscTextDocumentVscRange(vscTextDocument), textInFile);
        await vscode.workspace.applyEdit(edit);
      }
    }
  }

  async applyFsDeleteEvent(e: t.FsDeleteEvent, direction: t.Direction) {
    if (direction === t.Direction.Forwards) {
      await this.vscWorkspace.closeVscTextEditorByUri(e.uri, { skipConfirmation: true });
      await fs.promises.rm(URI.parse(this.session.core.resolveUri(e.uri)).fsPath);
    } else {
      await this.session.core.writeFile(e.uri, e.revFile);
    }
  }

  async applyTextChangeEvent(e: t.TextChangeEvent, direction: t.Direction) {
    // We use WorkspaceEdit here because we don't necessarily want to focus on the text editor yet.
    // There will be a separate select event after this if the editor had focus during recording.

    const vscUri = this.vscWorkspace.uriToVsc(e.uri);
    const edit = new vscode.WorkspaceEdit();
    if (direction === t.Direction.Forwards) {
      for (const cc of e.contentChanges) {
        edit.replace(vscUri, VscWorkspace.toVscRange(cc.range), cc.text);
      }
    } else {
      for (const cc of e.revContentChanges) {
        edit.replace(vscUri, VscWorkspace.toVscRange(cc.range), cc.text);
      }
    }
    await vscode.workspace.applyEdit(edit);

    if (e.updateSelection) {
      const vscTextEditor = await this.vscWorkspace.showTextDocumentByUri(e.uri, { preserveFocus: false });
      if (direction === t.Direction.Forwards) {
        vscTextEditor.selections = VscWorkspace.toVscSelections(lib.getSelectionsAfterTextChangeEvent(e));
      } else {
        vscTextEditor.selections = VscWorkspace.toVscSelections(lib.getSelectionsBeforeTextChangeEvent(e));
      }
    }
  }

  async applyOpenTextDocumentEvent(e: t.OpenTextDocumentEvent, direction: t.Direction) {
    if (direction === t.Direction.Forwards) {
      await this.vscWorkspace.openTextDocumentByUri(e.uri);

      // const vscUri = this.vscWorkspace.uriToVsc(e.uri);
      //
      // // Open vsc document.
      // let vscTextDocument = this.vscWorkspace.findVscTextDocumentByUri(e.uri);
      // // vscode.workspace.openTextDocument() will throw if file doesn't exist.
      // // Technically, file must always exist because there should always be
      // // a fsCreate before openTextDocument. But, v1 did not have that.
      // if (!vscTextDocument && vscUri.scheme === 'file') {
      //   const fsPath = URI.parse(this.session.core.resolveUri(e.uri)).fsPath;
      //   if (config.debug && !(await pathExists(fsPath))) {
      //     throw new Error(`Trying to open document but file does not exist at ${fsPath}`);
      //   }

      //   await this.session.core.writeTextFileIfNotExists(e.uri, e.text || '');
      //   await this.vscWorkspace.openTextDocumentByUri(e.uri);
      //   return;
      // }
    } else {
      await this.vscWorkspace.closeVscTextEditorByUri(e.uri, { skipConfirmation: true });
    }
  }

  async applyCloseTextDocumentEvent(e: t.CloseTextDocumentEvent, direction: t.Direction) {
    throw new Error('TODO');

    // assert(URI.parse(uri).scheme === 'untitled', 'Must only record closeTextDocument for untitled URIs');

    // if (direction === t.Direction.Forwards) {
    //   await this.vscWorkspace.closeVscTextEditorByUri(uri, true);
    // } else {
    //   const vscTextDocument = await this.vscWorkspace.openTextDocumentByUri(this.vscWorkspace.uriToVsc(uri));
    //   const edit = new vscode.WorkspaceEdit();
    //   edit.replace(
    //     vscTextDocument.uri,
    //     VscWorkspace.toVscRange(this.vscWorkspace.getVscTextDocumentRange(vscTextDocument)),
    //     e.revText,
    //   );
    //   await vscode.workspace.applyEdit(edit);
    // }
  }

  async applyShowTextEditorEvent(e: t.ShowTextEditorEvent, direction: t.Direction) {
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

        // Go back to e.revUri if any and set its selections and visible range,
        // or clear active text editor.
        if (e.revUri) {
          const vscTextEditor = await this.vscWorkspace.showTextDocumentByUri(e.revUri);
          const internalTextEditor = this.internalWorkspace.getTextEditorByUri(e.revUri);
          vscTextEditor.selections = VscWorkspace.toVscSelections(internalTextEditor.selections);
          await vscode.commands.executeCommand('revealLine', {
            lineNumber: internalTextEditor.visibleRange.start,
            at: 'top',
          });
        } else {
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
      // await vscode.commands.executeCommand('revealLine', { lineNumber: e.visibleRange.start.line, at: 'top' });
    } else {
      vscTextEditor.selections = VscWorkspace.toVscSelections(e.revSelections);
      // await vscode.commands.executeCommand('revealLine', { lineNumber: e.revVisibleRange.start.line, at: 'top' });
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
    // NOTE: if we open an untitled document and then save it, the save event
    //       sometimes comes before the openTextDocument event. In that case,
    //       just ignore it and let openTextDocument event handle it by creating
    //       the file on disk.
    const vscTextDocument = this.vscWorkspace.findVscTextDocumentByUri(e.uri);
    if (vscTextDocument) {
      this.vscWorkspace.saveVscTextDocument(vscTextDocument);
    }
  }

  async applyTextInsertEvent(e: t.TextInsertEvent, direction: t.Direction) {
    await this.applyTextChangeEvent(lib.getTextChangeEventFromTextInsertEvent(e), direction);
  }
}

export default VscWorkspaceStepper;
