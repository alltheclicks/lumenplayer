import type { ProxyLogger } from "./catchup-normalizer.js";
import { AssetStore } from "./asset-store.js";
import type {
  CatchUpGatewayAssetState,
  CatchUpGatewayServerPolicy,
} from "./catchup-gateway-contracts.js";
import { HotPathCache } from "./hot-path-cache.js";

interface PendingTask {
  serverId: string;
  serverLimit: number;
  run: () => void;
}

export class PreparationCoordinator {
  private readonly inFlight = new Map<string, Promise<void>>();
  private readonly pendingTasks: PendingTask[] = [];
  private readonly activeByServer = new Map<string, number>();
  private activeGlobalCount = 0;

  constructor(private readonly options: {
    globalConcurrency: number;
    assetStore: AssetStore;
    hotPathCache: HotPathCache<boolean>;
    logger: ProxyLogger;
    prewarmProxyRemuxAsset: (input: {
      upstreamUrl: URL;
      requestHeaders: Headers;
    }) => Promise<void>;
  }) {}

  ensurePrepared(input: {
    assetKey: string;
    serverId: string;
    channelId: string;
    programId: string;
    playbackUrl: string;
    upstreamPreparationUrl: URL | null;
    requestHeaders: Headers;
    policy: CatchUpGatewayServerPolicy;
  }): {
    assetState: CatchUpGatewayAssetState;
    shared: boolean;
  } {
    if (!input.upstreamPreparationUrl) {
      this.options.assetStore.markState(
        input.assetKey,
        "ready",
        input.policy.cacheTtlMs,
      );
      this.options.hotPathCache.set(input.assetKey, true, input.policy.prewarmWindowSeconds * 1000);
      this.options.hotPathCache.set(
        `${input.serverId}:${input.channelId}`,
        true,
        input.policy.prewarmWindowSeconds * 1000,
      );
      return {
        assetState: "ready",
        shared: false,
      };
    }

    const existing = this.inFlight.get(input.assetKey);
    if (existing) {
      return {
        assetState: "preparing",
        shared: true,
      };
    }

    this.options.assetStore.markState(
      input.assetKey,
      "preparing",
      input.policy.cacheTtlMs,
      {
        playbackUrl: input.playbackUrl,
      },
    );
    this.options.logger.info("gateway.asset_prepare_started", {
      serverId: input.serverId,
      channelId: input.channelId,
      programId: input.programId,
      assetKey: input.assetKey,
    });

    const job = this.runWithLimits(input.serverId, input.policy.perServerConcurrency, async () => {
      await this.options.prewarmProxyRemuxAsset({
        upstreamUrl: input.upstreamPreparationUrl as URL,
        requestHeaders: input.requestHeaders,
      });

      this.options.assetStore.markState(
        input.assetKey,
        "ready",
        input.policy.cacheTtlMs,
        {
          playbackUrl: input.playbackUrl,
        },
      );
      this.options.hotPathCache.set(input.assetKey, true, input.policy.prewarmWindowSeconds * 1000);
      this.options.hotPathCache.set(
        `${input.serverId}:${input.channelId}`,
        true,
        input.policy.prewarmWindowSeconds * 1000,
      );
      this.options.logger.info("gateway.asset_prepare_completed", {
        serverId: input.serverId,
        channelId: input.channelId,
        programId: input.programId,
        assetKey: input.assetKey,
      });
    }).catch((error) => {
      const message = error instanceof Error ? error.message : "Catch-up gateway preparation failed.";
      this.options.assetStore.markState(
        input.assetKey,
        "failed",
        input.policy.cacheTtlMs,
        {
          playbackUrl: input.playbackUrl,
          errorMessage: message,
        },
      );
      this.options.logger.warn("gateway.asset_prepare_failed", {
        serverId: input.serverId,
        channelId: input.channelId,
        programId: input.programId,
        assetKey: input.assetKey,
        message,
      });
    }).finally(() => {
      this.inFlight.delete(input.assetKey);
    });

    this.inFlight.set(input.assetKey, job);

    return {
      assetState: "preparing",
      shared: false,
    };
  }

  private runWithLimits<TValue>(
    serverId: string,
    serverLimit: number,
    task: () => Promise<TValue>,
  ): Promise<TValue> {
    return new Promise<TValue>((resolve, reject) => {
      const runTask = () => {
        this.activeGlobalCount += 1;
        this.activeByServer.set(serverId, (this.activeByServer.get(serverId) ?? 0) + 1);

        void task().then(resolve, reject).finally(() => {
          this.activeGlobalCount = Math.max(0, this.activeGlobalCount - 1);
          const nextServerCount = Math.max(0, (this.activeByServer.get(serverId) ?? 1) - 1);
          if (nextServerCount === 0) {
            this.activeByServer.delete(serverId);
          } else {
            this.activeByServer.set(serverId, nextServerCount);
          }
          this.flushPending();
        });
      };

      if (this.canRun(serverId, serverLimit)) {
        runTask();
        return;
      }

      this.pendingTasks.push({
        serverId,
        serverLimit,
        run: runTask,
      });
    });
  }

  private canRun(serverId: string, serverLimit: number): boolean {
    return (
      this.activeGlobalCount < this.options.globalConcurrency &&
      (this.activeByServer.get(serverId) ?? 0) < serverLimit
    );
  }

  private flushPending(): void {
    for (let index = 0; index < this.pendingTasks.length; index += 1) {
      const pendingTask = this.pendingTasks[index];
      if (!pendingTask || !this.canRun(pendingTask.serverId, pendingTask.serverLimit)) {
        continue;
      }

      this.pendingTasks.splice(index, 1);
      pendingTask.run();
      index -= 1;
    }
  }
}
