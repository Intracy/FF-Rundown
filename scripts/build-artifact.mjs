// Baut eine einzelne, eigenständige HTML-Seite (React über cdnjs, App-Code inline).
// Ergebnis: dist-artifact/taktgeber.html
import { build } from 'esbuild';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'dist-artifact');
mkdirSync(out, { recursive: true });

const globals = { react: 'React', 'react-dom': 'ReactDOM', 'react-dom/client': 'ReactDOM' };
const umdGlobals = {
  name: 'umd-globals',
  setup(b) {
    b.onResolve({ filter: /^react(-dom)?(\/client)?$/ }, (a) => ({ path: a.path, namespace: 'umd' }));
    b.onLoad({ filter: /.*/, namespace: 'umd' }, (a) => ({ contents: `module.exports = window.${globals[a.path]};`, loader: 'js' }));
  },
};

await build({
  entryPoints: [path.join(root, 'src/main.tsx')],
  bundle: true,
  format: 'iife',
  minify: true,
  target: 'es2020',
  jsx: 'transform',
  jsxFactory: 'React.createElement',
  jsxFragment: 'React.Fragment',
  define: { __ARTIFACT__: 'true', 'process.env.NODE_ENV': '"production"' },
  plugins: [umdGlobals],
  outfile: path.join(out, 'app.js'),
  logLevel: 'warning',
});

const js = readFileSync(path.join(out, 'app.js'), 'utf8').replace(/<\/script/gi, '<\\/script');
const css = readFileSync(path.join(out, 'app.css'), 'utf8').replace(/<\/style/gi, '<\\/style');

const html = `<title>Taktgeber</title>
<meta name="claude:viewport-fit-sides" content="cover">
<style>${css}</style>
<div id="root"></div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/react/18.3.1/umd/react.production.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.3.1/umd/react-dom.production.min.js"></script>
<script>${js}</script>
`;
writeFileSync(path.join(out, 'taktgeber.html'), html);

// Lokale Vorschau mit vollständigem HTML-Gerüst (für Screenshots/Tests)
writeFileSync(
  path.join(out, 'preview.html'),
  `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"></head><body>${html}</body></html>`,
);
console.log(`dist-artifact/taktgeber.html  ${(html.length / 1024).toFixed(0)} KB`);
