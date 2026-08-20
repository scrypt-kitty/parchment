import { defineConfig } from "vite";

// Tauri serves this dev server during `tauri dev` and consumes `dist/` for release
// builds. The fixed port matches `build.devUrl` in src-tauri/tauri.conf.json.
export default defineConfig({
  clearScreen: false,
  server: {
    port: 5183,
    strictPort: true,
  },
  build: {
    // Safari 13 is the floor for the WKWebView on macOS 11, our minimum target.
    target: "safari13",
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: false,
  },
});
