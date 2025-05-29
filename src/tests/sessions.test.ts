import * as assert from 'assert';
import fs from 'fs';
import path from 'path';
import _ from 'lodash';
import * as vscode from 'vscode';
import CodeMic from '../extension/codemic.js';
import * as lib from '../lib/lib.js';
import { inspect } from 'util';
import { URI } from 'vscode-uri';

const projectPath = path.resolve(__dirname, '..');
const workspacePath = path.resolve(projectPath, 'test_data/test_workspace');

suite('Sessions Test Suite', () => {
  test('Session1', async () => {
    const sessionHandle = 'session1';
    const head = JSON.parse(
      fs.readFileSync(path.resolve(projectPath, 'test_data/sessions', sessionHandle, 'CodeMic', 'head.json'), 'utf8'),
    );

    await prepareForSession(sessionHandle);

    await getCodeMic().handleMessage({ type: 'welcome/openSessionInRecorder', sessionId: head.id });
    assert.strictEqual(getCodeMic().session?.head.id, head.id);
    assert.strictEqual(getCodeMic().recorder?.tabId, 'editor-view');

    const clocks = readAvailableClocks(sessionHandle);
    for (const clock of clocks) {
      // Seek if necessary.
      if (clock !== getCodeMic().session!.rr!.clock) {
        await getCodeMic().handleMessage({ type: 'recorder/seek', clock });
      }

      // Check files and open text documents.
      checkFilesAtClock(sessionHandle, clock);
      checkOpenTextDocumentsAtClock(sessionHandle, clock);
    }

    // test('wait', async () => {
    //   await timeout(30_000);
    // });
  });
});

function checkFilesAtClock(sessionHandle: string, clock: number) {
  const expectedFilesPath = path.resolve(projectPath, 'test_data/sessions', sessionHandle, `clock_${clock}`, 'files');
  const expectedFiles = fs.readdirSync(expectedFilesPath, { recursive: true, encoding: 'utf8' });
  const actualFiles = fs
    .readdirSync(workspacePath, { recursive: true, encoding: 'utf8' })
    .filter(x => !x.startsWith('.CodeMic'));

  const missingActualFiles = _.difference(expectedFiles, actualFiles);
  const extraActualFiles = _.difference(actualFiles, expectedFiles);

  // Compare file names.
  assert.ok(
    missingActualFiles.length === 0,
    `At ${clock}, the following files are missing: ${missingActualFiles.join(', ')}`,
  );
  assert.ok(
    extraActualFiles.length === 0,
    `At ${clock}, the following files are extra: ${extraActualFiles.join(', ')}`,
  );

  // Compare content.
  for (const file of expectedFiles) {
    const expectedStat = fs.statSync(path.resolve(expectedFilesPath, file));
    if (expectedStat.isFile()) {
      const expectedContent = fs.readFileSync(path.resolve(expectedFilesPath, file), 'utf8');
      const actualContent = fs.readFileSync(path.resolve(workspacePath, file), 'utf8');
      assert.strictEqual(actualContent, expectedContent, `At ${clock}, found unexpected content in file ${file}`);
    } else if (expectedStat.isDirectory()) {
      assert.ok(
        fs.statSync(path.resolve(workspacePath, file)).isDirectory(),
        `At ${clock}, expected directory at ${file}`,
      );
    } else {
      assert.fail(`At ${clock}, found expected file of unknown type at ${file}`);
    }
  }
}

function checkOpenTextDocumentsAtClock(sessionHandle: string, clock: number) {
  const expectedOpenTextDocumentsPath = path.resolve(
    projectPath,
    'test_data/sessions',
    sessionHandle,
    `clock_${clock}`,
    'open_text_documents',
  );
  const expectedOpenTextDocumentsPaths = fs.readdirSync(expectedOpenTextDocumentsPath, {
    recursive: true,
    encoding: 'utf8',
  });

  const expectedOpenTextDocuments: { content: string; uri: string }[] = expectedOpenTextDocumentsPaths.map(p => {
    const content = fs.readFileSync(path.resolve(expectedOpenTextDocumentsPath, p), 'utf8');
    console.log('XXX: ', p, ':', JSON.stringify(content));
    if (p.startsWith('Untitled-')) {
      return { uri: URI.from({ scheme: 'untitled', path: p }).toString(), content };
    } else {
      return { uri: lib.workspaceUri(p), content };
    }
  });

  const actualOpenTextDocuments: { content: string; uri: string }[] = vscode.workspace.textDocuments.map(
    textDocument => {
      const content = textDocument.getText();

      switch (textDocument.uri.scheme) {
        case 'file':
          return { uri: lib.workspaceUriFrom(workspacePath, textDocument.uri.fsPath), content };
        case 'untitled':
          return { uri: URI.from({ scheme: 'untitled', path: textDocument.uri.path }).toString(), content };
        default:
          throw new Error(`unknown scheme: ${textDocument.uri.scheme}`);
      }
    },
  );

  const missingActual = _.differenceBy(expectedOpenTextDocuments, actualOpenTextDocuments, 'uri');
  const extraActual = _.differenceBy(actualOpenTextDocuments, expectedOpenTextDocuments, 'uri');

  // Compare text document uris.
  assert.ok(
    missingActual.length === 0,
    `At ${clock}, the following text documents are expected to be open: ${missingActual.map(x => x.uri).join(', ')}`,
  );
  assert.ok(
    extraActual.length === 0,
    `At ${clock}, the following text documents are not expected to be open: ${extraActual.map(x => x.uri).join(', ')}`,
  );

  // Compare text document contents.
  for (const expected of expectedOpenTextDocuments) {
    const actual = _.find(actualOpenTextDocuments, ['uri', expected.uri]);
    assert.ok(actual);
    assert.strictEqual(
      actual.content,
      expected.content,
      `At ${clock}, found unexpected content in open text document ${actual.uri}`,
    );
  }
}

function readAvailableClocks(sessionHandle: string): number[] {
  return fs
    .readdirSync(path.resolve(projectPath, 'test_data/sessions', sessionHandle), 'utf8')
    .map(x => x.match(/^clock_(\d+)$/)?.[1])
    .filter(Boolean)
    .map(Number);
}

// function checkFilesAgainstExpectations(exp: TestExpectation) {
//   const workspaceFiles = fs.readdirSync(workspacePath, { recursive: true, encoding: 'utf8' });

//   for (const f of workspaceFiles) {
//     const filepath = path.resolve(workspacePath, f);
//     const stat = fs.statSync(filepath);
//     if (stat.isFile()) {
//       const expPart = exp.parts.find(part => part.type === 'file' && part.path === f) as TestFileExpectation;
//       assert.ok(expPart, `At ${exp.clock}: file ${f} is not expected to be in the workspace`);
//       const content = fs.readFileSync(filepath, { encoding: 'utf8' });
//       assert.strictEqual(content, expPart.content, `At ${exp.clock}: file ${f}'s content does not match expectation`);
//     }
//   }

//   for (const part of exp.parts) {
//     if (part.type === 'file') {
//       const found = workspaceFiles.find(f => part.path === f);
//       assert.ok(found, `At ${exp.clock}: file ${part.path} was expected but not found in the workspace`);
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
  await vscode.commands.executeCommand('codemic.openHome');
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
