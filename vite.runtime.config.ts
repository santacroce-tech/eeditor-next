import { defineConfig } from "vite";

// The runtime page as one script and one stylesheet, for scripts/build-runtime-template.mjs to put
// inside a single HTML file. Not the app's build: that one is vite.config.ts.
export default defineConfig({
  publicDir: false,
  build: {
    outDir: "dist-runtime",
    emptyOutDir: true,
    target: "es2022",
    cssCodeSplit: false,
    assetsInlineLimit: Number.MAX_SAFE_INTEGER,
    modulePreload: false,
    rollupOptions: { input: "runtime.html", output: { inlineDynamicImports: true } },
  },
});
