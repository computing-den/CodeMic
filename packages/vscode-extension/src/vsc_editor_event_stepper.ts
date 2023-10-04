import { types as t, path, editorTrack as et, lib, assert, editorEventStepperDispatch } from '@codecast/lib';
import VscWorkspace from './vsc_workspace.js';
import * as vscode from 'vscode';
import _ from 'lodash';

class VscEditorEventStepper implements t.EditorEventStepper {
  constructor(public workspace: VscWorkspace) {}

  async applyEditorEvent(e: t.EditorEvent, direction: t.Direction, uriSet?: t.UriSet) {
    await editorEventStepperDispatch(this, e, direction, uriSet);
  }

  async applySeekStep(seekData: t.SeekData, stepIndex: number) {
    await this.applyEditorEvent(seekData.events[stepIndex], seekData.direction);
  }

  async finalizeSeek(seekData: t.SeekData) {
    // nothing
  }

  async applyTextChangeEvent(e: t.TextChangeEvent, direction: t.Direction) {
    if (e.contentChanges.length > 1) {
      throw new Error('applyTextChangeEvent: TODO textChange does not yet support contentChanges.length > 1');
    }

    // We use WorkspaceEdit here because we don't necessarily want to focus on the text editor yet.
    // There will be a separate select event after this if the editor had focus during recording.

    const vscUri = this.workspace.uriToVsc(e.uri);
    const edit = new vscode.WorkspaceEdit();
    if (direction === t.Direction.Forwards) {
      for (const cc of e.contentChanges) {
        edit.replace(vscUri, this.workspace.rangeToVsc(cc.range), cc.text);
      }
    } else {
      for (const cc of e.contentChanges) {
        // TODO shouldn't we apply these in reverse order?
        edit.replace(vscUri, this.workspace.rangeToVsc(cc.revRange), cc.revText);
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
      // Open vsc document first.
      const vscTextDocument = await vscode.workspace.openTextDocument(this.workspace.uriToVsc(e.uri));

      // We use WorkspaceEdit here because we don't necessarily want to open the text editor yet.
      const edit = new vscode.WorkspaceEdit();
      edit.replace(vscTextDocument.uri, this.workspace.getVscTextDocumentRange(vscTextDocument), e.text);
      await vscode.workspace.applyEdit(edit);
    } else {
      await this.workspace.closeVscTextEditorByUri(e.uri, true);
    }
  }

  async applyShowTextEditorEvent(e: t.ShowTextEditorEvent, direction: t.Direction) {
    if (direction === t.Direction.Forwards) {
      const vscTextEditor = await vscode.window.showTextDocument(this.workspace.uriToVsc(e.uri), {
        preview: false,
        preserveFocus: false,
      });
      vscTextEditor.selections = this.workspace.selectionsToVsc(e.selections);
      await vscode.commands.executeCommand('revealLine', { lineNumber: e.visibleRange.start.line, at: 'top' });
    } else if (e.revUri) {
      const vscTextEditor = await vscode.window.showTextDocument(this.workspace.uriToVsc(e.revUri), {
        preview: false,
        preserveFocus: false,
      });
      vscTextEditor.selections = this.workspace.selectionsToVsc(e.revSelections!);
      await vscode.commands.executeCommand('revealLine', { lineNumber: e.revVisibleRange!.start.line, at: 'top' });
    }
  }

  async applySelectEvent(e: t.SelectEvent, direction: t.Direction) {
    const vscTextEditor = await vscode.window.showTextDocument(this.workspace.uriToVsc(e.uri), {
      preview: false,
      preserveFocus: false,
    });

    if (direction === t.Direction.Forwards) {
      vscTextEditor.selections = this.workspace.selectionsToVsc(e.selections);
      await vscode.commands.executeCommand('revealLine', { lineNumber: e.visibleRange.start.line, at: 'top' });
    } else {
      vscTextEditor.selections = this.workspace.selectionsToVsc(e.revSelections);
      await vscode.commands.executeCommand('revealLine', { lineNumber: e.revVisibleRange.start.line, at: 'top' });
    }
  }

  async applyScrollEvent(e: t.ScrollEvent, direction: t.Direction) {
    await vscode.window.showTextDocument(this.workspace.uriToVsc(e.uri), { preview: false, preserveFocus: false });

    if (direction === t.Direction.Forwards) {
      await vscode.commands.executeCommand('revealLine', { lineNumber: e.visibleRange.start.line, at: 'top' });
    } else {
      await vscode.commands.executeCommand('revealLine', { lineNumber: e.revVisibleRange.start.line, at: 'top' });
    }
  }

  async applySaveEvent(e: t.SaveEvent, direction: t.Direction) {
    const vscTextDocument = await vscode.workspace.openTextDocument(this.workspace.uriToVsc(e.uri));
    if (!(await vscTextDocument.save())) {
      throw new Error(`Could not save ${e.uri}`);
    }
  }
}

export default VscEditorEventStepper;
