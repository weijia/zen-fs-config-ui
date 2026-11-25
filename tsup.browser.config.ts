import { defineConfig } from 'tsup';
import type { Plugin } from 'esbuild';

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
      if (name === 'buffer' || name === 'process') return undefined;
      if (!builtins.has(name)) return undefined;
      return { path: `stub:${name}`, namespace: 'node-stub' };
    });
    build.onLoad({ filter: /.*/, namespace: 'node-stub' }, () => ({
      contents: 'export default {}; export const sync = {};',
      loader: 'js',
    }));
  },
};

export default defineConfig({
  entry: { 'zen-fs-config-ui': 'src/browser.ts' },
  format: ['iife'],
  globalName: 'ZenFSConfigUI',
  platform: 'browser',
  target: 'es2020',
  noExternal: [/.*/],
  alias: { buffer: 'buffer' },
  esbuildPlugins: [nodeBuiltinsStub],
  splitting: false,
  clean: false,
  outExtension: () => ({ js: '.js' }),
  define: {
    'process.env.NODE_ENV': '"production"',
    '__APP_VERSION__': '"0.5.1"',
  },
});
