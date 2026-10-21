import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { parse } from "acorn";

const root = process.argv[2];
if (!root) throw new Error("Usage: node scripts/check-tv-compat.mjs <build-directory>");

async function collect(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collect(path));
    else if (/\.(js|css)$/.test(entry.name)) files.push(path);
  }
  return files;
}

const files = await collect(root);
if (files.length === 0) throw new Error(`No JavaScript or CSS output found under ${root}`);

const failures = [];
for (const file of files) {
  const content = await readFile(file, "utf8");
  if (file.endsWith(".js")) {
    try {
      parse(content, { ecmaVersion: 2018, sourceType: "module" });
    } catch (error) {
      failures.push(`${relative(root, file)}: syntax exceeds the Chromium 63 / ECMAScript 2018 baseline (${error.message})`);
    }
    continue;
  }
  const unsupportedCss = [
    [/(?:^|[;{])\s*(?:(?:grid|flex)-)?gap\s*:/m, "flex/grid gap"],
    [/(?:^|[;{])\s*aspect-ratio\s*:/m, "aspect-ratio"],
    [/:focus-visible\b/, ":focus-visible"],
    [/(?:^|[;{])\s*inset\s*:/m, "inset shorthand"],
    [/(?:^|[;{])\s*backdrop-filter\s*:/m, "unprefixed backdrop-filter"],
  ];
  for (const [pattern, feature] of unsupportedCss) {
    if (pattern.test(content)) failures.push(`${relative(root, file)}: unsupported TV CSS feature ${feature}`);
  }
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`TV compatibility check passed: ${files.length} emitted JS/CSS files (Chrome 63 syntax and legacy CSS baseline).`);
}
