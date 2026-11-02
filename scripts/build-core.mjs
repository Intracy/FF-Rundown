// Bündelt die Show-Logik (TypeScript) für den Server: server/core.mjs
import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
await build({
  stdin: {
    contents: `export * from './src/live.ts'; export { computeTimeline } from './src/timing.ts'; export { normalizeRundown } from './src/model.ts';`,
    resolveDir: root,
    sourcefile: 'core-entry.ts',
    loader: 'ts',
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node18',
  outfile: path.join(root, 'server/core.mjs'),
  logLevel: 'warning',
  banner: { js: '// Automatisch erzeugt aus src/ – nicht von Hand bearbeiten (npm run build:core)' },
});
