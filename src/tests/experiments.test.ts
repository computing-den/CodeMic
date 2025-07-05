import * as assert from 'assert';
import vscode from 'vscode';
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
  workspacePath,
} from './test-helpers.js';
import config from '../extension/config.js';
import { EditorEvent } from '../lib/types.js';

// suite('Experiments', () => {
test('Record 1', recordSession1);
// });

async function recordSession1() {
  log(`=== Creating files in ${workspacePath}`);
  fs.readdirSync(workspacePath, 'utf8').forEach(p => fs.rmSync(path.resolve(workspacePath, p), { recursive: true }));
  fs.mkdirSync(path.resolve(workspacePath, 'src'), { recursive: true });
  fs.writeFileSync(path.resolve(workspacePath, 'src/main.c'), '#include <stdio.h>\n\nint main() {\n    return 0;\n}\n');

  for (let i = 0; i < 100; i++) {
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
      changes: { title: 'Test', handle: 'test' },
    });
    await lib.timeout(200);

    log(`=== Scanning new session`);
    await codemic.handleMessage({ type: 'recorder/load', skipConfirmation: true });
    // await lib.timeout(200);

    log(`=== Open untitled document`);
    await vscode.commands.executeCommand('workbench.action.files.newUntitledFile');
    await vscode.window.activeTextEditor!.edit(builder => {
      builder.replace(new vscode.Range(0, 0, 0, 0), 'Hello');
    }),
      log(`=== Start recording`);
    await codemic.handleMessage({ type: 'recorder/record' });
    await lib.timeout(100);

    log(`=== Pause`);
    await codemic.handleMessage({ type: 'recorder/pause' });
    await lib.timeout(100);
  }

  // assert.ok(await pathExists(path.resolve(workspacePath, '.CodeMic', 'head.json')), 'head.json does not exist');
  // assert.ok(await pathExists(path.resolve(workspacePath, '.CodeMic', 'body.json')), 'body.json does not exist');

  // log(`=== Open main.c`);
  // await vscode.window.showTextDocument(vscode.Uri.file(path.resolve(workspacePath, 'src/main.c')), { preview: false });
  // await lib.timeout(200);

  // log(`=== Rename main.c to new.c`);
  // const edit = new WorkspaceEdit();
  // edit.renameFile(
  //   vscode.Uri.file(path.resolve(workspacePath, 'src/main.c')),
  //   vscode.Uri.file(path.resolve(workspacePath, 'src/new.c')),
  // );
  // await vscode.workspace.applyEdit(edit);
  // await lib.timeout(1000);

  // log(`=== Recreate and reopen main.c`);
  // fs.writeFileSync(path.resolve(workspacePath, 'src/main.c'), '// This is a new file');
  // await lib.timeout(1000);
  // await vscode.window.showTextDocument(vscode.Uri.file(path.resolve(workspacePath, 'src/main.c')), { preview: false });
  // await lib.timeout(1000);

  // log(`=== Pause`);
  // await codemic.handleMessage({ type: 'recorder/pause' });
  // await lib.timeout(200);

  // // const expectedEvents: EditorEvent[] =

  // const actualEvents = JSON.parse(lib.pretty(codemic.session!.body?.editorEvents!)) as EditorEvent[];

  // const errors: string[] = [];

  // const missingActualEvents = _.differenceWith(expectedEvents, actualEvents, isEventAlmostEqual);
  // const extraActualEvents = _.differenceWith(actualEvents, expectedEvents, isEventAlmostEqual);

  // if (missingActualEvents.length) {
  //   errors.push(`missing editor event IDs: ${missingActualEvents.map(x => x.id).join(', ')}`);
  // }
  // if (extraActualEvents.length) {
  //   errors.push(`extra editor event IDs: ${extraActualEvents.map(x => x.id).join(', ')}`);
  // }

  // if (missingActualEvents.length || extraActualEvents.length) {
  //   errors.push(`Actual events: ${lib.pretty(actualEvents)}\nExpected events: ${lib.pretty(expectedEvents)}`);
  // }

  // assert.ok(errors.length === 0, `found ${errors.length} error(s):\n\n${errors.join('\n\n')}`);

  // log('XXX', lib.pretty(codemic.session!.body?.editorEvents));

  // await lib.timeout(1_000_000);
}

function log(...args: any) {
  if (config.debug) console.log(...args);
}
