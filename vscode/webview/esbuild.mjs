// import config from './config.json' assert { type: 'json' };
import * as esbuild from 'esbuild';
import { execSync } from 'child_process';

const mustWatch = process.argv[2] === '--watch';

const target = ['chrome114', 'firefox113', 'safari16.5', 'edge114'];

const jsConfig = {
  entryPoints: ['src/webview.tsx'],
  bundle: true,
  minify: false,
  sourcemap: true,
  target,
  outfile: 'out/webview.js',
  preserveSymlinks: true,
  sourcemap: 'inline',
  // define: { DEBUG: JSON.stringify(config.debug) },
};

const cssConfig = {
  entryPoints: ['src/webview.css'],
  bundle: true,
  target,
  outfile: 'out/webview.css',
  preserveSymlinks: true,
  sourcemap: true,
  sourcemap: 'inline',
};

if (mustWatch) {
  const jsCtx = await esbuild.context({ ...jsConfig, plugins: [messagePlugin('JS')] });
  const cssCtx = await esbuild.context({ ...cssConfig, plugins: [messagePlugin('CSS')] });
  await jsCtx.watch();
  await cssCtx.watch();
  console.log('\nesbuild is watching javascript and css files...');
} else {
  await esbuild.build(jsConfig);
  await esbuild.build(cssConfig);
}

const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const RESET = '\x1b[0m';

function messagePlugin(name) {
  return {
    name: 'Message',
    setup(build) {
      build.onEnd(result => {
        if (result.errors.length === 0) {
          console.log(`${GREEN}${name} built successfully.${RESET}`);
        } else {
          try {
            const e = result.errors[0];
            // console.error(e);
            let msg;
            if (e.location) {
              msg = `${e.location.file}:${e.location.line}: ${e.text}`;
            } else {
              msg = `Unknown location: ${e.text}`;
            }
            msg = msg.replaceAll('"', '\\"');
            execSync(`notify-send --urgency=critical --expire-time=2000 "esbuild" "${msg}"`);
          } catch (error) {
            console.error(error);
          }
        }
      });
    },
  };
}
