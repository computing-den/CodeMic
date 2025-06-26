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

async function recordSession1() {}

function log(...args: any) {
  if (config.debug) console.log(...args);
}
