import { startProxyServer } from "./server.js";

const bootstrap = async (): Promise<void> => {
  try {
    await startProxyServer();
  } catch (error) {
    console.error("[proxy] failed to start", error);
    process.exit(1);
  }
};

void bootstrap();
