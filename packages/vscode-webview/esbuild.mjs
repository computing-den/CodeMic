// It's possible to have custom formatting of logs.
// See https://github.com/evanw/esbuild/issues/2153
// But print it all, including the suggestions, is a little more involved.
// Here's an example of an error item that is received by the plugin:
// {
//   "id": "css-syntax-error",
//   "location": {
//     "column": 4,
//     "file": "src/player.css",
//     "length": 3,
//     "line": 11,
//     "lineText": "    add {",
//     "namespace": "",
//     "suggestion": ":is(add)"
//   },
//   "notes": [
//     {
//       "location": null,
//       "text": "To start a nested style rule with an identifier, you need to wrap the identifier in \":is(...)\" to prevent the rule from being parsed as a declaration."
//     }
//   ],
//   "pluginName": "",
//   "text": "A nested style rule cannot start with \"add\" because it looks like the start of a declaration"
// }
// Also, we must set logLevel: 'silent' to disable esbuild to print to console on its own.
// In which case, we do lose the info and debug logs, but we still get the errors and warnings in the plugin.

import * as esbuild from 'esbuild';

// const mustWatch = process.argv.includes('--watch');

// const RED = '\x1b[31m';
// const GREEN = '\x1b[32m';
// const YELLOW = '\x1b[33m';
// const RESET = '\x1b[0m';

const base = {
  target: ['chrome114', 'firefox113', 'safari16.5', 'edge114'],
  sourcemap: 'inline',
  minify: false,
  bundle: true,
  // logLevel: 'silent',
};

const jsConfig = {
  ...base,
  entryPoints: ['src/webview.tsx'],
  outfile: 'out/webview.js',
  // define: { DEBUG: JSON.stringify(config.debug) },
  // plugins: [messagePlugin('JS')],
};

const cssConfig = {
  ...base,
  entryPoints: ['src/webview.css'],
  outfile: 'out/webview.css',
  // plugins: [messagePlugin('CSS')],
};

await esbuild.build(jsConfig);
await esbuild.build(cssConfig);

// if (mustWatch) {
//   const jsCtx = await esbuild.context({ ...jsConfig, plugins: [messagePlugin('JS')] });
//   const cssCtx = await esbuild.context({ ...cssConfig, plugins: [messagePlugin('CSS')] });
//   await jsCtx.watch();
//   await cssCtx.watch();
//   console.log('\nesbuild is watching javascript and css files...');
// } else {
//   await esbuild.build(jsConfig);
//   await esbuild.build(cssConfig);
// }

// function messagePlugin(name) {
//   return {
//     name: 'Message',
//     setup(build) {
//       build.onEnd(result => {
//         for (const error of result.errors) {
//           // console.error(JSON.stringify(error, null, 2));
//           console.error(itemToStr(error));
//         }
//         for (const warning of result.warnings) {
//           // console.error(JSON.stringify(warning, null, 2));
//           console.error(itemToStr(warning));
//         }

//         if (result.errors.length === 0 && result.warnings.length === 0) {
//           console.log(`${GREEN}esbuild ${name} built successfully.${RESET}`);
//         }
//       });
//     },
//   };
// }

// function itemToStr(item) {
//   let msg;
//   if (item.location) {
//     msg = itemLocationToStr(item.location)
//     msg = `${item.location.file}:${item.location.line}:${item.location.column} - error esbuild: ${item.text}`;
//   } else {
//     msg = `Unknown:0:0 - error unknown: ${item.text}`;
//   }
//   return msg;
// }
