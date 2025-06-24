import vscode from 'vscode';
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
import { EditorEvent } from '../lib/types.js';

suite('Recorder', () => {
  test('fs changes', recordFsChanges);
  test('showTextEditor event without openTextDocument', recordOpenTextEditorWithoutDocument);
});

async function recordFsChanges() {
  // Deleting workspacePath directly will interfere with file system watcher.
  // fs.rmSync(path.resolve(workspacePath), { recursive: true });
  log(`=== Creating files in ${workspacePath}`);
  fs.readdirSync(workspacePath, 'utf8').forEach(p => fs.rmSync(path.resolve(workspacePath, p), { recursive: true }));
  fs.mkdirSync(path.resolve(workspacePath, 'src'), { recursive: true });
  fs.mkdirSync(path.resolve(workspacePath, 'images'), { recursive: true });
  fs.writeFileSync(path.resolve(workspacePath, 'README.txt'), 'Hello there!\n');
  fs.writeFileSync(path.resolve(workspacePath, 'src/inside.txt'), 'Inside text\nSecond line\n');
  fs.writeFileSync(path.resolve(workspacePath, 'src/main.c'), '#include <stdio.h>\n\nint main() {\n    return 0;\n}\n');
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

  const actualFiles = fs.readdirSync(workspacePath, { recursive: true, encoding: 'utf8' });
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
  fs.writeFileSync(path.resolve(workspacePath, 'README.txt'), 'Hello there!\n');
  fs.writeFileSync(path.resolve(workspacePath, 'src/inside.txt'), 'Inside text\nSecond line\n');
  fs.writeFileSync(path.resolve(workspacePath, 'src/main.c'), '#include <stdio.h>\n\nint main() {\n    return 0;\n}\n');

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
      eol: '\n',
    },
    {
      type: 'showTextEditor',
      id: 7,
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
    errors.push(`Actual events: ${lib.pretty(actualEvents)}\nExpected events: ${lib.pretty(expectedEvents)}`);
  }

  assert.ok(errors.length === 0, `found ${errors.length} error(s):\n\n${errors.join('\n\n')}`);

  // log('XXX', lib.pretty(codemic.session!.body?.editorEvents));

  // await lib.timeout(1_000_000);
}

function log(...args: any) {
  if (config.debug) console.log(...args);
}
