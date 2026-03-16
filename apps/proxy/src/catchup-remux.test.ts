import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createCatchUpRemuxController,
  selectCatchUpRemuxCandidate,
} from "./catchup-remux.js";

const logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
};

const createTempRootDir = (label: string): string => (
  path.join(process.cwd(), ".tmp-remux-tests", `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
);

const extractSessionId = (manifestBody: string): string => {
  const match = manifestBody.match(/\/session\/([^/]+)\//);
  if (!match?.[1]) {
    throw new Error("Missing remux session id in manifest.");
  }

  return match[1];
};

const createCompletedSpawn = () => {
  const calls: Array<{
    profile: "copy" | "transcode";
    upstreamUrl: string;
    playlistPath: string;
    segmentDir: string;
    kill: ReturnType<typeof vi.fn>;
  }> = [];

  return {
    calls,
    spawnProcess: ({
      profile,
      upstreamUrl,
      playlistPath,
      segmentDir,
    }: {
      profile: "copy" | "transcode";
      upstreamUrl: string;
      playlistPath: string;
      segmentDir: string;
    }) => {
      const kill = vi.fn();
      calls.push({
        profile,
        upstreamUrl,
        playlistPath,
        segmentDir,
        kill,
      });

      const completion = (async () => {
        await mkdir(segmentDir, {
          recursive: true,
        });
        await writeFile(path.join(path.dirname(playlistPath), "init.mp4"), "init-body");
        await writeFile(path.join(segmentDir, "00000.m4s"), "segment-zero");
        await writeFile(path.join(segmentDir, "00001.m4s"), "segment-one");
        await writeFile(path.join(segmentDir, "00002.m4s"), "segment-two");
        await writeFile(playlistPath, [
          "#EXTM3U",
          "#EXT-X-VERSION:7",
          "#EXT-X-PLAYLIST-TYPE:EVENT",
          "#EXT-X-MAP:URI=\"init.mp4\"",
          "#EXTINF:6.000,",
          "segment/00000.m4s",
          "#EXTINF:6.000,",
          "segment/00001.m4s",
          "#EXT-X-ENDLIST",
        ].join("\n"));

        return {
          code: 0,
          signal: null,
          stderrMessage: null,
        } as const;
      })();

      return {
        handle: {
          kill,
          pid: 1000 + calls.length,
        },
        completion,
      };
    },
  };
};

const createLongRunningSpawn = () => {
  const calls: Array<{
    profile: "copy" | "transcode";
    upstreamUrl: string;
    playlistPath: string;
    segmentDir: string;
    kill: ReturnType<typeof vi.fn>;
  }> = [];

  return {
    calls,
    spawnProcess: ({
      profile,
      upstreamUrl,
      playlistPath,
      segmentDir,
    }: {
      profile: "copy" | "transcode";
      upstreamUrl: string;
      playlistPath: string;
      segmentDir: string;
    }) => {
      const kill = vi.fn();
      calls.push({
        profile,
        upstreamUrl,
        playlistPath,
        segmentDir,
        kill,
      });

      let resolveCompletion: ((value: {
        code: number | null;
        signal: NodeJS.Signals | null;
        stderrMessage: string | null;
      }) => void) | null = null;
      const completion = new Promise<{
        code: number | null;
        signal: NodeJS.Signals | null;
        stderrMessage: string | null;
      }>((resolve) => {
        resolveCompletion = resolve;
      });

      mkdirSync(segmentDir, {
        recursive: true,
      });
      writeFileSync(path.join(path.dirname(playlistPath), "init.mp4"), "init-body");
      writeFileSync(path.join(segmentDir, "00000.m4s"), "segment-zero");
      writeFileSync(playlistPath, [
        "#EXTM3U",
        "#EXT-X-PLAYLIST-TYPE:EVENT",
        "#EXT-X-MAP:URI=\"init.mp4\"",
        "#EXTINF:6.000,",
        "segment/00000.m4s",
      ].join("\n"));

      kill.mockImplementation(() => {
        resolveCompletion?.({
          code: null,
          signal: "SIGKILL",
          stderrMessage: "killed",
        });
      });

      return {
        handle: {
          kill,
          pid: 2000 + calls.length,
        },
        completion,
      };
    },
  };
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("catch-up remux candidate selection", () => {
  it("prefers the raw redirect .ts candidate over query .m3u8", () => {
    expect(selectCatchUpRemuxCandidate({
      redirectUrls: [
        "https://login.example/timeshift/user/pass/1800/2026-03-08:08-30/112.m3u8",
        "https://login.example/timeshift/user/pass/1800/2026-03-08:08-30/112.ts",
      ],
      queryUrls: [
        "https://login.example/streaming/timeshift.php?stream=112&start=1772000000&duration=1800&extension=m3u8",
      ],
      legacyUrls: [],
    })).toBe("https://login.example/timeshift/user/pass/1800/2026-03-08:08-30/112.ts");
  });
});

describe("catch-up remux controller", () => {
  it("matches only enabled stream, program, and host filters", () => {
    const controller = createCatchUpRemuxController({
      logger,
      env: {
        LUMEN_PROXY_REMUX_ENABLED: "1",
        LUMEN_PROXY_REMUX_STREAM_IDS: "112",
        LUMEN_PROXY_REMUX_PROGRAM_IDS: "program-1",
        LUMEN_PROXY_REMUX_HOSTS: "login.example",
      },
      checkBinary: () => true,
      spawnProcess: createCompletedSpawn().spawnProcess,
      tempRootDir: createTempRootDir("feature-gate"),
    });

    expect(controller.matchesFeatureGate({
      request: {
        platform: "web",
        channelId: "channel-1",
        programId: "program-1",
        streamId: 112,
        startTimestamp: 1_772_000_000,
        durationSeconds: 1_800,
        sourceCandidates: {
          redirectUrls: [],
          queryUrls: [],
          legacyUrls: [],
        },
      },
      candidateUrl: "https://login.example/timeshift/user/pass/1800/2026-03-08:08-30/112.ts",
    })).toBe(true);

    expect(controller.matchesFeatureGate({
      request: {
        platform: "web",
        channelId: "channel-1",
        programId: "program-2",
        streamId: 112,
        startTimestamp: 1_772_000_000,
        durationSeconds: 1_800,
        sourceCandidates: {
          redirectUrls: [],
          queryUrls: [],
          legacyUrls: [],
        },
      },
      candidateUrl: "https://login.example/timeshift/user/pass/1800/2026-03-08:08-30/112.ts",
    })).toBe(false);
  });

  it("reuses remux sessions by sanitized request key", async () => {
    const spawn = createCompletedSpawn();
    const controller = createCatchUpRemuxController({
      logger,
      env: {
        LUMEN_PROXY_REMUX_ENABLED: "1",
      },
      checkBinary: () => true,
      spawnProcess: spawn.spawnProcess,
      tempRootDir: createTempRootDir("reuse"),
    });

    const first = await controller.getManifest({
      upstreamUrl: new URL(
        "https://login.example/timeshift/user/pass/1800/2026-03-08:08-30/112.ts?__lumenTransport=remux-hls&__lumenProgramId=program-1&__lumenFallbackReason=first",
      ),
      serverKey: "server-1",
      perServerConcurrency: 1,
    });
    const second = await controller.getManifest({
      upstreamUrl: new URL(
        "https://login.example/timeshift/user/pass/1800/2026-03-08:08-30/112.ts?__lumenTransport=remux-hls&__lumenProgramId=program-1&__lumenFallbackReason=second",
      ),
      serverKey: "server-1",
      perServerConcurrency: 1,
    });

    expect(spawn.calls).toHaveLength(1);
    expect(extractSessionId(first.body)).toBe(extractSessionId(second.body));
  });

  it("falls back from copy bootstrap to transcode when strategy is copy-then-transcode", async () => {
    const calls: Array<{
      profile: "copy" | "transcode";
      upstreamUrl: string;
      playlistPath: string;
      segmentDir: string;
    }> = [];
    const controller = createCatchUpRemuxController({
      logger,
      env: {
        LUMEN_PROXY_REMUX_ENABLED: "1",
        LUMEN_PROXY_REMUX_STRATEGY: "copy-then-transcode",
      },
      checkBinary: () => true,
      tempRootDir: createTempRootDir("copy-fallback"),
      spawnProcess: ({
        profile,
        upstreamUrl,
        playlistPath,
        segmentDir,
      }: {
        profile: "copy" | "transcode";
        upstreamUrl: string;
        playlistPath: string;
        segmentDir: string;
      }) => {
        const kill = vi.fn();
        calls.push({
          profile,
          upstreamUrl,
          playlistPath,
          segmentDir,
        });

        if (profile === "copy") {
          return {
            handle: {
              kill,
              pid: 3001,
            },
            completion: Promise.resolve({
              code: 1,
              signal: null,
              stderrMessage: "copy bootstrap failed",
            }),
          };
        }

        const completion = (async () => {
          await mkdir(segmentDir, {
            recursive: true,
          });
          await writeFile(path.join(path.dirname(playlistPath), "init.mp4"), "init-body");
          await writeFile(path.join(segmentDir, "00000.m4s"), "segment-zero");
          await writeFile(playlistPath, [
            "#EXTM3U",
            "#EXT-X-VERSION:7",
            "#EXT-X-PLAYLIST-TYPE:EVENT",
            "#EXT-X-MAP:URI=\"init.mp4\"",
            "#EXTINF:6.000,",
            "segment/00000.m4s",
            "#EXT-X-ENDLIST",
          ].join("\n"));

          return {
            code: 0,
            signal: null,
            stderrMessage: null,
          } as const;
        })();

        return {
          handle: {
            kill,
            pid: 3002,
          },
          completion,
        };
      },
    });

    const manifest = await controller.getManifest({
      upstreamUrl: new URL(
        "https://login.example/timeshift/user/pass/1800/2026-03-08:08-30/112.ts?__lumenTransport=remux-hls",
      ),
      serverKey: "server-1",
      perServerConcurrency: 1,
    });

    expect(calls.map((call) => call.profile)).toEqual(["copy", "transcode"]);
    expect(manifest.body).toContain("/xui-api/__remux__/session/");
  });

  it("falls back to transcode when copy emits initial assets but fails before bootstrap is stable", async () => {
    const calls: Array<{
      profile: "copy" | "transcode";
      upstreamUrl: string;
      playlistPath: string;
      segmentDir: string;
    }> = [];
    const controller = createCatchUpRemuxController({
      logger,
      env: {
        LUMEN_PROXY_REMUX_ENABLED: "1",
        LUMEN_PROXY_REMUX_STRATEGY: "copy-then-transcode",
      },
      checkBinary: () => true,
      tempRootDir: createTempRootDir("copy-race-fallback"),
      spawnProcess: ({
        profile,
        upstreamUrl,
        playlistPath,
        segmentDir,
      }: {
        profile: "copy" | "transcode";
        upstreamUrl: string;
        playlistPath: string;
        segmentDir: string;
      }) => {
        const kill = vi.fn();
        calls.push({
          profile,
          upstreamUrl,
          playlistPath,
          segmentDir,
        });

        if (profile === "copy") {
          const completion = (async () => {
            await mkdir(segmentDir, {
              recursive: true,
            });
            await writeFile(path.join(path.dirname(playlistPath), "init.mp4"), "init-body");
            await writeFile(path.join(segmentDir, "00000.m4s"), "segment-zero");
            await writeFile(playlistPath, [
              "#EXTM3U",
              "#EXT-X-VERSION:7",
              "#EXT-X-PLAYLIST-TYPE:EVENT",
              "#EXT-X-MAP:URI=\"init.mp4\"",
              "#EXTINF:0.000,",
              "segment/00000.m4s",
              "#EXT-X-ENDLIST",
            ].join("\n"));

            return {
              code: 1,
              signal: null,
              stderrMessage: "copy emitted invalid bootstrap output",
            } as const;
          })();

          return {
            handle: {
              kill,
              pid: 3003,
            },
            completion,
          };
        }

        const completion = (async () => {
          await mkdir(segmentDir, {
            recursive: true,
          });
          await writeFile(path.join(path.dirname(playlistPath), "init.mp4"), "init-body");
          await writeFile(path.join(segmentDir, "00000.m4s"), "segment-zero");
          await writeFile(playlistPath, [
            "#EXTM3U",
            "#EXT-X-VERSION:7",
            "#EXT-X-PLAYLIST-TYPE:EVENT",
            "#EXT-X-MAP:URI=\"init.mp4\"",
            "#EXTINF:6.000,",
            "segment/00000.m4s",
            "#EXT-X-ENDLIST",
          ].join("\n"));

          return {
            code: 0,
            signal: null,
            stderrMessage: null,
          } as const;
        })();

        return {
          handle: {
            kill,
            pid: 3004,
          },
          completion,
        };
      },
    });

    const manifest = await controller.getManifest({
      upstreamUrl: new URL(
        "https://login.example/timeshift/user/pass/1800/2026-03-08:08-30/112.ts?__lumenTransport=remux-hls",
      ),
      serverKey: "server-1",
      perServerConcurrency: 1,
    });

    expect(calls.map((call) => call.profile)).toEqual(["copy", "transcode"]);
    expect(manifest.body).toContain("#EXTINF:6.000");
  });

  it("serves rewritten manifest, init, and segment assets", async () => {
    const spawn = createCompletedSpawn();
    const controller = createCatchUpRemuxController({
      logger,
      env: {
        LUMEN_PROXY_REMUX_ENABLED: "1",
      },
      checkBinary: () => true,
      spawnProcess: spawn.spawnProcess,
      tempRootDir: createTempRootDir("assets"),
    });

    const manifest = await controller.getManifest({
      upstreamUrl: new URL(
        "https://login.example/timeshift/user/pass/1800/2026-03-08:08-30/112.ts?__lumenTransport=remux-hls",
      ),
      serverKey: "server-1",
      perServerConcurrency: 1,
    });

    expect(manifest.body).toContain("#EXT-X-MAP:URI=\"/xui-api/__remux__/session/");
    expect(manifest.body).toContain("/segment/0.m4s");

    const initAsset = controller.parseAssetRequest(
      new URL(`http://localhost/xui-api/__remux__/session/${manifest.sessionId}/init.mp4`),
    );
    const segmentAsset = controller.parseAssetRequest(
      new URL(`http://localhost/xui-api/__remux__/session/${manifest.sessionId}/segment/0.m4s`),
    );

    expect(initAsset).toEqual({
      sessionId: manifest.sessionId,
      kind: "init",
      segmentIndex: null,
    });
    expect(segmentAsset).toEqual({
      sessionId: manifest.sessionId,
      kind: "segment",
      segmentIndex: 0,
    });

    expect((await controller.getAsset(initAsset ?? { sessionId: "", kind: "init", segmentIndex: null })).toString()).toBe("init-body");
    expect((await controller.getAsset(segmentAsset ?? { sessionId: "", kind: "segment", segmentIndex: 0 })).toString()).toBe("segment-zero");
  });

  it("rejects new remux sessions when active capacity is exhausted and queue wait timeout elapses", async () => {
    const spawn = createLongRunningSpawn();
    const controller = createCatchUpRemuxController({
      logger,
      env: {
        LUMEN_PROXY_REMUX_ENABLED: "1",
        LUMEN_PROXY_REMUX_GLOBAL_CONCURRENCY: "1",
        LUMEN_PROXY_REMUX_QUEUE_WAIT_TIMEOUT_MS: "10",
      },
      checkBinary: () => true,
      spawnProcess: spawn.spawnProcess,
      tempRootDir: createTempRootDir("capacity"),
    });

    const first = await controller.prepareSession({
      upstreamUrl: new URL(
        "https://login.example/timeshift/user/pass/1800/2026-03-08:08-30/112.ts?__lumenTransport=remux-hls",
      ),
      serverKey: "server-1",
      perServerConcurrency: 2,
    });

    await expect(controller.prepareSession({
      upstreamUrl: new URL(
        "https://login.example/timeshift/user/pass/1800/2026-03-08:09-00/113.ts?__lumenTransport=remux-hls",
      ),
      serverKey: "server-2",
      perServerConcurrency: 2,
    })).rejects.toThrow("queue timed out");

    expect(spawn.calls).toHaveLength(1);
    first.processHandle?.kill("SIGKILL");
    await controller.close();
  });

  it("kills stale sessions and removes temp dirs on sweep", async () => {
    let nowMs = 1_000;
    const spawn = createLongRunningSpawn();
    const controller = createCatchUpRemuxController({
      logger,
      env: {
        LUMEN_PROXY_REMUX_ENABLED: "1",
        LUMEN_PROXY_REMUX_SESSION_TTL_MS: "10",
      },
      now: () => nowMs,
      checkBinary: () => true,
      spawnProcess: spawn.spawnProcess,
      tempRootDir: createTempRootDir("sweep"),
    });

    const session = await controller.prepareSession({
      upstreamUrl: new URL(
        "https://login.example/timeshift/user/pass/1800/2026-03-08:08-30/112.ts?__lumenTransport=remux-hls",
      ),
      serverKey: "server-1",
      perServerConcurrency: 1,
    });

    expect(existsSync(session.tempDir)).toBe(true);
    expect(session.processHandle).not.toBeNull();
    const killSpy = vi.spyOn(session.processHandle as { kill: (signal?: NodeJS.Signals | number) => void }, "kill");
    nowMs += 2_000;
    controller.sweep();

    expect(killSpy).toHaveBeenCalledTimes(1);
    expect(existsSync(session.tempDir)).toBe(false);
  });
});
