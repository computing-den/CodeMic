import * as assert from 'assert';
import fs from 'fs';
import path from 'path';
import _ from 'lodash';
import * as vscode from 'vscode';
import CodeMic from '../extension/codemic.js';
import config from '../extension/config.js';
import { EditorEvent } from '../lib/types.js';

export type SessionTestStep = {
  clock: number;
  clockStr: string;
  useStepper: boolean;
};

export const projectPath = path.resolve(__dirname, '..'); // relative to dist
export const workspacePath = path.resolve(projectPath, 'test_data/test_workspace');
export const testSessionsPath = path.resolve(projectPath, 'test_data/sessions');
export const exampleFilesPath = path.resolve(projectPath, 'test_data/example_files');

export function readAvailableClockStrs(sessionHandle: string): string[] {
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

export function getCodeMic(): CodeMic {
  return getCodeMicExtension().exports;
}

export function getCodeMicExtension(): vscode.Extension<CodeMic> {
  const ext = vscode.extensions.getExtension<CodeMic>('ComputingDen.codemic');
  assert.ok(ext);
  return ext;
}

export async function prepareForSession(sessionHandle: string) {
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

export async function openSessionInRecorder(id: string) {
  await getCodeMic().handleMessage({ type: 'welcome/openSessionInRecorder', sessionId: id });
  assert.strictEqual(getCodeMic().session?.head.id, id);
  assert.strictEqual(getCodeMic().recorder?.tabId, 'editor-view');
}

// function getWorkspacePath(): string {
//   const workspacePath = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
//   assert.ok(workspacePath, 'workspace not set');
//   return workspacePath;
// }

export async function openCodeMicView() {
  if (!getCodeMicExtension().isActive) {
    await getCodeMicExtension().activate();
  }
  assert.ok(getCodeMicExtension().isActive);
  await vscode.commands.executeCommand('workbench.view.extension.codemic-view-container');
  await vscode.commands.executeCommand('codemic-view.focus');
  assert.ok(getCodeMic().context.webviewProvider.visible);
}

export function createRandomSessionTestSteps(clockStrs: string[]): SessionTestStep[] {
  let resClockStrs = _.orderBy(clockStrs, Number);
  for (let i = 0; i < clockStrs.length * (config.testComplexityMultiplier ?? 1); i++) {
    const candidate = _.sample(clockStrs);
    if (candidate && candidate !== resClockStrs.at(-1)) resClockStrs.push(candidate);
  }

  return resClockStrs.map(clockStr => ({ clockStr, clock: Number(clockStr), useStepper: _.sample([true, false]) }));
}

export function sessionTestStepToString(step: SessionTestStep): string {
  return (step.useStepper ? 'step:' : 'sync:') + step.clockStr;
}

export async function closeAllTabs() {
  for (const tabGroup of vscode.window.tabGroups.all) {
    for (const tab of tabGroup.tabs) {
      await vscode.window.tabGroups.close(tab);
    }
  }
}

export function areEventsEqual(actual: EditorEvent[], expected: EditorEvent[]) {
  return _.isEqualWith(actual, expected, (a, b, key) => (key === 'clock' ? true : undefined));
}
