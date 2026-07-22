import { defineConfig } from "vite";

// Tauri-friendly defaults (fixed port, no clear-screen so bridge/engine logs stay visible).
export default defineConfig({
  clearScreen: false,
  server: { port: 5173, strictPort: true },
  build: { outDir: "dist", target: "es2022", emptyOutDir: true },
});
