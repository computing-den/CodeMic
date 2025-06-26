import * as assert from 'assert';
import fs from 'fs';
import path from 'path';
import _ from 'lodash';
import * as vscode from 'vscode';
import CodeMic from '../extension/codemic.js';
import * as lib from '../lib/lib.js';
import type * as t from '../lib/types.js';
import { inspect } from 'util';
import { URI } from 'vscode-uri';
import VscWorkspace from '../extension/session/vsc_workspace.js';
import { deserializeTestMeta } from '../extension/session/serialization.js';
import { describe } from 'mocha';
import config from '../extension/config.js';
import { pathExists, readJSON, writeJSON } from '../extension/storage.js';
import {
  createRandomSessionTestSteps,
  getCodeMic,
  openSessionInRecorder,
  prepareForSession,
  readAvailableClockStrs,
  SessionTestStep,
  sessionTestStepToString,
  testSessionsPath,
  workspacePath,
} from './test-helpers.js';

// Dynamic tests using fs messes up the vscode test extension. It still works but vscode
// cannot show the list of tests.
// const testSessions = fs.readdirSync(testSessionsPath, { encoding: 'utf8' });
// suite('Sessions Test Suite', () => {
test('open_document_fs_create', () => testSession('open_document_fs_create'));
test('save_untitled', () => testSession('save_untitled'));
test('switch_untitled_to_c_and_save', () => testSession('switch_untitled_to_c_and_save'));
test('show_text_editor', () => testSession('show_text_editor'));
test('rename_file', () => testSession('rename_file'));
test('change_language_dirty_document', () => testSession('change_language_dirty_document'));
// });

async function testSession(sessionHandle: string) {
  const sessionTestDataPath = path.resolve(testSessionsPath, sessionHandle);
  const lastPlanPath = path.resolve(sessionTestDataPath, 'session_test_last_plan.json');
  const head = JSON.parse(fs.readFileSync(path.resolve(sessionTestDataPath, 'CodeMic', 'head.json'), 'utf8'));
  const clockStrs = readAvailableClockStrs(sessionHandle);
  if (config.testWithLastParams && (await pathExists(lastPlanPath))) {
    const steps: SessionTestStep[] = await readJSON(lastPlanPath);
    console.log('Reusing test plan: ', steps.map(sessionTestStepToString).join(' -> '));

    await prepareForSession(sessionHandle);
    await openSessionInRecorder(head.id);
    await testSessionSteps(sessionHandle, steps);
  } else {
    for (let i = 0; i < (config.testRepeatCount ?? 1); i++) {
      const steps = createRandomSessionTestSteps(clockStrs);
      await writeJSON(lastPlanPath, steps);
      console.log(
        `#${i + 1} New test plan: ${steps.map(sessionTestStepToString).join(' -> ')}  (at ${performance.now()})`,
      );

      await prepareForSession(sessionHandle);
      await openSessionInRecorder(head.id);
      await testSessionSteps(sessionHandle, steps);
    }
  }
}

async function testSessionSteps(sessionHandle: string, steps: SessionTestStep[]) {
  const sessionTestDataPath = path.resolve(testSessionsPath, sessionHandle);

  for (const [i, step] of steps.entries()) {
    const label = steps
      .slice(0, i + 1)
      .map(sessionTestStepToString)
      .join(' -> ');

    // Seek if necessary.
    await getCodeMic().handleMessage({ type: 'recorder/seek', clock: step.clock, useStepper: step.useStepper });

    const testClockPath = path.resolve(sessionTestDataPath, `clock_${step.clockStr}`);
    const meta = deserializeTestMeta(JSON.parse(fs.readFileSync(path.resolve(testClockPath, 'meta.json'), 'utf8')));

    // Check files and open text documents.
    checkFilesAtClock(testClockPath, sessionHandle, label);
    await checkTextDocumentsAtClock(testClockPath, sessionHandle, label, meta);
    await checkTextEditorsAtClock(testClockPath, sessionHandle, label, meta);
  }
}

function checkFilesAtClock(testClockPath: string, sessionHandle: string, label: string) {
  const expectedFilesPath = path.resolve(testClockPath, 'files');
  const expectedFiles = fs.readdirSync(expectedFilesPath, { recursive: true, encoding: 'utf8' });
  const actualFiles = fs
    .readdirSync(workspacePath, { recursive: true, encoding: 'utf8' })
    .filter(x => !x.startsWith('.CodeMic'));

  const missingActualFiles = _.difference(expectedFiles, actualFiles);
  const extraActualFiles = _.difference(actualFiles, expectedFiles);

  // Compare file names.
  assert.ok(
    missingActualFiles.length === 0,
    `At ${label}: the following files are missing: ${missingActualFiles.join(', ')}`,
  );
  assert.ok(
    extraActualFiles.length === 0,
    `At ${label}: the following files are extra: ${extraActualFiles.join(', ')}`,
  );

  // Compare content.
  for (const file of expectedFiles) {
    const expectedStat = fs.statSync(path.resolve(expectedFilesPath, file));
    if (expectedStat.isFile()) {
      const expectedContent = fs.readFileSync(path.resolve(expectedFilesPath, file), 'utf8');
      const actualContent = fs.readFileSync(path.resolve(workspacePath, file), 'utf8');
      assert.strictEqual(actualContent, expectedContent, `At ${label}: foundf unexpected content in file ${file}`);
    } else if (expectedStat.isDirectory()) {
      assert.ok(
        fs.statSync(path.resolve(workspacePath, file)).isDirectory(),
        `At ${label}: expected directory at ${file}`,
      );
    } else {
      assert.fail(`At ${label}: found expected file of unknown type at ${file}`);
    }
  }
}

async function checkTextDocumentsAtClock(
  testClockPath: string,
  sessionHandle: string,
  label: string,
  meta: t.TestMeta,
) {
  // Compare text documents' content against internal
  // Compare text documents' content against vscode
  // Must not have extra internal text documents
  // Must not have extra *dirty* vscode documents

  type TextDocument = { content: string; uri: string; dirty?: boolean; languageId: string };

  const vscWorkspace = getCodeMic().session!.rr!._test_vscWorkspace;

  const expectedTextDocumentsPath = path.resolve(testClockPath, 'text_documents');
  const expectedTextDocumentsPaths = fs.readdirSync(expectedTextDocumentsPath, {
    recursive: true,
    encoding: 'utf8',
  });

  const expectedTextDocuments: TextDocument[] = _.compact(
    expectedTextDocumentsPaths.map(p => {
      const file = path.resolve(expectedTextDocumentsPath, p);
      if (!fs.statSync(path.resolve(workspacePath, file)).isFile()) return;

      const content = fs.readFileSync(file, 'utf8');
      if (p.startsWith('Untitled-')) {
        const uri = URI.from({ scheme: 'untitled', path: p }).toString();
        return { uri, content, dirty: meta.dirtyTextDocuments.includes(uri), languageId: meta.languageIds[uri] };
      } else {
        const uri = lib.workspaceUri(p);
        return { uri, content, dirty: meta.dirtyTextDocuments.includes(uri), languageId: meta.languageIds[uri] };
      }
    }),
  );

  const actualVscTextDocuments: TextDocument[] = vscode.workspace.textDocuments.map(textDocument => {
    const content = textDocument.getText();
    const dirty = vscWorkspace.isVscTextDocumentDirty(textDocument);
    switch (textDocument.uri.scheme) {
      case 'file': {
        const uri = lib.workspaceUriFrom(workspacePath, textDocument.uri.fsPath);
        return { uri, content, dirty, languageId: textDocument.languageId };
      }
      case 'untitled': {
        const uri = URI.from({ scheme: 'untitled', path: textDocument.uri.path }).toString();
        return { uri, content, dirty, languageId: textDocument.languageId };
      }
      default:
        throw new Error(`unknown scheme: ${textDocument.uri.scheme}`);
    }
  });

  const actualInternalTextDocuments: TextDocument[] = await Promise.all(
    getCodeMic()
      .session!.rr!._test_internalWorkspace.worktree.getTextDocuments()
      .map(async textDocument => ({
        uri: textDocument.uri,
        content: textDocument.getText(),
        dirty: await getCodeMic().session!.rr!._test_internalWorkspace.worktree.get(textDocument.uri).isDirty(),
        languageId: textDocument.languageId,
      })),
  );

  function getDiff(expected: TextDocument, actual: TextDocument | undefined) {
    if (actual && expected.content !== actual.content) {
      return { uri: expected.uri, expected: expected.content, actual: actual.content };
    }
  }

  function getDiffDirty(expected: TextDocument, actual: TextDocument | undefined) {
    if (expected.dirty !== undefined && actual?.dirty !== undefined && expected.dirty !== actual.dirty) {
      return { uri: expected.uri, expected: expected.dirty, actual: actual.dirty };
    }
  }
  function getDiffLanguageId(expected: TextDocument, actual: TextDocument | undefined) {
    if (actual && expected.languageId !== actual.languageId) {
      return { uri: expected.uri, expected: expected.languageId, actual: actual?.languageId };
    }
  }

  const missingActualVsc = _.differenceBy(expectedTextDocuments, actualVscTextDocuments, 'uri');
  const dirtyMissingActualVsc = _.filter(missingActualVsc, 'dirty');
  const extraActualVsc = _.differenceBy(actualVscTextDocuments, expectedTextDocuments, 'uri');
  const dirtyExtraActualVsc = _.filter(extraActualVsc, 'dirty');
  const diffContentVsc = _.compact(
    _.map(expectedTextDocuments, expected => getDiff(expected, _.find(actualVscTextDocuments, ['uri', expected.uri]))),
  );
  const diffDirtyVsc = _.compact(
    _.map(expectedTextDocuments, expected =>
      getDiffDirty(expected, _.find(actualVscTextDocuments, ['uri', expected.uri])),
    ),
  );
  const diffLanguageIdVsc = _.compact(
    _.map(expectedTextDocuments, expected =>
      getDiffLanguageId(expected, _.find(actualVscTextDocuments, ['uri', expected.uri])),
    ),
  );

  const extraActualInternal = _.differenceBy(actualInternalTextDocuments, expectedTextDocuments, 'uri');
  const dirtyExtraActualInternal = _.filter(extraActualInternal, 'dirty');
  const missingActualInternal = _.differenceBy(expectedTextDocuments, actualInternalTextDocuments, 'uri');
  const diffContentInternal = _.compact(
    _.map(expectedTextDocuments, expected =>
      getDiff(expected, _.find(actualInternalTextDocuments, ['uri', expected.uri])),
    ),
  );
  const diffDirtyInternal = _.compact(
    _.map(expectedTextDocuments, expected =>
      getDiffDirty(expected, _.find(actualInternalTextDocuments, ['uri', expected.uri])),
    ),
  );
  const diffLanguageIdInternal = _.compact(
    _.map(expectedTextDocuments, expected =>
      getDiffLanguageId(expected, _.find(actualInternalTextDocuments, ['uri', expected.uri])),
    ),
  );

  const errors = [];

  if (dirtyMissingActualVsc.length > 0) {
    errors.push(`missing text document(s) in vscode: ${dirtyMissingActualVsc.map(x => x.uri).join(', ')}`);
  }
  if (dirtyExtraActualVsc.length > 0) {
    errors.push(`extra text document(s) in vscode: ${dirtyExtraActualVsc.map(x => x.uri).join(', ')}`);
  }
  if (diffContentVsc.length > 0) {
    errors.push(`unexpected text document content(s) in vscode: ${lib.pretty(diffContentVsc)}`);
  }
  if (diffDirtyVsc.length > 0) {
    errors.push(`different text document dirty state(s) in vscode: ${lib.pretty(diffDirtyVsc)}`);
  }
  if (diffLanguageIdVsc.length > 0) {
    errors.push(`different text document language IDs in vscode: ${lib.pretty(diffLanguageIdVsc)}`);
  }

  if (missingActualInternal.length > 0) {
    errors.push(`missing text document(s) in internal: ${missingActualInternal.map(x => x.uri).join(', ')}`);
  }
  if (dirtyExtraActualInternal.length > 0) {
    errors.push(`extra text document(s) in internal: ${dirtyExtraActualInternal.map(x => x.uri).join(', ')}`);
  }
  if (diffContentInternal.length > 0) {
    errors.push(`unexpected text document content(s) in internal: ${lib.pretty(diffContentInternal)}`);
  }
  if (diffDirtyInternal.length > 0) {
    errors.push(`different text document dirty state(s) in internal: ${lib.pretty(diffDirtyInternal)}`);
  }
  if (diffLanguageIdInternal.length > 0) {
    errors.push(`different text document language IDs in internal: ${lib.pretty(diffLanguageIdInternal)}`);
  }

  assert.ok(errors.length === 0, `At ${label}: found ${errors.length} error(s):\n\n${errors.join('\n\n')}`);
}

async function checkTextEditorsAtClock(testClockPath: string, sessionHandle: string, label: string, meta: t.TestMeta) {
  // Compare text editors' selections and visibleRange against internal
  // Compare text editors' selections and visibleRange against vscode

  const originalActiveTextEditor = vscode.window.activeTextEditor;

  const internalWorkspace = getCodeMic().session!.rr!._test_internalWorkspace;
  const vscWorkspace = getCodeMic().session!.rr!._test_vscWorkspace;
  const actualVscTextEditors: t.TestMetaTextEditor[] = await Promise.all(
    vscWorkspace.getRelevantTabVscUris().map(async vscUri => {
      const vscTextEditor = await vscWorkspace.showTextDocumentByVscUri(vscUri);
      return {
        uri: vscWorkspace.uriFromVsc(vscUri),
        selections: VscWorkspace.fromVscSelections(vscTextEditor.selections),
        visibleRange: VscWorkspace.fromVscLineRange(vscTextEditor.visibleRanges[0]),
      };
    }),
  );
  const actualInternalTextEditors: t.TestMetaTextEditor[] = internalWorkspace.worktree
    .getTextEditors()
    .map(textEditor => ({
      uri: textEditor.uri,
      selections: textEditor.selections,
      visibleRange: textEditor.visibleRange,
    }));

  function getDiff(expected: t.TestMetaTextEditor, actual: t.TestMetaTextEditor | undefined) {
    if (
      expected &&
      actual &&
      (!lib.selAreEqual(expected.selections, actual.selections) ||
        !lib.lineRangeIsEqual(expected.visibleRange, actual.visibleRange))
    ) {
      return { uri: expected.uri, expected: _.omit(expected, 'uri'), actual: _.omit(actual, 'uri') };
    }
  }

  const extraActualVsc = _.differenceBy(actualVscTextEditors, meta.openTextEditors, 'uri');
  const missingActualVsc = _.differenceBy(meta.openTextEditors, actualVscTextEditors, 'uri');
  const diffVsc = _.compact(
    _.map(meta.openTextEditors, expected => getDiff(expected, _.find(actualVscTextEditors, ['uri', expected.uri]))),
  );

  const extraActualInternal = _.differenceBy(actualInternalTextEditors, meta.openTextEditors, 'uri');
  const missingActualInternal = _.differenceBy(meta.openTextEditors, actualInternalTextEditors, 'uri');
  const diffInternal = _.compact(
    _.map(meta.openTextEditors, expected =>
      getDiff(expected, _.find(actualInternalTextEditors, ['uri', expected.uri])),
    ),
  );

  const errors = [];

  if (missingActualVsc.length > 0) {
    errors.push(`missing text editor(s) in vscode: ${missingActualVsc.map(x => x.uri).join(', ')}`);
  }
  if (extraActualVsc.length > 0) {
    errors.push(`extra text editor(s) in vscode: ${extraActualVsc.map(x => x.uri).join(', ')}`);
  }
  if (diffVsc.length > 0) {
    errors.push(`unexpected text editor state(s) in vscode: ${lib.pretty(diffVsc)}`);
  }

  if (missingActualInternal.length > 0) {
    errors.push(`missing text editor(s) in internal: ${missingActualInternal.map(x => x.uri).join(', ')}`);
  }
  if (extraActualInternal.length > 0) {
    errors.push(`extra text editor(s) in internal: ${extraActualInternal.map(x => x.uri).join(', ')}`);
  }
  if (diffInternal.length > 0) {
    errors.push(`unexpected text editor state(s) in internal: ${lib.pretty(diffInternal)}`);
  }

  if (meta.activeTextEditor !== internalWorkspace.worktree.activeTextEditorUri) {
    errors.push(
      `unexpected internal active text editor: expected ${meta.activeTextEditor}, actual: ${internalWorkspace.worktree.activeTextEditorUri}`,
    );
  }

  let vscActiveTextEditorUri: string | undefined;
  if (originalActiveTextEditor && vscWorkspace.shouldRecordVscUri(originalActiveTextEditor.document.uri)) {
    vscActiveTextEditorUri = vscWorkspace.uriFromVsc(originalActiveTextEditor.document.uri);
  }
  if (meta.activeTextEditor !== vscActiveTextEditorUri) {
    errors.push(
      `unexpected vscode active text editor: expected ${meta.activeTextEditor}, actual: ${vscActiveTextEditorUri}`,
    );
  }

  // Restore active text editor.
  if (originalActiveTextEditor) {
    // Don't use this.openTextDocumentByVscUri because it refuses to
    // open untitled documents with associated files.
    await vscode.window.showTextDocument(originalActiveTextEditor.document);
  }

  if (errors.length) debugger;

  assert.ok(errors.length === 0, `At ${label}: found ${errors.length} error(s):\n\n${errors.join('\n\n')}`);
}
