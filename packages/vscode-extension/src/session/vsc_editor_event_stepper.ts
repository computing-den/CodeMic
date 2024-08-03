import { types as t, path, lib, assert, editorEventStepperDispatch } from '@codecast/lib';
import { fileExists } from '../misc.js';
import Session from './session.js';
import * as vscode from 'vscode';
import _ from 'lodash';

class VscEditorEventStepper implements t.EditorEventStepper {
  constructor(public session: Session) {}

  async applyEditorEvent(e: t.EditorEvent, direction: t.Direction, uriSet?: t.UriSet) {
    await editorEventStepperDispatch(this, e, direction, uriSet);
  }

  async applySeekStep(seekData: t.SeekData, stepIndex: number) {
    await this.applyEditorEvent(seekData.events[stepIndex], seekData.direction);
  }

  finalizeSeek(seekData: t.SeekData) {
    // nothing
  }

  async applyTextChangeEvent(e: t.TextChangeEvent, direction: t.Direction) {
    if (e.contentChanges.length > 1) {
      throw new Error('applyTextChangeEvent: TODO textChange does not yet support contentChanges.length > 1');
    }

    // We use WorkspaceEdit here because we don't necessarily want to focus on the text editor yet.
    // There will be a separate select event after this if the editor had focus during recording.

    const vscUri = this.session.uriToVsc(e.uri);
    const edit = new vscode.WorkspaceEdit();
    if (direction === t.Direction.Forwards) {
      for (const cc of e.contentChanges) {
        edit.replace(vscUri, this.session.rangeToVsc(cc.range), cc.text);
      }
    } else {
      for (const cc of e.contentChanges) {
        // TODO shouldn't we apply these in reverse order?
        edit.replace(vscUri, this.session.rangeToVsc(cc.revRange), cc.revText);
      }
    }
    await vscode.workspace.applyEdit(edit);
  }

  /**
   * 'openTextDocument' event always has the text field since if the document was already in checkpoint, no
   * 'openTextDocument' event would be generated at all.
   */
  async applyOpenTextDocumentEvent(e: t.OpenTextDocumentEvent, direction: t.Direction) {
    if (direction === t.Direction.Forwards) {
      const vscUri = this.session.uriToVsc(e.uri);

      // Open vsc document.
      let vscTextDocument = this.session.findVscTextDocumentByUri(e.uri);

      // If file doesn't exist, create it and open it and we're done.
      // vscode.workspace.openTextDocument() will throw if file doesn't exist.
      if (!vscTextDocument && vscUri.scheme === 'file') {
        await this.session.writeFileIfNotExists(e.uri, e.text || '');
        await vscode.workspace.openTextDocument(vscUri);
        return;
      }

      vscTextDocument = await vscode.workspace.openTextDocument(vscUri);

      // Set text if given.
      if (e.text !== undefined) {
        // We use WorkspaceEdit here because we don't necessarily want to open the text editor yet.
        const edit = new vscode.WorkspaceEdit();
        edit.replace(vscTextDocument.uri, this.session.getVscTextDocumentRange(vscTextDocument), e.text);
        await vscode.workspace.applyEdit(edit);
      }
    } else {
      await this.session.closeVscTextEditorByUri(e.uri, true);
    }
  }

  async applyCloseTextDocumentEvent(e: t.CloseTextDocumentEvent, direction: t.Direction) {
    assert(path.isUntitledUri(e.uri), 'Must only record closeTextDocument for untitled URIs');

    if (direction === t.Direction.Forwards) {
      await this.session.closeVscTextEditorByUri(e.uri, true);
    } else {
      const vscTextDocument = await vscode.workspace.openTextDocument(this.session.uriToVsc(e.uri));
      const edit = new vscode.WorkspaceEdit();
      edit.replace(vscTextDocument.uri, this.session.getVscTextDocumentRange(vscTextDocument), e.revText);
      await vscode.workspace.applyEdit(edit);
    }
  }

  async applyShowTextEditorEvent(e: t.ShowTextEditorEvent, direction: t.Direction) {
    if (direction === t.Direction.Forwards) {
      const vscTextEditor = await vscode.window.showTextDocument(this.session.uriToVsc(e.uri), {
        preview: false,
        preserveFocus: false,
      });
      vscTextEditor.selections = this.session.selectionsToVsc(e.selections);
      await vscode.commands.executeCommand('revealLine', { lineNumber: e.visibleRange.start.line, at: 'top' });
    } else if (e.revUri) {
      const vscTextEditor = await vscode.window.showTextDocument(this.session.uriToVsc(e.revUri), {
        preview: false,
        preserveFocus: false,
      });
      vscTextEditor.selections = this.session.selectionsToVsc(e.revSelections!);
      await vscode.commands.executeCommand('revealLine', { lineNumber: e.revVisibleRange!.start.line, at: 'top' });
    }
  }

  async applyCloseTextEditorEvent(e: t.CloseTextEditorEvent, direction: t.Direction) {
    if (direction === t.Direction.Forwards) {
      await this.session.closeVscTextEditorByUri(e.uri, true);
    } else {
      const vscTextEditor = await vscode.window.showTextDocument(this.session.uriToVsc(e.uri), {
        preview: false,
        preserveFocus: false,
      });
      if (e.revSelections) {
        vscTextEditor.selections = this.session.selectionsToVsc(e.revSelections);
      }
      if (e.revVisibleRange) {
        await vscode.commands.executeCommand('revealLine', { lineNumber: e.revVisibleRange.start.line, at: 'top' });
      }
    }
  }

  async applySelectEvent(e: t.SelectEvent, direction: t.Direction) {
    const vscTextEditor = await vscode.window.showTextDocument(this.session.uriToVsc(e.uri), {
      preview: false,
      preserveFocus: false,
    });

    if (direction === t.Direction.Forwards) {
      vscTextEditor.selections = this.session.selectionsToVsc(e.selections);
      await vscode.commands.executeCommand('revealLine', { lineNumber: e.visibleRange.start.line, at: 'top' });
    } else {
      vscTextEditor.selections = this.session.selectionsToVsc(e.revSelections);
      await vscode.commands.executeCommand('revealLine', { lineNumber: e.revVisibleRange.start.line, at: 'top' });
    }
  }

  async applyScrollEvent(e: t.ScrollEvent, direction: t.Direction) {
    await vscode.window.showTextDocument(this.session.uriToVsc(e.uri), { preview: false, preserveFocus: false });

    if (direction === t.Direction.Forwards) {
      await vscode.commands.executeCommand('revealLine', { lineNumber: e.visibleRange.start.line, at: 'top' });
    } else {
      await vscode.commands.executeCommand('revealLine', { lineNumber: e.revVisibleRange.start.line, at: 'top' });
    }
  }

  async applySaveEvent(e: t.SaveEvent, direction: t.Direction) {
    const vscTextDocument = await vscode.workspace.openTextDocument(this.session.uriToVsc(e.uri));
    if (!(await vscTextDocument.save())) {
      throw new Error(`Could not save ${e.uri}`);
    }
  }
}

export default VscEditorEventStepper;
