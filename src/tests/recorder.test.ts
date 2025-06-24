import * as assert from 'assert';
import fs from 'fs';
import path from 'path';
import _ from 'lodash';
import * as lib from '../lib/lib.js';
import { pathExists } from '../extension/storage.js';
import {
  areEventsEqual as areEventsAlmostEqual,
  closeAllTabs,
  exampleFilesPath,
  getCodeMic,
  openCodeMicView,
  workspacePath,
} from './test-helpers.js';
import config from '../extension/config.js';
import { EditorEvent } from '../lib/types.js';

suite('Recorder', () => {
  test('fs changes', recordFsChanges);
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
  const actualEvents = codemic.session!.body?.editorEvents!;

  const areEqual = areEventsAlmostEqual(actualEvents, expectedEvents);
  if (!areEqual) {
    errors.push(
      `unexpected editor events.\nActual: ${lib.pretty(actualEvents)}\nExpected: ${lib.pretty(expectedEvents)}`,
    );
  }

  assert.ok(errors.length === 0, `found ${errors.length} error(s):\n\n${errors.join('\n\n')}`);

  // await lib.timeout(1_000_000);
}

function log(...args: any) {
  if (config.debug) console.log(...args);
}
