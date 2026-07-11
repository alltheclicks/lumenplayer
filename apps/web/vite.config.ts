import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { VitePWA } from "vite-plugin-pwa";

const pwaWorkboxMode = process.env.LUMEN_PWA_SW_MODE === "production" ? "production" : "development";
const debugProxyLogEnabled = process.env.LUMEN_DEBUG_PROXY_LOG === "1";
const XTREAM_DEV_PROXY_BASE_PATH = "/xui-api";
const CATCHUP_GATEWAY_PROXY_PATH = "/catchup-gateway";
const XTREAM_HLS_ROOT_PROXY_PATH = "/hlsr";
const LOCAL_PROXY_FALLBACK_TARGET = "http://localhost";
const LOCAL_DEV_NO_STORE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
};

const parseAllowedHosts = (rawValue?: string): true | string[] | undefined => {
  const raw = rawValue?.trim();
  if (!raw) {
    return undefined;
  }

  if (raw === "*") {
    return true;
  }

  const hosts = raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  return hosts.length > 0 ? hosts : undefined;
};

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

const decodeLoggedProxyPath = (requestPath: string): string => {
  const proxyTarget = resolveProxyTargetFromRequestPath(requestPath);
  if (!proxyTarget) {
    return requestPath;
  }

  const match = requestPath.match(new RegExp(`^${XTREAM_DEV_PROXY_BASE_PATH}/[^/?#]+(.*)$`));
  return `${proxyTarget}${match?.[1] ?? ""}`;
};

const createProxyLogger = (label: string) => (proxy: {
  on: (event: string, listener: (...args: unknown[]) => void) => void;
}): void => {
  if (!debugProxyLogEnabled) {
    return;
  }

  proxy.on("proxyReq", (_proxyReq, req: { method?: string; url?: string }) => {
    console.log(`[vite-proxy:${label}:req]`, req.method ?? "GET", decodeLoggedProxyPath(req.url ?? ""));
  });

  proxy.on(
    "proxyRes",
    (proxyRes: { statusCode?: number }, req: { method?: string; url?: string }) => {
      console.log(
        `[vite-proxy:${label}:res]`,
        proxyRes.statusCode ?? 0,
        req.method ?? "GET",
        decodeLoggedProxyPath(req.url ?? ""),
      );
    },
  );
};

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const brandName = (env.VITE_BRAND_NAME ?? "").trim() || "Lumen Player";
  const brandShort = brandName.replace(/\s+player$/i, "");
  const xtreamServerTarget = env.VITE_XTREAM_SERVER?.trim().replace(/\/+$/, "");
  const xuiProxyTarget = env.VITE_XUI_PROXY_ORIGIN?.trim().replace(/\/+$/, "");
  const catchUpGatewayTarget = env.VITE_CATCHUP_GATEWAY_ORIGIN?.trim().replace(/\/+$/, "") ||
    xuiProxyTarget;
  const allowedHosts = parseAllowedHosts(env.LUMEN_VITE_ALLOWED_HOSTS);
  const proxyConfig = {
    ...(xuiProxyTarget
      ? {
          [XTREAM_DEV_PROXY_BASE_PATH]: {
            target: xuiProxyTarget,
            changeOrigin: true,
            secure: false,
            configure: createProxyLogger("xui-api"),
          },
        }
      : xtreamServerTarget
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
            configure: createProxyLogger("xui-api"),
          },
        }
      : {}),
    ...(xtreamServerTarget
      ? {
          [XTREAM_HLS_ROOT_PROXY_PATH]: {
            target: xtreamServerTarget,
            changeOrigin: true,
            secure: false,
            configure: createProxyLogger("hlsr"),
          },
        }
      : {}),
    ...(catchUpGatewayTarget
      ? {
          [CATCHUP_GATEWAY_PROXY_PATH]: {
            target: catchUpGatewayTarget,
            changeOrigin: true,
            secure: false,
            configure: createProxyLogger("catchup-gateway"),
          },
        }
      : {}),
  };

  return {
    server: {
      host: "::",
      port: 8080,
      headers: LOCAL_DEV_NO_STORE_HEADERS,
      ...(allowedHosts ? { allowedHosts } : {}),
      proxy: Object.keys(proxyConfig).length > 0 ? proxyConfig : undefined,
    },
    preview: {
      host: "::",
      port: 8080,
      headers: LOCAL_DEV_NO_STORE_HEADERS,
      ...(allowedHosts ? { allowedHosts } : {}),
    },
    plugins: [
      {
        name: "lumen-brand-html",
        transformIndexHtml: (html: string) =>
          html.replace(/<title>[^<]*<\/title>/, `<title>${brandName}</title>`),
      },
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
          name: brandName,
          short_name: brandShort,
          description: "Watch live TV channels",
          theme_color: "#3B77F7",
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
