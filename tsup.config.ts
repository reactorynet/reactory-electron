import { defineConfig } from 'tsup';

export default defineConfig({
  entry: [
    'src/main/index.ts',
    'src/main/preload.ts',
    'src/main/splash-preload.ts',
  ],
  format: ['cjs'],
  outDir: 'dist/main',
  clean: true,
  sourcemap: true,
  external: ['electron'],
  platform: 'node',
  target: 'node20',
  splitting: false,
  treeshake: true,
});
