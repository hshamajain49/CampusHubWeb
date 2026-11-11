import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
      { find: /^@campushub\/shared\/time$/, replacement: path.resolve(__dirname, '../shared/src/time.ts') },
      { find: /^@campushub\/shared$/, replacement: path.resolve(__dirname, '../shared/src/index.ts') },
      { find: /^@\//, replacement: `${path.resolve(__dirname, 'src')}/` },
    ],
  },
  // 5173 by default; if another dev server holds it, Vite moves to the next free port (dev CORS allows 5174–5175).
  server: { port: 5173, strictPort: false },
  preview: { port: 5173 },
  build: { target: 'es2022', chunkSizeWarningLimit: 900 },
  test: { environment: 'jsdom', setupFiles: ['./src/test/setup.ts'], css: false },
} as any);
