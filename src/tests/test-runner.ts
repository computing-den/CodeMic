import * as path from 'path';
import Mocha from 'mocha';
import { glob } from 'glob';

export async function run(): Promise<void> {
  // Create the mocha test
  const mocha = new Mocha({
    ui: 'tdd',
    color: true,
    timeout: 30_000,
  });

  const testsRoot = path.resolve(__dirname);

  const files = await glob('**/**.test.js', { cwd: testsRoot });
  // Add files to the test suite
  for (const f of files) {
    const fullPath = path.resolve(testsRoot, f);
    mocha.addFile(fullPath);
  }

  // Run the mocha test
  return new Promise((resolve, reject) => {
    mocha.run(failures => {
      if (failures > 0) {
        reject(new Error(`${failures} tests failed.`));
      } else {
        resolve();
      }
    });
  });
}
