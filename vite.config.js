import { defineConfig } from 'vite';

// Relative base so the build works when hosted in a subfolder (itch.io, GitHub Pages, etc.)
export default defineConfig({
  base: './',
  build: {
    target: 'es2020',
    assetsInlineLimit: 0, // keep the .glb as a real file (don't inline)
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
          bvh: ['three-mesh-bvh'],
        },
      },
    },
  },
  server: { host: true },
});
