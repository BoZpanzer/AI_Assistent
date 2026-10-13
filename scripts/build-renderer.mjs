// Bundles the renderer (Preact/JSX) and copies runtime assets (onnxruntime-web).
import { build, context } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const r = (...p) => path.join(root, ...p);
const watch = process.argv.includes('--watch');

// onnxruntime-web (local wake word) — only the WASM CPU backend is shipped.
const ortSrc = r('node_modules', 'onnxruntime-web', 'dist');
const ortDst = r('src', 'renderer', 'assets', 'ort');
fs.mkdirSync(ortDst, { recursive: true });
for (const f of ['ort.wasm.min.mjs', 'ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm']) fs.copyFileSync(path.join(ortSrc, f), path.join(ortDst, f));

const opts = {
  entryPoints: { app: r('src', 'renderer', 'src', 'main.jsx'), overlay: r('src', 'renderer', 'src', 'overlay.jsx') },
  bundle: true, format: 'esm', target: 'chrome130', outdir: r('src', 'renderer', 'dist'), splitting: true, chunkNames: 'chunks/[name]-[hash]',
  jsx: 'automatic', jsxImportSource: 'preact', minify: !watch, sourcemap: watch ? 'inline' : false,
  legalComments: 'eof', logLevel: 'info', define: { 'process.env.NODE_ENV': watch ? '"development"' : '"production"' },
  alias: { react: 'preact/compat', 'react-dom': 'preact/compat' },
};
if (watch) { const ctx = await context(opts); await ctx.watch(); } else await build(opts);
