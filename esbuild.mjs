import * as esbuild from 'esbuild';
import fs from 'fs';

const watch = process.argv.includes('--watch');
const production = process.argv.includes('--production');
const metafile = process.argv.includes('--metafile');

/**
 * @type {import('esbuild').Plugin}
 */
const esbuildProblemMatcherPlugin = {
  name: 'esbuild-problem-matcher',

  setup(build) {
    build.onStart(() => {
      console.log('[watch] build started');
    });
    build.onEnd(result => {
      result.errors.forEach(({ text, location }) => {
        console.error(`✘ [ERROR] ${text}`);
        console.error(`    ${location.file}:${location.line}:${location.column}:`);
      });
      console.log('[watch] build finished');
    });
  },
};

const browsers = ['chrome114', 'firefox113', 'safari16.5', 'edge114'];

// VSCode webview cannot load .map files. See https://github.com/microsoft/vscode/issues/145184
// So we create inline sourcemaps.
// Also we must make sure that sourcesContent is not set to false or the actual source
// will not be included in the inline sourcemap.
const sourcemap = production ? false : 'inline';

const common = {
  bundle: true,
  minify: production,
  sourcemap,
  logLevel: 'silent', // silent the default logger
  plugins: [esbuildProblemMatcherPlugin],
  metafile,
};

const viewJs = await esbuild.context({
  ...common,
  entryPoints: ['src/view/webview.tsx'],
  outfile: 'dist/webview.js',
  target: browsers,
  alias: {
    path: 'path-browserify',
  },
});

const viewCss = await esbuild.context({
  ...common,
  entryPoints: ['src/view/webview.css'],
  outfile: 'dist/webview.css',
  target: browsers,
  loader: { '.ttf': 'file', '.woff2': 'file', '.ttf': 'file' },
});

/** @type {import('esbuild').BuildOptions} */
const extensionJs = await esbuild.context({
  ...common,
  entryPoints: ['src/extension/extension.ts'],
  outfile: 'dist/extension.js',
  platform: 'node',
  format: 'cjs',
  external: ['vscode'],
});

if (watch) {
  await viewJs.watch();
  await viewCss.watch();
  await extensionJs.watch();
} else {
  const viewJsRes = await viewJs.rebuild();
  const viewCssRes = await viewCss.rebuild();
  const extensionJsRes = await extensionJs.rebuild();

  if (metafile) {
    fs.writeFileSync('dist/webview.js.json', JSON.stringify(viewJsRes.metafile));
    fs.writeFileSync('dist/webview.css.json', JSON.stringify(viewCssRes.metafile));
    fs.writeFileSync('dist/extension.js.json', JSON.stringify(extensionJsRes.metafile));
  }

  await viewJs.dispose();
  await viewCss.dispose();
  await extensionJs.dispose();
}

// if (mustWatch) {
//   const jsCtx = await esbuild.context({ ...viewJs, plugins: [messagePlugin('JS')] });
//   const cssCtx = await esbuild.context({ ...viewCss, plugins: [messagePlugin('CSS')] });
//   await jsCtx.watch();
//   await cssCtx.watch();
//   console.log('\nesbuild is watching javascript and css files...');
// } else {
//   await esbuild.build(viewJs);
//   await esbuild.build(viewCss);
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
