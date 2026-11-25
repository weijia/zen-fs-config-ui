import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    'index': 'src/index.ts',
    'react/index': 'src/react/index.ts',
    'web-component/index': 'src/web-component/index.ts',
  },
  format: ['cjs', 'esm'],
  dts: false,
  clean: false,
  external: ['react', 'react-dom', 'zen-fs-config'],
  define: { '__APP_VERSION__': '"0.5.1"' },
});
