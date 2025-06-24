import * as assert from 'assert';
import vscode from 'vscode';
import fs from 'fs';
import path from 'path';
import _ from 'lodash';
import * as lib from '../lib/lib.js';
import { pathExists } from '../extension/storage.js';
import { closeAllTabs, exampleFilesPath, getCodeMic, openCodeMicView, workspacePath } from './test-helpers.js';
import config from '../extension/config.js';
import { EditorEvent } from '../lib/types.js';

suite('Experiments', () => {
  test('Record 1', recordSession1);
});

async function recordSession1() {
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
  await lib.timeout(200);

  log(`=== Open inside.txt while on pause`);
  await vscode.workspace.openTextDocument(vscode.Uri.file(path.resolve(workspacePath, 'src/inside.txt')));
  await lib.timeout(200);

  log(`=== Resume recording`);
  await codemic.handleMessage({ type: 'recorder/record' });
  await lib.timeout(200);
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

  log('XXX', lib.pretty(codemic.session!.body?.editorEvents));

  await lib.timeout(1_000_000);
}

function log(...args: any) {
  if (config.debug) console.log(...args);
}
