import { defineConfig } from "vite";
import pkg from "./package.json" with { type: "json" };

// Tauri-friendly defaults (fixed port, no clear-screen so bridge/engine logs stay visible).
export default defineConfig({
  clearScreen: false,
  // the About box's version — package.json is the one CI checks a release tag against
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
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
