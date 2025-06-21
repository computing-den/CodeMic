import { defineConfig } from '@vscode/test-cli';

export default defineConfig([
  {
    label: 'tests',
    files: 'dist/*.test.js',
    version: '1.101.1',
    workspaceFolder: './test_data/test_workspace',
    mocha: {
      ui: 'tdd',
      timeout: 3_000_000,
      parallel: false,
      asyncOnly: true,
    },
  },
  // you can specify additional test configurations, too
]);
