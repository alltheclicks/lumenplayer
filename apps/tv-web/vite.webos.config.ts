import { defineConfig } from "vite";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: appRoot,
  base: "./",
  publicDir: resolve(appRoot, "platforms/webos"),
  build: {
    outDir: "dist/webos",
    emptyOutDir: true,
    target: "chrome63",
    cssTarget: "chrome63",
    sourcemap: false,
  },
});
