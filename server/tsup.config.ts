import { defineConfig } from 'tsup';

// Bundles the server (plus the @gatherly/shared workspace and generated Prisma client)
// into dist/. Third-party npm packages stay external and are installed on the host.
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node20',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  splitting: false,
  noExternal: ['@gatherly/shared'],
});
