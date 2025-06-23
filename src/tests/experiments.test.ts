import * as assert from 'assert';
import fs from 'fs';
import path from 'path';
import _ from 'lodash';
import * as lib from '../lib/lib.js';
import { pathExists } from '../extension/storage.js';
import { closeAllTabs, exampleFilesPath, getCodeMic, openCodeMicView, workspacePath } from './test-helpers.js';

// suite('Experiments', () => {
//   test('Record 1', recordSession1);
// });

// async function recordSession1() {
//   // await lib.timeout(1_000_000);
// }
