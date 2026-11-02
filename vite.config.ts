import { defineConfig } from 'vite';

// Klassische JSX-Transformation (React.createElement), damit derselbe Code
// auch gegen die UMD-Builds von React laufen kann (siehe scripts/build-artifact.mjs).
export default defineConfig({
  esbuild: { jsx: 'transform', jsxFactory: 'React.createElement', jsxFragment: 'React.Fragment' },
  define: { __ARTIFACT__: 'false' },
  server: {
    host: true,
    proxy: { '/ws': { target: 'ws://localhost:8787', ws: true }, '/api': 'http://localhost:8787' },
  },
});
