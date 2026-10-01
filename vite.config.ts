import { defineConfig } from "vite";

// Tauri-friendly defaults (fixed port, no clear-screen so bridge/engine logs stay visible).
export default defineConfig({
  clearScreen: false,
  server: { port: 5173, strictPort: true },
  build: {
    outDir: "dist",
    target: "es2022",
    emptyOutDir: true,
    // The app; a form running on its own over the WebAssembly engine; and a form's screen control
    // in a window of its own, over the app's engine.
    rollupOptions: { input: { main: "index.html", runtime: "runtime.html", screen: "screen.html" } },
  },
});
