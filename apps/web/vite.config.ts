import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { VitePWA } from "vite-plugin-pwa";

const pwaWorkboxMode = process.env.LUMEN_PWA_SW_MODE === "production" ? "production" : "development";
const XTREAM_DEV_PROXY_BASE_PATH = "/xui-api";
const CATCHUP_GATEWAY_PROXY_PATH = "/catchup-gateway";
const LOCAL_PROXY_FALLBACK_TARGET = "http://localhost";

const resolveProxyTargetFromRequestPath = (requestPath: string): string | null => {
  const match = requestPath.match(new RegExp(`^${XTREAM_DEV_PROXY_BASE_PATH}/([^/?#]+)`));
  if (!match || !match[1]) {
    return null;
  }

  try {
    const decodedTarget = decodeURIComponent(match[1]).trim().replace(/\/+$/, "");
    if (decodedTarget.startsWith("http://") || decodedTarget.startsWith("https://")) {
      return decodedTarget;
    }
  } catch {
    // Ignore malformed encoded targets and fall back to default proxy target.
  }

  return null;
};

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const xtreamServerTarget = env.VITE_XTREAM_SERVER?.trim().replace(/\/+$/, "");
  const catchUpGatewayTarget = env.VITE_CATCHUP_GATEWAY_ORIGIN?.trim().replace(/\/+$/, "") ||
    env.VITE_XUI_PROXY_ORIGIN?.trim().replace(/\/+$/, "");
  const proxyConfig = {
    ...(xtreamServerTarget
      ? {
          [XTREAM_DEV_PROXY_BASE_PATH]: {
            target: xtreamServerTarget || LOCAL_PROXY_FALLBACK_TARGET,
            changeOrigin: true,
            secure: false,
            router: (request) => (
              resolveProxyTargetFromRequestPath(request.url || "") ||
              xtreamServerTarget ||
              LOCAL_PROXY_FALLBACK_TARGET
            ),
            rewrite: (requestPath: string) => (
              requestPath
                .replace(new RegExp(`^${XTREAM_DEV_PROXY_BASE_PATH}/[^/?#]+`), "")
                .replace(new RegExp(`^${XTREAM_DEV_PROXY_BASE_PATH}`), "")
            ),
          },
        }
      : {}),
    ...(catchUpGatewayTarget
      ? {
          [CATCHUP_GATEWAY_PROXY_PATH]: {
            target: catchUpGatewayTarget,
            changeOrigin: true,
            secure: false,
          },
        }
      : {}),
  };

  return {
    server: {
      host: "::",
      port: 8080,
      proxy: Object.keys(proxyConfig).length > 0 ? proxyConfig : undefined,
    },
    plugins: [
      react(),
      VitePWA({
        registerType: "autoUpdate",
        includeAssets: [
          "favicon.svg",
          "apple-touch-icon.png",
          "pwa-192x192.png",
          "pwa-512x512.png",
          "pwa-maskable-512x512.png",
          "apple-splash-1179x2556.png",
          "apple-splash-1290x2796.png",
          "apple-splash-1536x2048.png",
          "apple-splash-1668x2388.png",
        ],
        manifest: {
          name: "IPTV Player",
          short_name: "IPTV",
          description: "Watch live TV channels",
          theme_color: "#3B82F6",
          background_color: "#0a0a0a",
          display: "standalone",
          orientation: "portrait",
          start_url: "/",
          scope: "/",
          icons: [
            {
              src: "pwa-192x192.png",
              sizes: "192x192",
              type: "image/png",
            },
            {
              src: "pwa-512x512.png",
              sizes: "512x512",
              type: "image/png",
            },
            {
              src: "pwa-maskable-512x512.png",
              sizes: "512x512",
              type: "image/png",
              purpose: "maskable",
            },
          ],
        },
        workbox: {
          mode: pwaWorkboxMode,
          importScripts: ["sw-push-handlers.js"],
          globPatterns: ["**/*.{js,css,html,ico,png,svg,woff,woff2}"],
          runtimeCaching: [
            {
              urlPattern: ({ request }) => request.mode === "navigate",
              handler: "NetworkFirst",
              options: {
                cacheName: "page-cache",
                networkTimeoutSeconds: 3,
                precacheFallback: {
                  fallbackURL: "/offline.html",
                },
              },
            },
          ],
        },
      }),
    ],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
  };
});
