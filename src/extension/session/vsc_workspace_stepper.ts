import * as t from '../../lib/types.js';
import * as lib from '../../lib/lib.js';
import assert from '../../lib/assert.js';
import workspaceStepperDispatch from './workspace_stepper_dispatch.js';
import type { SeekStep, SeekData } from './internal_workspace.js';
import * as vscode from 'vscode';
import fs from 'fs';
import _ from 'lodash';
import { LoadedSession } from './session.js';
import VscWorkspace from './vsc_workspace.js';
import { URI } from 'vscode-uri';

class VscWorkspaceStepper implements t.WorkspaceStepper {
  constructor(public session: LoadedSession, public vscWorkspace: VscWorkspace) {}

  async applyEditorEvent(e: t.EditorEvent, uri: string, direction: t.Direction, uriSet?: t.UriSet) {
    await workspaceStepperDispatch(this, e, uri, direction, uriSet);
  }

  async applySeekStep(step: SeekStep, direction: t.Direction, uriSet?: t.UriSet) {
    await this.applyEditorEvent(step.event, step.uri, direction, uriSet);
    // this.eventIndex = step.newEventIndex;
  }

  finalizeSeek(seekData: SeekData) {
    // this.eventIndex = seekData.steps.at(-1)?.newEventIndex ?? this.eventIndex;
  }

  async applyInitEvent(e: t.InitEvent, uri: string, direction: t.Direction, uriSet?: t.UriSet) {
    if (direction === t.Direction.Forwards) {
      if (e.file.type === 'dir') {
        const fsPath = URI.parse(this.session.core.resolveUri(uri)).fsPath;
        await fs.promises.mkdir(fsPath, { recursive: true });
      }
    } else {
      throw new Error('Cannot reverse init event');
    }
  }

  async applyTextChangeEvent(e: t.TextChangeEvent, uri: string, direction: t.Direction) {
    // We use WorkspaceEdit here because we don't necessarily want to focus on the text editor yet.
    // There will be a separate select event after this if the editor had focus during recording.

    const vscUri = this.vscWorkspace.uriToVsc(uri);
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
      const vscTextEditor = await this.vscWorkspace.showTextDocumentByUri(uri, { preserveFocus: false });
      if (direction === t.Direction.Forwards) {
        vscTextEditor.selections = VscWorkspace.toVscSelections(lib.getSelectionsAfterTextChangeEvent(e));
      } else {
        vscTextEditor.selections = VscWorkspace.toVscSelections(lib.getSelectionsBeforeTextChangeEvent(e));
      }
    }
  }

  async applyOpenTextDocumentEvent(e: t.OpenTextDocumentEvent, uri: string, direction: t.Direction) {
    if (direction === t.Direction.Forwards) {
      const vscUri = this.vscWorkspace.uriToVsc(uri);

      // Open vsc document.
      let vscTextDocument = this.vscWorkspace.findVscTextDocumentByUri(uri);

      // If file doesn't exist, create it and open it and we're done.
      // vscode.workspace.openTextDocument() will throw if file doesn't exist.
      if (!vscTextDocument && vscUri.scheme === 'file') {
        await this.session.core.writeFileIfNotExists(uri, e.text || '');
        await this.vscWorkspace.openTextDocumentByUri(uri);
        return;
      }

      // Must be an untitled document.
      // Open if not already found.
      vscTextDocument ??= await this.vscWorkspace.openTextDocumentByUri(uri);

      // Set text if given.
      if (e.text !== undefined) {
        // We use WorkspaceEdit here because we don't necessarily want to open the text editor yet.
        const edit = new vscode.WorkspaceEdit();
        edit.replace(
          vscTextDocument.uri,
          VscWorkspace.toVscRange(this.vscWorkspace.getVscTextDocumentRange(vscTextDocument)),
          e.text,
        );
        await vscode.workspace.applyEdit(edit);

        await this.vscWorkspace.saveVscTextDocument(vscTextDocument);
      }
    } else {
      await this.vscWorkspace.closeVscTextEditorByUri(uri, { skipConfirmation: true });
    }
  }

  async applyCloseTextDocumentEvent(e: t.CloseTextDocumentEvent, uri: string, direction: t.Direction) {
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

  async applyShowTextEditorEvent(e: t.ShowTextEditorEvent, uri: string, direction: t.Direction) {
    if (direction === t.Direction.Forwards) {
      const vscTextEditor = await this.vscWorkspace.showTextDocumentByUri(uri, { preserveFocus: false });
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
  }

  async applyCloseTextEditorEvent(e: t.CloseTextEditorEvent, uri: string, direction: t.Direction) {
    if (direction === t.Direction.Forwards) {
      await this.vscWorkspace.closeVscTextEditorByUri(uri, { skipConfirmation: true });
    } else {
      const vscTextEditor = await this.vscWorkspace.showTextDocumentByUri(uri, { preserveFocus: false });
      if (e.revSelections) {
        vscTextEditor.selections = VscWorkspace.toVscSelections(e.revSelections);
      }
      if (e.revVisibleRange) {
        await vscode.commands.executeCommand('revealLine', { lineNumber: e.revVisibleRange.start, at: 'top' });
      }
    }
  }

  async applySelectEvent(e: t.SelectEvent, uri: string, direction: t.Direction) {
    const vscTextEditor = await this.vscWorkspace.showTextDocumentByUri(uri, { preserveFocus: false });

    if (direction === t.Direction.Forwards) {
      vscTextEditor.selections = VscWorkspace.toVscSelections(e.selections);
      // await vscode.commands.executeCommand('revealLine', { lineNumber: e.visibleRange.start.line, at: 'top' });
    } else {
      vscTextEditor.selections = VscWorkspace.toVscSelections(e.revSelections);
      // await vscode.commands.executeCommand('revealLine', { lineNumber: e.revVisibleRange.start.line, at: 'top' });
    }
  }

  async applyScrollEvent(e: t.ScrollEvent, uri: string, direction: t.Direction) {
    await this.vscWorkspace.showTextDocumentByUri(uri, { preserveFocus: false });

    if (direction === t.Direction.Forwards) {
      await vscode.commands.executeCommand('revealLine', { lineNumber: e.visibleRange.start, at: 'top' });
    } else {
      await vscode.commands.executeCommand('revealLine', { lineNumber: e.revVisibleRange.start, at: 'top' });
    }
  }

  async applySaveEvent(e: t.SaveEvent, uri: string, direction: t.Direction) {
    // NOTE: if we open an untitled document and then save it, the save event
    //       sometimes comes before the openTextDocument event. In that case,
    //       just ignore it and let openTextDocument event handle it by creating
    //       the file on disk.
    const vscTextDocument = this.vscWorkspace.findVscTextDocumentByUri(uri);
    if (vscTextDocument) {
      this.vscWorkspace.saveVscTextDocument(vscTextDocument);
    }
  }

  async applyTextInsertEvent(e: t.TextInsertEvent, uri: string, direction: t.Direction) {
    await this.applyTextChangeEvent(lib.getTextChangeEventFromTextInsertEvent(e), uri, direction);
  }
}

export default VscWorkspaceStepper;
