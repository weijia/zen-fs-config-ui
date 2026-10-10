import { defineConfig } from 'tsup';
import type { Plugin } from 'esbuild';
import pkg from './package.json';

const VERSION = JSON.stringify(pkg.version);

/**
 * Stub Node.js built-in modules (`fs`/`path`/`os`/`crypto`/...) when bundling
 * for the browser. zen-fs-config@0.5.x only dynamic-imports these inside its
 * Folder backend and node-crypto paths, which are never reached in a browser,
 * so replacing them with empty modules is safe and lets the IIFE build succeed.
 */
const nodeBuiltinsStub: Plugin = {
  name: 'node-builtins-stub',
  setup(build) {
    const builtins = new Set([
      'fs', 'path', 'os', 'crypto', 'stream', 'util', 'http', 'https',
      'url', 'events', 'buffer', 'process',
    ]);
    build.onResolve({ filter: /.*/ }, (args) => {
      let name = args.path;
      if (name.startsWith('node:')) name = name.slice(5);
      // Leave `buffer`/`process` to resolve normally — `buffer` maps to the
      // installed npm polyfill and `process` is provided by platform=browser.
      if (name === 'buffer' || name === 'process') return undefined;
      if (!builtins.has(name)) return undefined;
      return {
        path: `stub:${name}`,
        namespace: 'node-stub',
      };
    });
    build.onLoad({ filter: /.*/, namespace: 'node-stub' }, () => {
      return { contents: 'export default {}; export const sync = {};', loader: 'js' };
    });
  },
};

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
    define: {
      '__APP_VERSION__': VERSION,
    },
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
    // Stub Node builtins so their dynamic imports (Folder/Node paths) don't break
    // the browser bundle — they are never reached in a browser environment.
    // `buffer` (npm polyfill) and `process` (platform=browser shim) resolve normally.
    alias: { buffer: 'buffer' },
    esbuildPlugins: [nodeBuiltinsStub],
    splitting: false,
    clean: false,
    outExtension: () => ({ js: '.js' }),
    define: {
      'process.env.NODE_ENV': '"production"',
      '__APP_VERSION__': VERSION,
    },
  },
]);
