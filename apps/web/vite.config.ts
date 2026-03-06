import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { VitePWA } from "vite-plugin-pwa";

const pwaWorkboxMode = process.env.LUMEN_PWA_SW_MODE === "production" ? "production" : "development";
const XTREAM_DEV_PROXY_BASE_PATH = "/xui-api";
const CATCHUP_GATEWAY_BASE_PATH = "/catchup-gateway";
const LOCAL_PROXY_FALLBACK_TARGET = "http://localhost:8788";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const xuiProxyDebugEnabled = env.VITE_XUI_PROXY_DEBUG === "1";
  const proxyTarget = env.VITE_XUI_PROXY_ORIGIN?.trim().replace(/\/+$/, "") || LOCAL_PROXY_FALLBACK_TARGET;

  return {
    server: {
      host: "::",
      port: 8080,
      proxy: {
        [XTREAM_DEV_PROXY_BASE_PATH]: {
          target: proxyTarget,
          changeOrigin: true,
          secure: false,
          configure: (proxyServer) => {
            if (!xuiProxyDebugEnabled) {
              return;
            }

            proxyServer.on("proxyReq", (proxyReq, req) => {
              const method = req.method || "GET";
              const path = req.url || "";
              console.log(`[xui-proxy:req] ${method} ${path}`);
            });

            proxyServer.on("proxyRes", (proxyRes, req) => {
              const method = req.method || "GET";
              const path = req.url || "";
              const statusCode = proxyRes.statusCode || 0;
              const location = proxyRes.headers.location;
              const locationSuffix = typeof location === "string"
                ? ` location=${location}`
                : "";
              console.log(`[xui-proxy:res] ${statusCode} ${method} ${path}${locationSuffix}`);
            });

            proxyServer.on("error", (error, req) => {
              const method = req.method || "GET";
              const path = req.url || "";
              const message = error instanceof Error ? error.message : String(error);
              console.error(`[xui-proxy:error] ${method} ${path} ${message}`);
            });
          },
        },
        [CATCHUP_GATEWAY_BASE_PATH]: {
          target: proxyTarget,
          changeOrigin: true,
          secure: false,
        },
      },
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
