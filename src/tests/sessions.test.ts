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

const projectPath = path.resolve(__dirname, '..'); // relative to dist
const workspacePath = path.resolve(projectPath, 'test_data/test_workspace');
const testSessionsPath = path.resolve(projectPath, 'test_data/sessions');

type SessionTestStep = {
  clock: number;
  clockStr: string;
  useStepper: boolean;
};

// Dynamic tests using fs messes up the vscode test extension. It still works but vscode
// cannot show the list of tests.
// const testSessions = fs.readdirSync(testSessionsPath, { encoding: 'utf8' });
suite('Sessions Test Suite', () => {
  test('Session my_test_session', () => testSession('my_test_session'));
  test('Session save_untitled', () => testSession('save_untitled'));
});

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
      console.log(`#${i + 1} New test plan: ${steps.map(sessionTestStepToString).join(' -> ')}`);

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
    checkTextDocumentsAtClock(testClockPath, sessionHandle, label, meta);
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

function checkTextDocumentsAtClock(testClockPath: string, sessionHandle: string, label: string, meta: t.TestMeta) {
  // Compare text documents' content against internal
  // Compare text documents' content against vscode
  // Must not have extra internal text documents
  // Must not have extra *dirty* vscode documents

  type TextDocument = { content: string; uri: string; dirty?: boolean };

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
        return { uri, content, dirty: meta.dirtyTextDocuments.includes(uri) };
      } else {
        const uri = lib.workspaceUri(p);
        return { uri, content, dirty: meta.dirtyTextDocuments.includes(uri) };
      }
    }),
  );

  const actualVscTextDocuments: TextDocument[] = vscode.workspace.textDocuments.map(textDocument => {
    const content = textDocument.getText();

    switch (textDocument.uri.scheme) {
      case 'file': {
        const uri = lib.workspaceUriFrom(workspacePath, textDocument.uri.fsPath);
        return { uri, content, dirty: meta.dirtyTextDocuments.includes(uri) };
      }
      case 'untitled': {
        const uri = URI.from({ scheme: 'untitled', path: textDocument.uri.path }).toString();
        return { uri, content, dirty: meta.dirtyTextDocuments.includes(uri) };
      }
      default:
        throw new Error(`unknown scheme: ${textDocument.uri.scheme}`);
    }
  });

  const actualInternalTextDocuments: TextDocument[] =
    getCodeMic().session!.rr!._test_internalWorkspace.textDocuments.map(textDocument => {
      return { uri: textDocument.uri, content: textDocument.getText() };
    });

  function getDiff(expected: TextDocument, actual: TextDocument | undefined) {
    if (expected && actual && expected.content !== actual.content) {
      return { uri: expected.uri, expected: expected.content, actual: actual.content };
    }
  }

  function getDiffDirty(expected: TextDocument, actual: TextDocument | undefined) {
    if (expected?.dirty !== undefined && actual?.dirty !== undefined && expected.dirty !== actual.dirty) {
      return { uri: expected.uri, expected: expected.dirty, actual: actual.dirty };
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

  const extraActualInternal = _.differenceBy(actualInternalTextDocuments, expectedTextDocuments, 'uri');
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

  const errors = [];

  if (dirtyMissingActualVsc.length > 0) {
    errors.push(`missing text document(s) in vscode: ${dirtyMissingActualVsc.map(x => x.uri).join(', ')}`);
  }
  if (dirtyExtraActualVsc.length > 0) {
    errors.push(`extra text document(s) in vscode: ${dirtyExtraActualVsc.map(x => x.uri).join(', ')}`);
  }
  if (diffContentVsc.length > 0) {
    errors.push(`unexpected text document content(s) in vscode: ${JSON.stringify(diffContentVsc, null, 2)}`);
  }
  if (diffDirtyVsc.length > 0) {
    errors.push(`different text document dirty state(s) in vscode: ${JSON.stringify(diffDirtyVsc, null, 2)}`);
  }

  if (missingActualInternal.length > 0) {
    errors.push(`missing text document(s) in internal: ${missingActualInternal.map(x => x.uri).join(', ')}`);
  }
  if (extraActualInternal.length > 0) {
    errors.push(`extra text document(s) in internal: ${extraActualInternal.map(x => x.uri).join(', ')}`);
  }
  if (diffContentInternal.length > 0) {
    errors.push(`unexpected text document content(s) in internal: ${JSON.stringify(diffContentInternal, null, 2)}`);
  }
  if (diffDirtyInternal.length > 0) {
    errors.push(`different text document dirty state(s) in internal: ${JSON.stringify(diffDirtyInternal, null, 2)}`);
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
  const actualInternalTextEditors: t.TestMetaTextEditor[] = internalWorkspace.textEditors.map(textEditor => ({
    uri: textEditor.document.uri,
    selections: textEditor.selections,
    visibleRange: textEditor.visibleRange,
  }));

  function getDiff(expected: t.TestMetaTextEditor, actual: t.TestMetaTextEditor | undefined) {
    if (
      expected &&
      actual &&
      (!lib.areSelectionsEqual(expected.selections, actual.selections) ||
        !expected.visibleRange.isEqual(actual.visibleRange))
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
    errors.push(`unexpected text editor state(s) in vscode: ${JSON.stringify(diffVsc, null, 2)}`);
  }

  if (missingActualInternal.length > 0) {
    errors.push(`missing text editor(s) in internal: ${missingActualInternal.map(x => x.uri).join(', ')}`);
  }
  if (extraActualInternal.length > 0) {
    errors.push(`extra text editor(s) in internal: ${extraActualInternal.map(x => x.uri).join(', ')}`);
  }
  if (diffInternal.length > 0) {
    errors.push(`unexpected text editor state(s) in internal: ${JSON.stringify(diffInternal, null, 2)}`);
  }

  if (meta.activeTextEditor !== internalWorkspace.activeTextEditor?.document.uri) {
    errors.push(
      `unexpected internal active text editor: expected ${meta.activeTextEditor}, actual: ${internalWorkspace.activeTextEditor?.document.uri}`,
    );
  }

  const vscActiveTextEditorUri =
    originalActiveTextEditor && vscWorkspace.uriFromVsc(originalActiveTextEditor.document.uri);
  if (meta.activeTextEditor !== vscActiveTextEditorUri) {
    errors.push(
      `unexpected vscode active text editor: expected ${meta.activeTextEditor}, actual: ${vscActiveTextEditorUri}`,
    );
  }

  // Restore active text editor.
  if (originalActiveTextEditor) {
    await vscode.window.showTextDocument(originalActiveTextEditor.document);
  }

  assert.ok(errors.length === 0, `At ${label}: found ${errors.length} error(s):\n\n${errors.join('\n\n')}`);
}

function readAvailableClockStrs(sessionHandle: string): string[] {
  return _.compact(
    fs
      .readdirSync(path.resolve(projectPath, 'test_data/sessions', sessionHandle), 'utf8')
      .map(x => x.match(/^clock_([\d\.]+)$/)?.[1]),
  );
}

// function checkFilesAgainstExpectations(exp: TestExpectation) {
//   const workspaceFiles = fs.readdirSync(workspacePath, { recursive: true, encoding: 'utf8' });

//   for (const f of workspaceFiles) {
//     const filepath = path.resolve(workspacePath, f);
//     const stat = fs.statSync(filepath);
//     if (stat.isFile()) {
//       const expPart = exp.parts.find(part => part.type === 'file' && part.path === f) as TestFileExpectation;
//       assert.ok(expPart, `At ${exp.label}: file ${f} is not expected to be in the workspace`);
//       const content = fs.readFileSync(filepath, { encoding: 'utf8' });
//       assert.strictEqual(content, expPart.content, `At ${exp.label}: file ${f}'s content does not match expectation`);
//     }
//   }

//   for (const part of exp.parts) {
//     if (part.type === 'file') {
//       const found = workspaceFiles.find(f => part.path === f);
//       assert.ok(found, `At ${exp.label}: file ${part.path} was expected but not found in the workspace`);
//     }
//   }
// }

function getCodeMic(): CodeMic {
  return getCodeMicExtension().exports;
}

function getCodeMicExtension(): vscode.Extension<CodeMic> {
  const ext = vscode.extensions.getExtension<CodeMic>('ComputingDen.codemic');
  assert.ok(ext);
  return ext;
}

async function prepareForSession(sessionHandle: string) {
  await openCodeMicView();

  // Go to welcome page / refresh welcome page.
  await vscode.commands.executeCommand('codemic.openHome');

  // Delete workspace content
  for (const file of fs.readdirSync(workspacePath)) {
    fs.rmSync(path.resolve(workspacePath, file), { recursive: true });
  }

  // Copy session into workspace.
  fs.cpSync(
    path.resolve(projectPath, 'test_data/sessions', sessionHandle, 'CodeMic'),
    path.resolve(workspacePath, '.CodeMic'),
    { recursive: true },
  );

  // Go to welcome page / refresh welcome page.
  await vscode.commands.executeCommand('codemic.refreshHome');
}

async function openSessionInRecorder(id: string) {
  await getCodeMic().handleMessage({ type: 'welcome/openSessionInRecorder', sessionId: id });
  assert.strictEqual(getCodeMic().session?.head.id, id);
  assert.strictEqual(getCodeMic().recorder?.tabId, 'editor-view');
}

// function getWorkspacePath(): string {
//   const workspacePath = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
//   assert.ok(workspacePath, 'workspace not set');
//   return workspacePath;
// }

async function openCodeMicView() {
  if (!getCodeMicExtension().isActive) {
    await getCodeMicExtension().activate();
  }
  assert.ok(getCodeMicExtension().isActive);
  await vscode.commands.executeCommand('workbench.view.extension.codemic-view-container');
  await vscode.commands.executeCommand('codemic-view.focus');
  assert.ok(getCodeMic().context.webviewProvider.visible);
}

function createRandomSessionTestSteps(clockStrs: string[]): SessionTestStep[] {
  let resClockStrs = _.orderBy(clockStrs, Number);
  for (let i = 0; i < clockStrs.length * (config.testComplexityMultiplier ?? 1); i++) {
    const candidate = _.sample(clockStrs);
    if (candidate && candidate !== resClockStrs.at(-1)) resClockStrs.push(candidate);
  }

  return resClockStrs.map(clockStr => ({ clockStr, clock: Number(clockStr), useStepper: _.sample([true, false]) }));
}

function sessionTestStepToString(step: SessionTestStep): string {
  return (step.useStepper ? 'step:' : 'sync:') + step.clockStr;
}
