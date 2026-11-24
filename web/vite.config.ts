/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The api the development server forwards /api to (`npm run dev`); in production the api serves the built files itself.
const api = process.env.IDTRACK_WEB_API ?? "http://127.0.0.1:8000";

export default defineConfig({
  plugins: [react()],
  server: { host: "127.0.0.1", port: 5173, strictPort: true, proxy: { "/api": { target: api, changeOrigin: false } } },
  preview: { host: "127.0.0.1", port: 4173, strictPort: true, proxy: { "/api": { target: api } } },
  build: { target: "es2022", sourcemap: true, assetsInlineLimit: 0, chunkSizeWarningLimit: 400 },
  test: {
    environment: "node",
    include: ["tests/**/*.test.{ts,tsx}"],
    setupFiles: ["tests/setup.ts"],
    restoreMocks: true,
  },
});
