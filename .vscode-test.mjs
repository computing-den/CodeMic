import { defineConfig } from '@vscode/test-cli';

export default defineConfig([
  {
    label: 'tests',
    files: 'dist/*.test.js',
    // version: 'insiders',
    workspaceFolder: './sampleWorkspace',
    mocha: {
      ui: 'tdd',
      timeout: 3_000,
    },
  },
  // you can specify additional test configurations, too
]);
