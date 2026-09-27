import { defineConfig } from 'tsup';

export default defineConfig([
  // ── npm build: CJS + ESM + d.ts ──────────────────────────────────────
  {
    entry: {
      'index': 'src/index.ts',
      'react/index': 'src/react/index.ts',
      'web-component/index': 'src/web-component/index.ts',
    },
    format: ['cjs', 'esm'],
    dts: true,
    clean: true,
    // Keep peer deps external
    external: ['react', 'react-dom', 'zen-fs-config'],
  },
  // ── Browser IIFE build: bundles core + web-component (NO React) ──────
  // Exposes window.ZenFSConfigUI with the web component auto-registered.
  {
    entry: { 'zen-fs-config-ui': 'src/browser.ts' },
    format: ['iife'],
    globalName: 'ZenFSConfigUI',
    platform: 'browser',
    target: 'es2020',
    noExternal: [/.*/],
    splitting: false,
    clean: false,
    outExtension: () => ({ js: '.js' }),
    define: {
      'process.env.NODE_ENV': '"production"',
    },
  },
]);
