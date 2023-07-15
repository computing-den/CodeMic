// import config from './config.json' assert { type: 'json' };
import * as esbuild from 'esbuild';
import { execSync } from 'child_process';

const mustWatch = process.argv[2] === '--watch';

const base = {
  target: ['chrome114', 'firefox113', 'safari16.5', 'edge114'],
  sourcemap: 'inline',
  minify: false,
  bundle: true,
  preserveSymlinks: true,
};

const jsConfig = {
  ...base,
  entryPoints: ['src/webview.tsx'],
  outfile: 'out/webview.js',
  // define: { DEBUG: JSON.stringify(config.debug) },
};

const cssConfig = {
  ...base,
  entryPoints: ['src/webview.css'],
  outfile: 'out/webview.css',
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
const YELLOW = '\x1b[33m';
const RESET = '\x1b[0m';

function messagePlugin(name) {
  return {
    name: 'Message',
    setup(build) {
      build.onEnd(result => {
        if (result.errors.length > 0) {
          notify(result.errors[0]);
        }
        if (result.warnings.length > 0) {
          notify(result.warnings[0]);
        }

        if (result.errors.length === 0 && result.warnings.length === 0) {
          console.log(`${GREEN}${name} built successfully.${RESET}`);
        }
      });
    },
  };
}

function notify(item) {
  try {
    const msg = itemToStr(item);
    execSync(`notify-send --urgency=critical --expire-time=2000 "esbuild" "${msg}"`);
  } catch (error) {
    console.error(error);
  }
}

function itemToStr(item) {
  let msg;
  if (item.location) {
    msg = `${item.location.file}:${item.location.line}: ${item.text}`;
  } else {
    msg = `Unknown location: ${item.text}`;
  }
  msg = msg.replaceAll('"', '\\"');
  return msg;
}
