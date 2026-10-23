import { defineConfig } from "vite";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readFile, writeFile } from "node:fs/promises";
import { parseSourceOrigins } from "./scripts/tizen-source-origins.mjs";

const appRoot = dirname(fileURLToPath(import.meta.url));

const sourceOrigins = parseSourceOrigins(process.env.KLARO_TV_SOURCE_ORIGINS);

export default defineConfig({
  define: { "import.meta.env.VITE_TV_TARGET": JSON.stringify("tizen"), "import.meta.env.VITE_TV_SOURCE_ORIGINS": JSON.stringify(sourceOrigins) },
  root: appRoot,
  base: "./",
  publicDir: resolve(appRoot, "platforms/tizen"),
  plugins: [{ name: "samsung-api", transformIndexHtml: () => [{ tag: "script", attrs: { src: "$WEBAPIS/webapis/webapis.js" }, injectTo: "head" }],
    async writeBundle(outputOptions) {
      const source = await readFile(resolve(appRoot, "platforms/tizen/config.xml"), "utf8");
      const escapeXml = (value: string) => value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
      const access = sourceOrigins.map(origin => `  <access origin="${escapeXml(origin)}" subdomains="false" />`).join("\n");
      await writeFile(resolve(outputOptions.dir || resolve(appRoot, "dist/tizen"), "config.xml"), source.replace("</widget>", `${access}\n</widget>`));
    },
  }],
  build: {
    outDir: "dist/tizen",
    emptyOutDir: true,
    target: "chrome63",
    cssTarget: "chrome63",
    sourcemap: false,
  },
});
