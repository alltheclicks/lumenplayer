import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/.turbo/**",
      "**/.next/**",
      "**/coverage/**",
      "**/*.d.ts",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx,mts,cts}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
  {
    // P4 guardrail (docs/P4-CORE-EXTRACTION-PLAN-20261006.md step 0c): shared
    // packages must run on web, TV web engines and React Native, so they may
    // not reach for browser globals or UI/platform libraries. Platform-specific
    // packages are listed in `ignores` with the reason.
    files: ["packages/*/src/**/*.{ts,tsx}"],
    ignores: [
      "packages/*/src/**/*.test.{ts,tsx}",
      // Web Storage adapter package (DOM by design).
      "packages/storage/src/**",
      // TEMPORARY: session-store reads localStorage/BroadcastChannel; step 3f injects them.
      "packages/session-core/src/session-store.ts",
    ],
    rules: {
      "no-restricted-globals": [
        "error",
        ...[
          "window",
          "document",
          "location",
          "navigator",
          "localStorage",
          "sessionStorage",
          "indexedDB",
          "BroadcastChannel",
          "DOMParser",
          "matchMedia",
        ].map((name) => ({
          name,
          message: "Shared packages are platform-agnostic: inject this through an adapter (P4 invariant I-4).",
        })),
      ],
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "react", message: "Shared packages must not depend on React (P4 invariant I-1)." },
            { name: "react-dom", message: "Shared packages must not depend on React DOM (P4 invariant I-1)." },
            { name: "react-native", message: "Shared packages must not depend on React Native (P4 invariant I-1)." },
            { name: "hls.js", message: "hls.js belongs in a browser adapter package such as @lumen/player-hls." },
          ],
          patterns: [
            { group: ["@/*"], message: "Packages must not import app code (P4 invariant I-1)." },
            { group: ["**/apps/**"], message: "Packages must not import app code (P4 invariant I-1)." },
          ],
        },
      ],
    },
  },
  {
    files: ["**/*.{js,mjs,cjs}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.node,
      },
    },
  },
);
