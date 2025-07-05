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
    installExtensions: [
      // Install Prettier from Marketplace
      'esbenp.prettier-vscode',
      // OR from local .vsix (uncomment below and adjust the path)
      // path.resolve('./path/to/prettier.vsix'),
    ],
  },
  // you can specify additional test configurations, too
]);
