import vscode, { WorkspaceEdit } from 'vscode';
import * as assert from 'assert';
import fs from 'fs';
import path from 'path';
import _ from 'lodash';
import * as lib from '../lib/lib.js';
import { pathExists } from '../extension/storage.js';
import {
  areEventsAlmostEqual,
  closeAllTabs,
  exampleFilesPath,
  getCodeMic,
  isEventAlmostEqual,
  openCodeMicView,
  repeater,
  workspacePath,
} from './test-helpers.js';
import config from '../extension/config.js';
import { EditorEvent, EndOfLine } from '../lib/types.js';

const EOL = '\n';

// suite('Recorder', () => {
test('fs changes', recordFsChanges);
test('showTextEditor event without openTextDocument', recordOpenTextEditorWithoutDocument);
test('rename file', recordRenameFile);
test('rename file and open again immediately', recordRenameFileAndOpenAgainImmediately);
test('rename file and open again with delay', recordRenameFileAndOpenAgainWithDelay);
test('start with dirty document then open and and save', recordStartWithDirtydocsOpenAndSave);
test('save json with prettier.js', recordSaveJSONWithPrettierJs);
// });

async function recordFsChanges() {
  // Deleting workspacePath directly will interfere with file system watcher.
  // fs.rmSync(path.resolve(workspacePath), { recursive: true });
  log(`=== Creating files in ${workspacePath}`);
  fs.readdirSync(workspacePath, 'utf8').forEach(p => fs.rmSync(path.resolve(workspacePath, p), { recursive: true }));
  fs.mkdirSync(path.resolve(workspacePath, 'src'), { recursive: true });
  fs.mkdirSync(path.resolve(workspacePath, 'images'), { recursive: true });
  fs.writeFileSync(path.resolve(workspacePath, 'README.txt'), `Hello there!${EOL}`);
  fs.writeFileSync(path.resolve(workspacePath, 'src/inside.txt'), `Inside text${EOL}Second line${EOL}`);
  fs.writeFileSync(
    path.resolve(workspacePath, 'src/main.c'),
    `#include <stdio.h>${EOL}${EOL}int main() {${EOL}    return 0;${EOL}}${EOL}`,
  );
  fs.cpSync(path.resolve(exampleFilesPath, '1.jpg'), path.resolve(workspacePath, 'images/1.jpg'), { force: true });
  fs.cpSync(path.resolve(exampleFilesPath, '2.jpg'), path.resolve(workspacePath, 'images/2.jpg'), { force: true });

  log(`=== Closing all tabs`);
  await closeAllTabs();
  log(`=== Opening CodeMic view`);
  await openCodeMicView();
  const codemic = getCodeMic();

  log(`=== Opening new session`);
  await codemic.handleMessage({ type: 'welcome/openNewSessionInRecorder' });
  await codemic.handleMessage({
    type: 'recorder/updateDetails',
    changes: { title: 'Test Session 1', handle: 'test_session_1' },
  });
  log(`=== Scanning new session`);
  await codemic.handleMessage({ type: 'recorder/load', skipConfirmation: true });

  assert.ok(await pathExists(path.resolve(workspacePath, '.CodeMic', 'head.json')), 'head.json does not exist');
  assert.ok(await pathExists(path.resolve(workspacePath, '.CodeMic', 'body.json')), 'body.json does not exist');

  log(`=== Start recording`);
  await codemic.handleMessage({ type: 'recorder/record' });
  await lib.timeout(100);

  log(`=== Create 3.jpg`);
  fs.cpSync(path.resolve(exampleFilesPath, '3.jpg'), path.resolve(workspacePath, 'images/3.jpg'), { force: true });
  await lib.timeout(100);

  log(`=== Change 1.jpg`);
  fs.cpSync(path.resolve(exampleFilesPath, '4.jpg'), path.resolve(workspacePath, 'images/1.jpg'), { force: true });
  await lib.timeout(100);

  log(`=== Delete 2.jpg`);
  fs.rmSync(path.resolve(workspacePath, 'images/2.jpg'), { force: true });
  await lib.timeout(100);

  log(`=== Pause`);
  await lib.timeout(200); // Let fs events be processed.
  await codemic.handleMessage({ type: 'recorder/pause' });

  log(`=== seek to 0`);
  await codemic.handleMessage({ type: 'recorder/seek', clock: 0 });

  log(`=== Resume recording`);
  await codemic.handleMessage({ type: 'recorder/record' });
  await lib.timeout(300);

  const actualFiles = fs
    .readdirSync(workspacePath, { recursive: true, encoding: 'utf8' })
    .map(p => p.replace(/\\/g, '/'));
  const expectedFiles = [
    '.CodeMic',
    'README.txt',
    'images',
    'src',
    '.CodeMic/blobs',
    '.CodeMic/body.json',
    '.CodeMic/head.json',
    'images/1.jpg',
    'images/3.jpg',
    'src/inside.txt',
    'src/main.c',
    '.CodeMic/blobs/0eb737949842ed40e8ec946ec14055977bb4f265',
    '.CodeMic/blobs/4af48d75a1b93895baa67568f3b7903e723e23e2',
    '.CodeMic/blobs/752a116b21f12e8e8826cd7b25bd32ddeee480bf',
    '.CodeMic/blobs/c2d38c73bb59ed15790b19661bf31a53b5e856b9',
    '.CodeMic/blobs/c3d880f1ad32e1ff90bb87a79c56efa553c66023',
    '.CodeMic/blobs/d6688b7b322bcc76be5690a58d76b9b9386216dc',
    '.CodeMic/blobs/f65d313996cb2dcb64c4a28646b89bb7afb2956d',
  ];

  const extraActualFiles = _.difference(actualFiles, expectedFiles);
  const missingActualFiles = _.difference(expectedFiles, actualFiles);

  const errors = [];
  if (extraActualFiles.length) {
    errors.push(`extra files found: ${extraActualFiles.join(', ')}`);
  }
  if (missingActualFiles.length) {
    errors.push(`missing files: ${missingActualFiles.join(', ')}`);
  }

  const expectedEvents: EditorEvent[] = [
    {
      type: 'fsCreate',
      id: 1,
      uri: 'workspace:README.txt',
      clock: 0,
      file: { type: 'blob', sha1: 'c2d38c73bb59ed15790b19661bf31a53b5e856b9' },
    },
    { type: 'fsCreate', id: 2, uri: 'workspace:images', clock: 0, file: { type: 'dir' } },
    {
      type: 'fsCreate',
      id: 3,
      uri: 'workspace:images/1.jpg',
      clock: 0,
      file: { type: 'blob', sha1: '0eb737949842ed40e8ec946ec14055977bb4f265' },
    },
    {
      type: 'fsCreate',
      id: 4,
      uri: 'workspace:images/2.jpg',
      clock: 0,
      file: { type: 'blob', sha1: 'd6688b7b322bcc76be5690a58d76b9b9386216dc' },
    },
    { type: 'fsCreate', id: 5, uri: 'workspace:src', clock: 0, file: { type: 'dir' } },
    {
      type: 'fsCreate',
      id: 6,
      uri: 'workspace:src/inside.txt',
      clock: 0,
      file: { type: 'blob', sha1: 'f65d313996cb2dcb64c4a28646b89bb7afb2956d' },
    },
    {
      type: 'fsCreate',
      id: 7,
      uri: 'workspace:src/main.c',
      clock: 0,
      file: { type: 'blob', sha1: 'c3d880f1ad32e1ff90bb87a79c56efa553c66023' },
    },
    {
      type: 'fsCreate',
      id: 8,
      uri: 'workspace:images/3.jpg',
      clock: 0.10294670399999996,
      file: { type: 'blob', sha1: '4af48d75a1b93895baa67568f3b7903e723e23e2' },
    },
    {
      type: 'fsChange',
      id: 9,
      uri: 'workspace:images/1.jpg',
      clock: 0.3051207520000003,
      file: { type: 'blob', sha1: '752a116b21f12e8e8826cd7b25bd32ddeee480bf' },
      revFile: { type: 'blob', sha1: '0eb737949842ed40e8ec946ec14055977bb4f265' },
    },
    {
      type: 'fsDelete',
      id: 10,
      uri: 'workspace:images/2.jpg',
      clock: 0.4067855650000001,
      revFile: { type: 'blob', sha1: 'd6688b7b322bcc76be5690a58d76b9b9386216dc' },
    },
  ];
  const actualEvents = JSON.parse(lib.pretty(codemic.session!.body?.editorEvents!));

  const areEqual = areEventsAlmostEqual(actualEvents, expectedEvents);
  if (!areEqual) {
    errors.push(
      `unexpected editor events.\nActual: ${lib.pretty(actualEvents)}\nExpected: ${lib.pretty(expectedEvents)}`,
    );
  }

  assert.ok(errors.length === 0, `found ${errors.length} error(s):\n\n${errors.join('\n\n')}`);

  // await lib.timeout(1_000_000);
}

async function recordOpenTextEditorWithoutDocument() {
  log(`=== Creating files in ${workspacePath}`);
  fs.readdirSync(workspacePath, 'utf8').forEach(p => fs.rmSync(path.resolve(workspacePath, p), { recursive: true }));
  fs.mkdirSync(path.resolve(workspacePath, 'src'), { recursive: true });
  fs.mkdirSync(path.resolve(workspacePath, 'images'), { recursive: true });
  fs.writeFileSync(path.resolve(workspacePath, 'README.txt'), `Hello there!${EOL}`);
  fs.writeFileSync(path.resolve(workspacePath, 'src/inside.txt'), `Inside text${EOL}Second line${EOL}`);
  fs.writeFileSync(
    path.resolve(workspacePath, 'src/main.c'),
    `#include <stdio.h>${EOL}${EOL}int main() {${EOL}    return 0;${EOL}}${EOL}`,
  );

  log(`=== Closing all tabs`);
  await closeAllTabs();
  log(`=== Opening CodeMic view`);
  await openCodeMicView();
  const codemic = getCodeMic();

  log(`=== Opening new session`);
  await codemic.handleMessage({ type: 'welcome/openNewSessionInRecorder' });
  await lib.timeout(200);
  await codemic.handleMessage({
    type: 'recorder/updateDetails',
    changes: { title: 'showTextEditor event without openTextDocument', handle: 'show_text_editor_no_document' },
  });
  await lib.timeout(200);
  log(`=== Scanning new session`);
  await codemic.handleMessage({ type: 'recorder/load', skipConfirmation: true });

  assert.ok(await pathExists(path.resolve(workspacePath, '.CodeMic', 'head.json')), 'head.json does not exist');
  assert.ok(await pathExists(path.resolve(workspacePath, '.CodeMic', 'body.json')), 'body.json does not exist');

  log(`=== Start recording`);
  await codemic.handleMessage({ type: 'recorder/record' });
  await lib.timeout(100);

  log(`=== Open main.c`);
  await vscode.workspace.openTextDocument(vscode.Uri.file(path.resolve(workspacePath, 'src/main.c')));
  await lib.timeout(200);

  log(`=== Pause`);
  await codemic.handleMessage({ type: 'recorder/pause' });
  await lib.timeout(3000);

  log(`=== Open inside.txt while on pause`);
  await vscode.workspace.openTextDocument(vscode.Uri.file(path.resolve(workspacePath, 'src/inside.txt')));
  await lib.timeout(1000);

  log(`=== Resume recording`);
  await codemic.handleMessage({ type: 'recorder/record' });
  await lib.timeout(1000);
  await vscode.window.showTextDocument(vscode.Uri.file(path.resolve(workspacePath, 'src/inside.txt')));
  await lib.timeout(200);

  log(`=== Pause`);
  await codemic.handleMessage({ type: 'recorder/pause' });
  await lib.timeout(200);

  const expectedEvents: EditorEvent[] = [
    {
      type: 'fsCreate',
      id: 1,
      uri: 'workspace:README.txt',
      clock: 0,
      file: {
        type: 'blob',
        sha1: 'c2d38c73bb59ed15790b19661bf31a53b5e856b9',
      },
    },
    {
      type: 'fsCreate',
      id: 2,
      uri: 'workspace:images',
      clock: 0,
      file: {
        type: 'dir',
      },
    },
    {
      type: 'fsCreate',
      id: 3,
      uri: 'workspace:src',
      clock: 0,
      file: {
        type: 'dir',
      },
    },
    {
      type: 'fsCreate',
      id: 4,
      uri: 'workspace:src/inside.txt',
      clock: 0,
      file: {
        type: 'blob',
        sha1: 'f65d313996cb2dcb64c4a28646b89bb7afb2956d',
      },
    },
    {
      type: 'fsCreate',
      id: 5,
      uri: 'workspace:src/main.c',
      clock: 0,
      file: {
        type: 'blob',
        sha1: 'c3d880f1ad32e1ff90bb87a79c56efa553c66023',
      },
    },
    {
      type: 'openTextDocument',
      id: 6,
      uri: 'workspace:src/main.c',
      clock: 0.10239563100000032,
      eol: EOL as EndOfLine,
      languageId: 'c',
    },
    {
      type: 'openTextDocument',
      id: 7,
      uri: 'workspace:src/inside.txt',
      clock: 1.3122504769999999,
      eol: EOL as EndOfLine,
      languageId: 'plaintext',
    },
    {
      type: 'showTextEditor',
      id: 8,
      uri: 'workspace:src/inside.txt',
      clock: 0.4705662360000001,
      selections: [
        {
          anchor: {
            line: 0,
            character: 0,
          },
          active: {
            line: 0,
            character: 0,
          },
        },
      ],
      visibleRange: {
        start: 0,
        end: 2,
      },
      justOpened: true,
    },
  ];

  const actualEvents = JSON.parse(lib.pretty(codemic.session!.body?.editorEvents!)) as EditorEvent[];

  const errors: string[] = [];

  const missingActualEvents = _.differenceWith(expectedEvents, actualEvents, isEventAlmostEqual);
  const extraActualEvents = _.differenceWith(actualEvents, expectedEvents, isEventAlmostEqual);

  if (missingActualEvents.length) {
    errors.push(`missing editor event IDs: ${missingActualEvents.map(x => x.id).join(', ')}`);
  }
  if (extraActualEvents.length) {
    errors.push(`extra editor event IDs: ${extraActualEvents.map(x => x.id).join(', ')}`);
  }

  if (missingActualEvents.length || extraActualEvents.length) {
    errors.push(`Actual events: ${lib.pretty(actualEvents)}${EOL}Expected events: ${lib.pretty(expectedEvents)}`);
  }

  assert.ok(errors.length === 0, `found ${errors.length} error(s):\n\n${errors.join('\n\n')}`);

  // log('XXX', lib.pretty(codemic.session!.body?.editorEvents));

  // await lib.timeout(1_000_000);
}

async function recordRenameFile() {
  log(`=== Creating files in ${workspacePath}`);
  fs.readdirSync(workspacePath, 'utf8').forEach(p => fs.rmSync(path.resolve(workspacePath, p), { recursive: true }));
  fs.mkdirSync(path.resolve(workspacePath, 'src'), { recursive: true });
  fs.writeFileSync(
    path.resolve(workspacePath, 'src/main.c'),
    `#include <stdio.h>${EOL}${EOL}int main() {${EOL}    return 0;${EOL}}${EOL}`,
  );

  log(`=== Closing all tabs`);
  await closeAllTabs();
  log(`=== Opening CodeMic view`);
  await openCodeMicView();
  const codemic = getCodeMic();

  log(`=== Opening new session`);
  await codemic.handleMessage({ type: 'welcome/openNewSessionInRecorder' });
  await lib.timeout(200);
  await codemic.handleMessage({
    type: 'recorder/updateDetails',
    changes: { title: 'Rename file', handle: 'rename_file' },
  });
  await lib.timeout(200);
  log(`=== Scanning new session`);
  await codemic.handleMessage({ type: 'recorder/load', skipConfirmation: true });

  assert.ok(await pathExists(path.resolve(workspacePath, '.CodeMic', 'head.json')), 'head.json does not exist');
  assert.ok(await pathExists(path.resolve(workspacePath, '.CodeMic', 'body.json')), 'body.json does not exist');

  log(`=== Start recording`);
  await codemic.handleMessage({ type: 'recorder/record' });
  await lib.timeout(100);

  log(`=== Open main.c`);
  await vscode.window.showTextDocument(vscode.Uri.file(path.resolve(workspacePath, 'src/main.c')));
  await lib.timeout(200);

  log(`=== Rename main.c to new.c`);
  const edit = new WorkspaceEdit();
  edit.renameFile(
    vscode.Uri.file(path.resolve(workspacePath, 'src/main.c')),
    vscode.Uri.file(path.resolve(workspacePath, 'src/new.c')),
  );
  await vscode.workspace.applyEdit(edit);
  await lib.timeout(1000);

  log(`=== Pause`);
  await codemic.handleMessage({ type: 'recorder/pause' });
  await lib.timeout(200);

  const expectedEvents: EditorEvent[] = [
    {
      type: 'fsCreate',
      id: 2,
      uri: 'workspace:src',
      clock: 0,
      file: {
        type: 'dir',
      },
    },
    {
      type: 'fsCreate',
      id: 4,
      uri: 'workspace:src/main.c',
      clock: 0,
      file: {
        type: 'blob',
        sha1: 'c3d880f1ad32e1ff90bb87a79c56efa553c66023',
      },
    },
    {
      type: 'openTextDocument',
      id: 5,
      uri: 'workspace:src/main.c',
      clock: 0.10272586700000011,
      eol: EOL as EndOfLine,
      languageId: 'c',
    },
    {
      type: 'showTextEditor',
      id: 6,
      uri: 'workspace:src/main.c',
      clock: 0.10272586700000011,
      selections: [
        {
          anchor: {
            line: 0,
            character: 0,
          },
          active: {
            line: 0,
            character: 0,
          },
        },
      ],
      visibleRange: {
        start: 0,
        end: 5,
      },
      justOpened: true,
    },
    {
      type: 'closeTextEditor',
      id: 7,
      uri: 'workspace:src/main.c',
      clock: 0.45762532299999975,
      active: true,
      revSelections: [
        {
          anchor: {
            line: 0,
            character: 0,
          },
          active: {
            line: 0,
            character: 0,
          },
        },
      ],
      revVisibleRange: {
        start: 0,
        end: 5,
      },
    },
    {
      type: 'openTextDocument',
      id: 8,
      uri: 'workspace:src/new.c',
      clock: 0.45762532299999975,
      eol: EOL as EndOfLine,
      languageId: 'c',
    },
    {
      type: 'textChange',
      id: 9,
      uri: 'workspace:src/new.c',
      clock: 0.45762532299999975,
      contentChanges: [
        {
          range: {
            start: {
              line: 0,
              character: 0,
            },
            end: {
              line: 0,
              character: 0,
            },
          },
          text: `#include <stdio.h>${EOL}${EOL}int main() {${EOL}    return 0;${EOL}}${EOL}`,
        },
      ],
      revContentChanges: [
        {
          range: {
            start: {
              line: 0,
              character: 0,
            },
            end: {
              line: 5,
              character: 0,
            },
          },
          text: '',
        },
      ],
      updateSelection: false,
    },
    {
      type: 'showTextEditor',
      id: 10,
      uri: 'workspace:src/new.c',
      clock: 0.45762532299999975,
      selections: [
        {
          anchor: {
            line: 0,
            character: 0,
          },
          active: {
            line: 0,
            character: 0,
          },
        },
      ],
      visibleRange: {
        start: 0,
        end: 5,
      },
      justOpened: true,
    },
    {
      type: 'closeTextDocument',
      id: 11,
      uri: 'workspace:src/main.c',
      clock: 0.5646270330000002,
      revEol: EOL as EndOfLine,
      revLanguageId: 'c',
    },
    {
      type: 'fsCreate',
      id: 12,
      uri: 'workspace:src/new.c',
      clock: 0.5646270330000002,
      file: {
        type: 'blob',
        sha1: 'c3d880f1ad32e1ff90bb87a79c56efa553c66023',
      },
    },
    {
      type: 'fsDelete',
      id: 13,
      uri: 'workspace:src/main.c',
      clock: 0.5646270330000002,
      revFile: {
        type: 'blob',
        sha1: 'c3d880f1ad32e1ff90bb87a79c56efa553c66023',
      },
    },
  ];

  const actualEvents = JSON.parse(lib.pretty(codemic.session!.body?.editorEvents!)) as EditorEvent[];

  const errors: string[] = [];

  const missingActualEvents = _.differenceWith(expectedEvents, actualEvents, isEventAlmostEqual);
  const extraActualEvents = _.differenceWith(actualEvents, expectedEvents, isEventAlmostEqual);

  if (missingActualEvents.length) {
    errors.push(`missing editor event IDs: ${missingActualEvents.map(x => x.id).join(', ')}`);
  }
  if (extraActualEvents.length) {
    errors.push(`extra editor event IDs: ${extraActualEvents.map(x => x.id).join(', ')}`);
  }

  if (missingActualEvents.length || extraActualEvents.length) {
    errors.push(`Actual events: ${lib.pretty(actualEvents)}\nExpected events: ${lib.pretty(expectedEvents)}`);
  }

  assert.ok(errors.length === 0, `found ${errors.length} error(s):\n\n${errors.join('\n\n')}`);

  // log('XXX', lib.pretty(codemic.session!.body?.editorEvents));

  // await lib.timeout(1_000_000);
}

async function recordRenameFileAndOpenAgainImmediately() {
  log(`=== Creating files in ${workspacePath}`);
  fs.readdirSync(workspacePath, 'utf8').forEach(p => fs.rmSync(path.resolve(workspacePath, p), { recursive: true }));
  fs.mkdirSync(path.resolve(workspacePath, 'src'), { recursive: true });
  fs.writeFileSync(
    path.resolve(workspacePath, 'src/main.c'),
    `#include <stdio.h>${EOL}${EOL}int main() {${EOL}    return 0;${EOL}}${EOL}`,
  );

  log(`=== Closing all tabs`);
  await closeAllTabs();
  log(`=== Opening CodeMic view`);
  await openCodeMicView();
  const codemic = getCodeMic();

  log(`=== Opening new session`);
  await codemic.handleMessage({ type: 'welcome/openNewSessionInRecorder' });
  await lib.timeout(200);
  await codemic.handleMessage({
    type: 'recorder/updateDetails',
    changes: { title: 'Rename file', handle: 'rename_file' },
  });
  await lib.timeout(200);
  log(`=== Scanning new session`);
  await codemic.handleMessage({ type: 'recorder/load', skipConfirmation: true });

  assert.ok(await pathExists(path.resolve(workspacePath, '.CodeMic', 'head.json')), 'head.json does not exist');
  assert.ok(await pathExists(path.resolve(workspacePath, '.CodeMic', 'body.json')), 'body.json does not exist');

  log(`=== Start recording`);
  await codemic.handleMessage({ type: 'recorder/record' });
  await lib.timeout(100);

  log(`=== Open main.c`);
  await vscode.window.showTextDocument(vscode.Uri.file(path.resolve(workspacePath, 'src/main.c')), { preview: false });
  await lib.timeout(200);

  log(`=== Rename main.c to new.c`);
  const edit = new WorkspaceEdit();
  edit.renameFile(
    vscode.Uri.file(path.resolve(workspacePath, 'src/main.c')),
    vscode.Uri.file(path.resolve(workspacePath, 'src/new.c')),
  );
  await vscode.workspace.applyEdit(edit);
  await lib.timeout(1000);

  log(`=== Recreate and reopen main.c`);
  fs.writeFileSync(path.resolve(workspacePath, 'src/main.c'), `// This is a new file`);
  await vscode.window.showTextDocument(vscode.Uri.file(path.resolve(workspacePath, 'src/main.c')), { preview: false });
  await lib.timeout(1000);

  log(`=== Pause`);
  await codemic.handleMessage({ type: 'recorder/pause' });
  await lib.timeout(200);

  const expectedEvents: EditorEvent[] = [
    {
      type: 'fsCreate',
      id: 1,
      uri: 'workspace:src',
      clock: 0,
      file: {
        type: 'dir',
      },
    },
    {
      type: 'fsCreate',
      id: 2,
      uri: 'workspace:src/main.c',
      clock: 0,
      file: {
        type: 'blob',
        sha1: 'c3d880f1ad32e1ff90bb87a79c56efa553c66023',
      },
    },
    {
      type: 'openTextDocument',
      id: 3,
      uri: 'workspace:src/main.c',
      clock: 0.10307382400000006,
      eol: EOL as EndOfLine,
      languageId: 'c',
    },
    {
      type: 'showTextEditor',
      id: 4,
      uri: 'workspace:src/main.c',
      clock: 0.10307382400000006,
      selections: [
        {
          anchor: {
            line: 0,
            character: 0,
          },
          active: {
            line: 0,
            character: 0,
          },
        },
      ],
      visibleRange: {
        start: 0,
        end: 5,
      },
      justOpened: true,
    },
    {
      type: 'closeTextEditor',
      id: 5,
      uri: 'workspace:src/main.c',
      clock: 0.3059229349999996,
      active: true,
      revSelections: [
        {
          anchor: {
            line: 0,
            character: 0,
          },
          active: {
            line: 0,
            character: 0,
          },
        },
      ],
      revVisibleRange: {
        start: 0,
        end: 5,
      },
    },
    {
      type: 'openTextDocument',
      id: 6,
      uri: 'workspace:src/new.c',
      clock: 0.3059229349999996,
      eol: EOL as EndOfLine,
      languageId: 'c',
    },
    {
      type: 'textChange',
      id: 7,
      uri: 'workspace:src/new.c',
      clock: 0.3059229349999996,
      contentChanges: [
        {
          range: {
            start: {
              line: 0,
              character: 0,
            },
            end: {
              line: 0,
              character: 0,
            },
          },
          text: `#include <stdio.h>${EOL}${EOL}int main() {${EOL}    return 0;${EOL}}${EOL}`,
        },
      ],
      revContentChanges: [
        {
          range: {
            start: {
              line: 0,
              character: 0,
            },
            end: {
              line: 5,
              character: 0,
            },
          },
          text: '',
        },
      ],
      updateSelection: false,
    },
    {
      type: 'showTextEditor',
      id: 8,
      uri: 'workspace:src/new.c',
      clock: 0.3059229349999996,
      selections: [
        {
          anchor: {
            line: 0,
            character: 0,
          },
          active: {
            line: 0,
            character: 0,
          },
        },
      ],
      visibleRange: {
        start: 0,
        end: 5,
      },
      justOpened: true,
    },
    {
      type: 'closeTextDocument',
      id: 9,
      uri: 'workspace:src/main.c',
      clock: 0.3059229349999996,
      revEol: EOL as EndOfLine,
      revLanguageId: 'c',
    },
    {
      type: 'fsCreate',
      id: 10,
      uri: 'workspace:src/new.c',
      clock: 0.40816207599999965,
      file: {
        type: 'blob',
        sha1: 'c3d880f1ad32e1ff90bb87a79c56efa553c66023',
      },
    },
    {
      type: 'fsDelete',
      id: 11,
      uri: 'workspace:src/main.c',
      clock: 0.40816207599999965,
      revFile: {
        type: 'blob',
        sha1: 'c3d880f1ad32e1ff90bb87a79c56efa553c66023',
      },
    },
    {
      type: 'openTextDocument',
      id: 12,
      uri: 'workspace:src/main.c',
      clock: 1.3696773119999996,
      eol: EOL as EndOfLine,
      languageId: 'c',
    },
    {
      type: 'textChange',
      id: 13,
      uri: 'workspace:src/main.c',
      clock: 1.3696773119999996,
      contentChanges: [
        {
          range: {
            start: {
              line: 0,
              character: 0,
            },
            end: {
              line: 0,
              character: 0,
            },
          },
          text: '// This is a new file',
        },
      ],
      revContentChanges: [
        {
          range: {
            start: {
              line: 0,
              character: 0,
            },
            end: {
              line: 0,
              character: 21,
            },
          },
          text: '',
        },
      ],
      updateSelection: false,
    },
    {
      type: 'showTextEditor',
      id: 14,
      uri: 'workspace:src/main.c',
      clock: 1.3696773119999996,
      selections: [
        {
          anchor: {
            line: 0,
            character: 0,
          },
          active: {
            line: 0,
            character: 0,
          },
        },
      ],
      visibleRange: {
        start: 0,
        end: 0,
      },
      justOpened: true,
      revUri: 'workspace:src/new.c',
    },
    {
      type: 'fsCreate',
      id: 15,
      uri: 'workspace:src/main.c',
      clock: 1.4714212319999995,
      file: {
        type: 'blob',
        sha1: 'eab6555aced7835586ca27f868b20246a1460dd4',
      },
    },
  ];

  const actualEvents = JSON.parse(lib.pretty(codemic.session!.body?.editorEvents!)) as EditorEvent[];

  const errors: string[] = [];

  const missingActualEvents = _.differenceWith(expectedEvents, actualEvents, isEventAlmostEqual);
  const extraActualEvents = _.differenceWith(actualEvents, expectedEvents, isEventAlmostEqual);

  if (missingActualEvents.length) {
    errors.push(`missing editor event IDs: ${missingActualEvents.map(x => x.id).join(', ')}`);
  }
  if (extraActualEvents.length) {
    errors.push(`extra editor event IDs: ${extraActualEvents.map(x => x.id).join(', ')}`);
  }

  if (missingActualEvents.length || extraActualEvents.length) {
    errors.push(`Actual events: ${lib.pretty(actualEvents)}\nExpected events: ${lib.pretty(expectedEvents)}`);
  }

  assert.ok(errors.length === 0, `found ${errors.length} error(s):\n\n${errors.join('\n\n')}`);

  // log('XXX', lib.pretty(codemic.session!.body?.editorEvents));

  // await lib.timeout(1_000_000);
}

async function recordRenameFileAndOpenAgainWithDelay() {
  log(`=== Creating files in ${workspacePath}`);
  fs.readdirSync(workspacePath, 'utf8').forEach(p => fs.rmSync(path.resolve(workspacePath, p), { recursive: true }));
  fs.mkdirSync(path.resolve(workspacePath, 'src'), { recursive: true });
  fs.writeFileSync(
    path.resolve(workspacePath, 'src/main.c'),
    `#include <stdio.h>${EOL}${EOL}int main() {${EOL}    return 0;${EOL}}${EOL}`,
  );

  log(`=== Closing all tabs`);
  await closeAllTabs();
  log(`=== Opening CodeMic view`);
  await openCodeMicView();
  const codemic = getCodeMic();

  log(`=== Opening new session`);
  await codemic.handleMessage({ type: 'welcome/openNewSessionInRecorder' });
  await lib.timeout(200);
  await codemic.handleMessage({
    type: 'recorder/updateDetails',
    changes: { title: 'Rename file', handle: 'rename_file' },
  });
  await lib.timeout(200);
  log(`=== Scanning new session`);
  await codemic.handleMessage({ type: 'recorder/load', skipConfirmation: true });

  assert.ok(await pathExists(path.resolve(workspacePath, '.CodeMic', 'head.json')), 'head.json does not exist');
  assert.ok(await pathExists(path.resolve(workspacePath, '.CodeMic', 'body.json')), 'body.json does not exist');

  log(`=== Start recording`);
  await codemic.handleMessage({ type: 'recorder/record' });
  await lib.timeout(100);

  log(`=== Open main.c`);
  await vscode.window.showTextDocument(vscode.Uri.file(path.resolve(workspacePath, 'src/main.c')), { preview: false });
  await lib.timeout(200);

  log(`=== Rename main.c to new.c`);
  const edit = new WorkspaceEdit();
  edit.renameFile(
    vscode.Uri.file(path.resolve(workspacePath, 'src/main.c')),
    vscode.Uri.file(path.resolve(workspacePath, 'src/new.c')),
  );
  await vscode.workspace.applyEdit(edit);
  await lib.timeout(1000);

  log(`=== Recreate and reopen main.c`);
  fs.writeFileSync(path.resolve(workspacePath, 'src/main.c'), `// This is a new file`);
  await lib.timeout(1000);
  await vscode.window.showTextDocument(vscode.Uri.file(path.resolve(workspacePath, 'src/main.c')), { preview: false });
  await lib.timeout(1000);

  log(`=== Pause`);
  await codemic.handleMessage({ type: 'recorder/pause' });
  await lib.timeout(200);

  const expectedEvents: EditorEvent[] = [
    {
      type: 'fsCreate',
      id: 1,
      uri: 'workspace:src',
      clock: 0,
      file: {
        type: 'dir',
      },
    },
    {
      type: 'fsCreate',
      id: 2,
      uri: 'workspace:src/main.c',
      clock: 0,
      file: {
        type: 'blob',
        sha1: 'c3d880f1ad32e1ff90bb87a79c56efa553c66023',
      },
    },
    {
      type: 'openTextDocument',
      id: 3,
      uri: 'workspace:src/main.c',
      clock: 0.10307382400000006,
      eol: EOL as EndOfLine,
      languageId: 'c',
    },
    {
      type: 'showTextEditor',
      id: 4,
      uri: 'workspace:src/main.c',
      clock: 0.10307382400000006,
      selections: [
        {
          anchor: {
            line: 0,
            character: 0,
          },
          active: {
            line: 0,
            character: 0,
          },
        },
      ],
      visibleRange: {
        start: 0,
        end: 5,
      },
      justOpened: true,
    },
    {
      type: 'closeTextEditor',
      id: 5,
      uri: 'workspace:src/main.c',
      clock: 0.3059229349999996,
      active: true,
      revSelections: [
        {
          anchor: {
            line: 0,
            character: 0,
          },
          active: {
            line: 0,
            character: 0,
          },
        },
      ],
      revVisibleRange: {
        start: 0,
        end: 5,
      },
    },
    {
      type: 'openTextDocument',
      id: 6,
      uri: 'workspace:src/new.c',
      clock: 0.3059229349999996,
      eol: EOL as EndOfLine,
      languageId: 'c',
    },
    {
      type: 'textChange',
      id: 7,
      uri: 'workspace:src/new.c',
      clock: 0.3059229349999996,
      contentChanges: [
        {
          range: {
            start: {
              line: 0,
              character: 0,
            },
            end: {
              line: 0,
              character: 0,
            },
          },
          text: `#include <stdio.h>${EOL}${EOL}int main() {${EOL}    return 0;${EOL}}${EOL}`,
        },
      ],
      revContentChanges: [
        {
          range: {
            start: {
              line: 0,
              character: 0,
            },
            end: {
              line: 5,
              character: 0,
            },
          },
          text: '',
        },
      ],
      updateSelection: false,
    },
    {
      type: 'showTextEditor',
      id: 8,
      uri: 'workspace:src/new.c',
      clock: 0.3059229349999996,
      selections: [
        {
          anchor: {
            line: 0,
            character: 0,
          },
          active: {
            line: 0,
            character: 0,
          },
        },
      ],
      visibleRange: {
        start: 0,
        end: 5,
      },
      justOpened: true,
    },
    {
      type: 'closeTextDocument',
      id: 9,
      uri: 'workspace:src/main.c',
      clock: 0.3059229349999996,
      revEol: EOL as EndOfLine,
      revLanguageId: 'c',
    },
    {
      type: 'fsCreate',
      id: 10,
      uri: 'workspace:src/new.c',
      clock: 0.40816207599999965,
      file: {
        type: 'blob',
        sha1: 'c3d880f1ad32e1ff90bb87a79c56efa553c66023',
      },
    },
    {
      type: 'fsDelete',
      id: 11,
      uri: 'workspace:src/main.c',
      clock: 0.40816207599999965,
      revFile: {
        type: 'blob',
        sha1: 'c3d880f1ad32e1ff90bb87a79c56efa553c66023',
      },
    },
    {
      type: 'openTextDocument',
      id: 12,
      uri: 'workspace:src/main.c',
      clock: 1.3696773119999996,
      eol: EOL as EndOfLine,
      languageId: 'c',
    },
    // {
    //   type: 'textChange',
    //   id: 13,
    //   uri: 'workspace:src/main.c',
    //   clock: 1.3696773119999996,
    //   contentChanges: [
    //     {
    //       range: {
    //         start: {
    //           line: 0,
    //           character: 0,
    //         },
    //         end: {
    //           line: 0,
    //           character: 0,
    //         },
    //       },
    //       text: '// This is a new file',
    //     },
    //   ],
    //   revContentChanges: [
    //     {
    //       range: {
    //         start: {
    //           line: 0,
    //           character: 0,
    //         },
    //         end: {
    //           line: 0,
    //           character: 21,
    //         },
    //       },
    //       text: '',
    //     },
    //   ],
    //   updateSelection: false,
    // },
    {
      type: 'showTextEditor',
      id: 14,
      uri: 'workspace:src/main.c',
      clock: 1.3696773119999996,
      selections: [
        {
          anchor: {
            line: 0,
            character: 0,
          },
          active: {
            line: 0,
            character: 0,
          },
        },
      ],
      visibleRange: {
        start: 0,
        end: 0,
      },
      justOpened: true,
      revUri: 'workspace:src/new.c',
    },
    {
      type: 'fsCreate',
      id: 15,
      uri: 'workspace:src/main.c',
      clock: 1.4714212319999995,
      file: {
        type: 'blob',
        sha1: 'eab6555aced7835586ca27f868b20246a1460dd4',
      },
    },
  ];

  const actualEvents = JSON.parse(lib.pretty(codemic.session!.body?.editorEvents!)) as EditorEvent[];

  const errors: string[] = [];

  const missingActualEvents = _.differenceWith(expectedEvents, actualEvents, isEventAlmostEqual);
  const extraActualEvents = _.differenceWith(actualEvents, expectedEvents, isEventAlmostEqual);

  if (missingActualEvents.length) {
    errors.push(`missing editor event IDs: ${missingActualEvents.map(x => x.id).join(', ')}`);
  }
  if (extraActualEvents.length) {
    errors.push(`extra editor event IDs: ${extraActualEvents.map(x => x.id).join(', ')}`);
  }

  if (missingActualEvents.length || extraActualEvents.length) {
    errors.push(`Actual events: ${lib.pretty(actualEvents)}\nExpected events: ${lib.pretty(expectedEvents)}`);
  }

  assert.ok(errors.length === 0, `found ${errors.length} error(s):\n\n${errors.join('\n\n')}`);

  // log('XXX', lib.pretty(codemic.session!.body?.editorEvents));

  // await lib.timeout(1_000_000);
}

async function recordStartWithDirtydocsOpenAndSave() {
  log(`=== Creating files in ${workspacePath}`);
  fs.readdirSync(workspacePath, 'utf8').forEach(p => fs.rmSync(path.resolve(workspacePath, p), { recursive: true }));
  fs.mkdirSync(path.resolve(workspacePath, 'src'), { recursive: true });
  fs.writeFileSync(path.resolve(workspacePath, 'README.txt'), `Hello there!${EOL}`);
  fs.writeFileSync(path.resolve(workspacePath, 'src/inside.txt'), `Inside text${EOL}Second line${EOL}`);
  fs.writeFileSync(
    path.resolve(workspacePath, 'src/main.c'),
    `#include <stdio.h>${EOL}${EOL}int main() {${EOL}    return 0;${EOL}}${EOL}`,
  );

  log(`=== Closing all tabs`);
  await closeAllTabs();
  log(`=== Opening CodeMic view`);
  await openCodeMicView();
  const codemic = getCodeMic();

  log(`=== Open main.c`);
  const mainTextEditor = await vscode.window.showTextDocument(
    vscode.Uri.file(path.resolve(workspacePath, 'src/main.c')),
    { preview: false },
  );
  assert.ok(
    await mainTextEditor.edit(builder => {
      builder.replace(new vscode.Range(3, 0, 3, 13), '    return 99;');
    }),
  );

  await lib.timeout(200);

  log(`=== Opening new session`);
  await codemic.handleMessage({ type: 'welcome/openNewSessionInRecorder' });
  await lib.timeout(200);
  await codemic.handleMessage({
    type: 'recorder/updateDetails',
    changes: { title: 'start with dirty document open and save', handle: 'start_with_dirty_document_open_and_save' },
  });
  await lib.timeout(200);
  log(`=== Scanning new session`);
  await codemic.handleMessage({ type: 'recorder/load', skipConfirmation: true });

  assert.ok(await pathExists(path.resolve(workspacePath, '.CodeMic', 'head.json')), 'head.json does not exist');
  assert.ok(await pathExists(path.resolve(workspacePath, '.CodeMic', 'body.json')), 'body.json does not exist');

  // await codemic.handleMessage({ type: 'recorder/makeTest' });

  log(`=== Start recording`);
  await codemic.handleMessage({ type: 'recorder/record' });
  await lib.timeout(1000);

  log(`=== Open inside.txt`);
  const insideTextEditor = await vscode.window.showTextDocument(
    vscode.Uri.file(path.resolve(workspacePath, 'src/inside.txt')),
  );
  assert.ok(
    await insideTextEditor.edit(builder => {
      builder.replace(new vscode.Range(1, 0, 2, 0), `Third line${EOL}`);
    }),
  );
  await lib.timeout(1000);

  // log(`=== Pause to make test`);
  // await codemic.handleMessage({ type: 'recorder/pause' });
  // await lib.timeout(300);
  // await codemic.handleMessage({ type: 'recorder/makeTest' });

  log(`=== Resume recording`);
  await codemic.handleMessage({ type: 'recorder/record' });
  await lib.timeout(300);

  await insideTextEditor.document.save();
  await lib.timeout(300);

  log(`=== Pause`);
  await codemic.handleMessage({ type: 'recorder/pause' });
  await lib.timeout(200);

  // await codemic.handleMessage({ type: 'recorder/makeTest' });

  const expectedEvents: EditorEvent[] = [
    {
      type: 'fsCreate',
      id: 1,
      uri: 'workspace:README.txt',
      clock: 0,
      file: {
        type: 'blob',
        sha1: 'c2d38c73bb59ed15790b19661bf31a53b5e856b9',
      },
    },
    {
      type: 'fsCreate',
      id: 2,
      uri: 'workspace:src',
      clock: 0,
      file: {
        type: 'dir',
      },
    },
    {
      type: 'fsCreate',
      id: 3,
      uri: 'workspace:src/inside.txt',
      clock: 0,
      file: {
        type: 'blob',
        sha1: 'f65d313996cb2dcb64c4a28646b89bb7afb2956d',
      },
    },
    {
      type: 'fsCreate',
      id: 4,
      uri: 'workspace:src/main.c',
      clock: 0,
      file: {
        type: 'blob',
        sha1: 'c3d880f1ad32e1ff90bb87a79c56efa553c66023',
      },
    },
    {
      type: 'openTextDocument',
      id: 5,
      uri: 'workspace:src/main.c',
      clock: 0,
      eol: EOL as EndOfLine,
      languageId: 'c',
    },
    {
      type: 'textChange',
      id: 6,
      uri: 'workspace:src/main.c',
      clock: 0,
      contentChanges: [
        {
          range: {
            start: {
              line: 0,
              character: 0,
            },
            end: {
              line: 5,
              character: 0,
            },
          },
          text: `#include <stdio.h>${EOL}${EOL}int main() {${EOL}    return 99;${EOL}}${EOL}`,
        },
      ],
      revContentChanges: [
        {
          range: {
            start: {
              line: 0,
              character: 0,
            },
            end: {
              line: 5,
              character: 0,
            },
          },
          text: `#include <stdio.h>${EOL}${EOL}int main() {${EOL}    return 0;${EOL}}${EOL}`,
        },
      ],
      updateSelection: false,
    },
    {
      type: 'showTextEditor',
      id: 7,
      uri: 'workspace:src/main.c',
      clock: 0,
      selections: [
        {
          anchor: {
            line: 0,
            character: 0,
          },
          active: {
            line: 0,
            character: 0,
          },
        },
      ],
      visibleRange: {
        start: 0,
        end: 5,
      },
      justOpened: true,
    },
    {
      type: 'openTextDocument',
      id: 8,
      uri: 'workspace:src/inside.txt',
      clock: 1.0136507159999997,
      eol: EOL as EndOfLine,
      languageId: 'plaintext',
    },
    {
      type: 'showTextEditor',
      id: 9,
      uri: 'workspace:src/inside.txt',
      clock: 1.0136507159999997,
      selections: [
        {
          anchor: {
            line: 0,
            character: 0,
          },
          active: {
            line: 0,
            character: 0,
          },
        },
      ],
      visibleRange: {
        start: 0,
        end: 2,
      },
      justOpened: true,
      revUri: 'workspace:src/main.c',
    },
    {
      type: 'textChange',
      id: 10,
      uri: 'workspace:src/inside.txt',
      clock: 1.0136507159999997,
      contentChanges: [
        {
          text: `Third line${EOL}`,
          range: {
            start: {
              line: 1,
              character: 0,
            },
            end: {
              line: 2,
              character: 0,
            },
          },
        },
      ],
      revContentChanges: [
        {
          range: {
            start: {
              line: 1,
              character: 0,
            },
            end: {
              line: 2,
              character: 0,
            },
          },
          text: `Second line${EOL}`,
        },
      ],
      updateSelection: false,
    },
    {
      type: 'fsChange',
      id: 11,
      uri: 'workspace:src/inside.txt',
      clock: 2.12722597,
      file: {
        type: 'blob',
        sha1: 'be004e9e66d027a2b2a89c091c0f9633c77f2ee0',
      },
      revFile: {
        type: 'blob',
        sha1: 'f65d313996cb2dcb64c4a28646b89bb7afb2956d',
      },
    },
  ];

  const actualEvents = JSON.parse(lib.pretty(codemic.session!.body?.editorEvents!)) as EditorEvent[];

  const errors: string[] = [];

  const missingActualEvents = _.differenceWith(expectedEvents, actualEvents, isEventAlmostEqual);
  const extraActualEvents = _.differenceWith(actualEvents, expectedEvents, isEventAlmostEqual);

  if (missingActualEvents.length) {
    errors.push(`missing editor event IDs: ${missingActualEvents.map(x => x.id).join(', ')}`);
  }
  if (extraActualEvents.length) {
    errors.push(`extra editor event IDs: ${extraActualEvents.map(x => x.id).join(', ')}`);
  }

  if (missingActualEvents.length || extraActualEvents.length) {
    errors.push(`Actual events: ${lib.pretty(actualEvents)}\nExpected events: ${lib.pretty(expectedEvents)}`);
  }

  assert.ok(errors.length === 0, `found ${errors.length} error(s):\n\n${errors.join('\n\n')}`);

  // log('XXX', lib.pretty(codemic.session!.body?.editorEvents));

  // await lib.timeout(1_000_000);
}

async function recordSaveJSONWithPrettierJs() {
  log(`=== Creating files in ${workspacePath}`);
  fs.readdirSync(workspacePath, 'utf8').forEach(p => fs.rmSync(path.resolve(workspacePath, p), { recursive: true }));
  fs.mkdirSync(path.resolve(workspacePath, '.vscode'), { recursive: true });
  fs.writeFileSync(path.resolve(workspacePath, 'test.json'), ``);
  fs.writeFileSync(path.resolve(workspacePath, 'README.txt'), `Hello there!${EOL}`);
  fs.writeFileSync(
    path.resolve(workspacePath, '.vscode/settings.json'),
    `{${EOL}  "editor.formatOnSave": true,${EOL}  "[json]": {${EOL}    "editor.defaultFormatter": "esbenp.prettier-vscode"${EOL}  }${EOL}}`,
  );

  log(`=== Closing all tabs`);
  await closeAllTabs();
  log(`=== Opening CodeMic view`);
  await openCodeMicView();
  const codemic = getCodeMic();

  const prettierExt = vscode.extensions.getExtension('esbenp.prettier-vscode');
  assert.ok(prettierExt, 'esbenp.prettier-vscode is not installed');

  await lib.timeout(200);

  log(`=== Opening new session`);
  await codemic.handleMessage({ type: 'welcome/openNewSessionInRecorder' });
  await lib.timeout(200);
  await codemic.handleMessage({
    type: 'recorder/updateDetails',
    changes: { title: 'save json with prettier.js', handle: 'save_json_with_prettier_js' },
  });
  await lib.timeout(200);

  log(`=== Scanning new session`);
  await codemic.handleMessage({ type: 'recorder/load', skipConfirmation: true });

  assert.ok(await pathExists(path.resolve(workspacePath, '.CodeMic', 'head.json')), 'head.json does not exist');
  assert.ok(await pathExists(path.resolve(workspacePath, '.CodeMic', 'body.json')), 'body.json does not exist');

  // await codemic.handleMessage({ type: 'recorder/makeTest' });

  log(`=== Start recording`);
  await codemic.handleMessage({ type: 'recorder/record' });
  await lib.timeout(200);
  const vscWorkspace = codemic.session!.rr?._test_vscWorkspace!;

  log(`=== Open test.json`);
  const textEditor = await vscWorkspace.showTextDocumentByUri('workspace:test.json');

  assert.ok(
    await textEditor.edit(builder => {
      builder.replace(
        vscWorkspace.getVscTextDocumentVscRange(textEditor.document),
        `{${EOL}"version":${EOL}${EOL}${EOL}"2025-07-01.01"${EOL}}${EOL}`,
      );
    }),
  );
  await lib.timeout(300);

  assert.ok(await textEditor.document.save(), 'test.json was not saved');
  await lib.timeout(300);

  log(`=== Pause`);
  await codemic.handleMessage({ type: 'recorder/pause' });
  await lib.timeout(200);

  // await codemic.handleMessage({ type: 'recorder/makeTest' });

  // log(`=== Resume recording`);
  // await codemic.handleMessage({ type: 'recorder/record' });
  // await lib.timeout(300);

  // await insideTextEditor.document.save();
  // await lib.timeout(300);

  // // await codemic.handleMessage({ type: 'recorder/makeTest' });

  const expectedEvents: EditorEvent[] = [
    {
      type: 'fsCreate',
      id: 1,
      uri: 'workspace:.vscode',
      clock: 0,
      file: {
        type: 'dir',
      },
    },
    {
      type: 'fsCreate',
      id: 2,
      uri: 'workspace:.vscode/settings.json',
      clock: 0,
      file: {
        type: 'blob',
        sha1: '3f7383a9de50314c9c50b66cd1a1c953ca858dec',
      },
    },
    {
      type: 'fsCreate',
      id: 3,
      uri: 'workspace:README.txt',
      clock: 0,
      file: {
        type: 'blob',
        sha1: 'c2d38c73bb59ed15790b19661bf31a53b5e856b9',
      },
    },
    {
      type: 'fsCreate',
      id: 4,
      uri: 'workspace:test.json',
      clock: 0,
      file: {
        type: 'blob',
        sha1: 'da39a3ee5e6b4b0d3255bfef95601890afd80709',
      },
    },
    {
      type: 'openTextDocument',
      id: 5,
      uri: 'workspace:test.json',
      clock: 0.2068292200000001,
      eol: EOL as EndOfLine,
      languageId: 'json',
    },
    {
      type: 'showTextEditor',
      id: 6,
      uri: 'workspace:test.json',
      clock: 0.2068292200000001,
      selections: [
        {
          anchor: {
            line: 0,
            character: 0,
          },
          active: {
            line: 0,
            character: 0,
          },
        },
      ],
      visibleRange: {
        start: 0,
        end: 0,
      },
      justOpened: true,
    },
    {
      type: 'textInsert',
      id: 7,
      uri: 'workspace:test.json',
      clock: 0.2068292200000001,
      revRange: {
        start: {
          line: 0,
          character: 0,
        },
        end: {
          line: 6,
          character: 0,
        },
      },
      text: `{${EOL}"version":${EOL}${EOL}${EOL}"2025-07-01.01"${EOL}}${EOL}`,
      updateSelection: true,
    },
    {
      type: 'scroll',
      id: 8,
      uri: 'workspace:test.json',
      clock: 0.2068292200000001,
      visibleRange: {
        start: 0,
        end: 6,
      },
      revVisibleRange: {
        start: 0,
        end: 0,
      },
    },
    {
      type: 'textChange',
      id: 9,
      uri: 'workspace:test.json',
      clock: 1.3220568389999998,
      contentChanges: [
        {
          text: '  ',
          range: {
            start: {
              line: 1,
              character: 0,
            },
            end: {
              line: 1,
              character: 0,
            },
          },
        },
        {
          text: ' ',
          range: {
            start: {
              line: 1,
              character: 10,
            },
            end: {
              line: 4,
              character: 0,
            },
          },
        },
      ],
      revContentChanges: [
        {
          range: {
            start: {
              line: 1,
              character: 0,
            },
            end: {
              line: 1,
              character: 2,
            },
          },
          text: '',
        },
        {
          range: {
            start: {
              line: 1,
              character: 12,
            },
            end: {
              line: 1,
              character: 13,
            },
          },
          text: `${EOL}${EOL}${EOL}`,
        },
      ],
      updateSelection: false,
    },
    {
      type: 'select',
      id: 10,
      uri: 'workspace:test.json',
      clock: 1.3220568389999998,
      selections: [
        {
          anchor: {
            line: 3,
            character: 0,
          },
          active: {
            line: 3,
            character: 0,
          },
        },
      ],
      revSelections: [
        {
          anchor: {
            line: 6,
            character: 0,
          },
          active: {
            line: 6,
            character: 0,
          },
        },
      ],
    },
    {
      type: 'scroll',
      id: 11,
      uri: 'workspace:test.json',
      clock: 1.3220568389999998,
      visibleRange: {
        start: 0,
        end: 3,
      },
      revVisibleRange: {
        start: 0,
        end: 6,
      },
    },
    {
      type: 'fsChange',
      id: 12,
      uri: 'workspace:test.json',
      clock: 1.422560993,
      file: {
        type: 'blob',
        sha1: 'b65b4cc253c24f8f544c786bcb16f19a4aaa943b',
      },
      revFile: {
        type: 'blob',
        sha1: 'da39a3ee5e6b4b0d3255bfef95601890afd80709',
      },
    },
  ];

  const actualEvents = JSON.parse(lib.pretty(codemic.session!.body?.editorEvents!)) as EditorEvent[];

  const errors: string[] = [];

  const missingActualEvents = _.differenceWith(expectedEvents, actualEvents, isEventAlmostEqual);
  const extraActualEvents = _.differenceWith(actualEvents, expectedEvents, isEventAlmostEqual);

  if (missingActualEvents.length) {
    errors.push(`missing editor event IDs: ${missingActualEvents.map(x => x.id).join(', ')}`);
  }
  if (extraActualEvents.length) {
    errors.push(`extra editor event IDs: ${extraActualEvents.map(x => x.id).join(', ')}`);
  }

  if (missingActualEvents.length || extraActualEvents.length) {
    errors.push(`Actual events: ${lib.pretty(actualEvents)}\nExpected events: ${lib.pretty(expectedEvents)}`);
  }

  assert.ok(errors.length === 0, `found ${errors.length} error(s):\n\n${errors.join('\n\n')}`);

  // log('XXX', lib.pretty(codemic.session!.body?.editorEvents));

  // await lib.timeout(1_000_000);
}

function log(...args: any) {
  if (config.debug) console.log(...args);
}
