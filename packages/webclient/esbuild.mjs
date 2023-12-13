import * as esbuild from 'esbuild';

const base = {
  target: ['chrome114', 'firefox113', 'safari16.5', 'edge114'],
  sourcemap: 'inline',
  minify: false,
  bundle: true,
  // logLevel: 'silent',
};

const jsConfig = {
  ...base,
  entryPoints: ['src/client.tsx'],
  outfile: 'out/client.js',
  // define: { DEBUG: JSON.stringify(config.debug) },
  // plugins: [messagePlugin('JS')],
};

const cssConfig = {
  ...base,
  entryPoints: ['src/client.css'],
  outfile: 'out/client.css',
  // plugins: [messagePlugin('CSS')],
};

await esbuild.build(jsConfig);
await esbuild.build(cssConfig);
