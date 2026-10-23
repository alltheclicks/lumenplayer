import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

/** Standalone source build: shell composition intentionally remains unavailable. */
export default defineConfig({
  build: {
    outDir: "/tmp/klaro-tv006-logs/adapter-build",
    emptyOutDir: true,
    target: "chrome63",
    lib: {
      entry: fileURLToPath(new URL("./TizenTVPlaybackAdapter.ts", import.meta.url)),
      formats: ["es"],
      fileName: () => "tizen-adapter.js",
    },
  },
});
