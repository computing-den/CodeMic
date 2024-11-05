import * as t from '../../lib/types.js';
import * as path from '../../lib/path.js';
import assert from '../../lib/assert.js';
import workspaceStepperDispatch from './workspace_stepper_dispatch.js';
import * as misc from '../misc.js';
import Session from './session.js';
import type { SeekStep, SeekData } from './internal_workspace.js';
import * as vscode from 'vscode';
import fs from 'fs';
import _ from 'lodash';

class VscWorkspaceStepper implements t.WorkspaceStepper {
  constructor(public session: Session) {}

  async applyEditorEvent(e: t.EditorEvent, uri: t.Uri, direction: t.Direction, uriSet?: t.UriSet) {
    await workspaceStepperDispatch(this, e, uri, direction, uriSet);
  }

  async applySeekStep(step: SeekStep, direction: t.Direction, uriSet?: t.UriSet) {
    await this.applyEditorEvent(step.event, step.uri, direction, uriSet);
    // this.eventIndex = step.newEventIndex;
  }

  finalizeSeek(seekData: SeekData) {
    // this.eventIndex = seekData.steps.at(-1)?.newEventIndex ?? this.eventIndex;
  }

  async applyInitEvent(e: t.InitEvent, uri: t.Uri, direction: t.Direction, uriSet?: t.UriSet) {
    if (direction === t.Direction.Forwards) {
      if (e.file.type === 'dir') {
        const absPath = path.getFileUriPath(this.session.resolveUri(uri));
        await fs.promises.mkdir(absPath, { recursive: true });
      }
    } else {
      throw new Error('Cannot reverse init event');
    }
  }

  async applyTextChangeEvent(e: t.TextChangeEvent, uri: t.Uri, direction: t.Direction) {
    // We use WorkspaceEdit here because we don't necessarily want to focus on the text editor yet.
    // There will be a separate select event after this if the editor had focus during recording.

    const vscUri = this.session.uriToVsc(uri);
    const edit = new vscode.WorkspaceEdit();
    if (direction === t.Direction.Forwards) {
      for (const cc of e.contentChanges) {
        edit.replace(vscUri, misc.toVscRange(cc.range), cc.text);
      }
    } else {
      for (const cc of e.revContentChanges) {
        edit.replace(vscUri, misc.toVscRange(cc.range), cc.text);
      }
    }
    await vscode.workspace.applyEdit(edit);
  }

  async applyOpenTextDocumentEvent(e: t.OpenTextDocumentEvent, uri: t.Uri, direction: t.Direction) {
    if (direction === t.Direction.Forwards) {
      const vscUri = this.session.uriToVsc(uri);

      // Open vsc document.
      let vscTextDocument = this.session.findVscTextDocumentByUri(uri);

      // If file doesn't exist, create it and open it and we're done.
      // vscode.workspace.openTextDocument() will throw if file doesn't exist.
      if (!vscTextDocument && vscUri.scheme === 'file') {
        await this.session.writeFileIfNotExists(uri, e.text || '');
        await vscode.workspace.openTextDocument(vscUri);
        return;
      }

      if (!vscTextDocument && vscUri.scheme === 'untitled') {
        vscTextDocument = await this.session.openVscUntitledByName(vscUri.path);
      }

      assert(vscTextDocument, `Failed to open text document: ${vscUri.toString()}`);

      // Set text if given.
      if (e.text !== undefined) {
        // We use WorkspaceEdit here because we don't necessarily want to open the text editor yet.
        const edit = new vscode.WorkspaceEdit();
        edit.replace(
          vscTextDocument.uri,
          misc.toVscRange(this.session.getVscTextDocumentRange(vscTextDocument)),
          e.text,
        );
        await vscode.workspace.applyEdit(edit);
      }
    } else {
      await this.session.closeVscTextEditorByUri(uri, true);
    }
  }

  async applyCloseTextDocumentEvent(e: t.CloseTextDocumentEvent, uri: t.Uri, direction: t.Direction) {
    assert(path.isUntitledUri(uri), 'Must only record closeTextDocument for untitled URIs');

    if (direction === t.Direction.Forwards) {
      await this.session.closeVscTextEditorByUri(uri, true);
    } else {
      const vscTextDocument = await vscode.workspace.openTextDocument(this.session.uriToVsc(uri));
      const edit = new vscode.WorkspaceEdit();
      edit.replace(
        vscTextDocument.uri,
        misc.toVscRange(this.session.getVscTextDocumentRange(vscTextDocument)),
        e.revText,
      );
      await vscode.workspace.applyEdit(edit);
    }
  }

  async applyShowTextEditorEvent(e: t.ShowTextEditorEvent, uri: t.Uri, direction: t.Direction) {
    if (direction === t.Direction.Forwards) {
      const vscTextEditor = await vscode.window.showTextDocument(this.session.uriToVsc(uri), {
        preview: false,
        preserveFocus: false,
      });
      vscTextEditor.selections = misc.toVscSelections(e.selections);
      await vscode.commands.executeCommand('revealLine', { lineNumber: e.visibleRange.start.line, at: 'top' });
    } else if (e.revUri) {
      const vscTextEditor = await vscode.window.showTextDocument(this.session.uriToVsc(e.revUri), {
        preview: false,
        preserveFocus: false,
      });
      vscTextEditor.selections = misc.toVscSelections(e.revSelections!);
      await vscode.commands.executeCommand('revealLine', { lineNumber: e.revVisibleRange!.start.line, at: 'top' });
    }
  }

  async applyCloseTextEditorEvent(e: t.CloseTextEditorEvent, uri: t.Uri, direction: t.Direction) {
    if (direction === t.Direction.Forwards) {
      await this.session.closeVscTextEditorByUri(uri, true);
    } else {
      const vscTextEditor = await vscode.window.showTextDocument(this.session.uriToVsc(uri), {
        preview: false,
        preserveFocus: false,
      });
      if (e.revSelections) {
        vscTextEditor.selections = misc.toVscSelections(e.revSelections);
      }
      if (e.revVisibleRange) {
        await vscode.commands.executeCommand('revealLine', { lineNumber: e.revVisibleRange.start.line, at: 'top' });
      }
    }
  }

  async applySelectEvent(e: t.SelectEvent, uri: t.Uri, direction: t.Direction) {
    const vscTextEditor = await vscode.window.showTextDocument(this.session.uriToVsc(uri), {
      preview: false,
      preserveFocus: false,
    });

    if (direction === t.Direction.Forwards) {
      vscTextEditor.selections = misc.toVscSelections(e.selections);
      await vscode.commands.executeCommand('revealLine', { lineNumber: e.visibleRange.start.line, at: 'top' });
    } else {
      vscTextEditor.selections = misc.toVscSelections(e.revSelections);
      await vscode.commands.executeCommand('revealLine', { lineNumber: e.revVisibleRange.start.line, at: 'top' });
    }
  }

  async applyScrollEvent(e: t.ScrollEvent, uri: t.Uri, direction: t.Direction) {
    await vscode.window.showTextDocument(this.session.uriToVsc(uri), { preview: false, preserveFocus: false });

    if (direction === t.Direction.Forwards) {
      await vscode.commands.executeCommand('revealLine', { lineNumber: e.visibleRange.start.line, at: 'top' });
    } else {
      await vscode.commands.executeCommand('revealLine', { lineNumber: e.revVisibleRange.start.line, at: 'top' });
    }
  }

  async applySaveEvent(e: t.SaveEvent, uri: t.Uri, direction: t.Direction) {
    const vscTextDocument = await vscode.workspace.openTextDocument(this.session.uriToVsc(uri));
    if (!(await vscTextDocument.save())) {
      throw new Error(`Could not save ${uri}`);
    }
  }
}

export default VscWorkspaceStepper;
