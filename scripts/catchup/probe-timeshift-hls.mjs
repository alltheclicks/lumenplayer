#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const DEFAULT_REDIRECT_LIMIT = 5;
const DEFAULT_CHECKPOINTS_SECONDS = [0, 60, 120];
const DEFAULT_DECODE_SEGMENT_FRAMES = 180;
const DEFAULT_PLAYLIST_DECODE_SECONDS = 150;

const usage = () => {
  console.error(
    [
      "Usage: node scripts/catchup/probe-timeshift-hls.mjs --url <timeshift-url> [options]",
      "",
      "Options:",
      "  --output <file>                 Write JSON artifact to file.",
      "  --checkpoint-seconds <list>     Comma-separated checkpoint seconds (default: 0,60,120).",
      "  --segment-frames <n>            Frames to decode per sampled segment (default: 180).",
      "  --playlist-seconds <n>          Seconds to decode from final manifest (default: 150).",
      "  --redirect-limit <n>            Max redirects to follow manually (default: 5).",
      "  --ffmpeg-bin <path>             ffmpeg binary name/path (default: ffmpeg).",
      "  --ffprobe-bin <path>            ffprobe binary name/path (default: ffprobe).",
      "  --help                          Show this message.",
    ].join("\n"),
  );
};

const fail = (message, exitCode = 1) => {
  console.error(`[timeshift-hls-probe] ERROR: ${message}`);
  process.exit(exitCode);
};

const parseIntegerFlag = (value, fallback) => {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};

const parseArgs = (argv) => {
  const args = {
    url: "",
    output: "",
    redirectLimit: DEFAULT_REDIRECT_LIMIT,
    checkpointSeconds: [...DEFAULT_CHECKPOINTS_SECONDS],
    segmentFrames: DEFAULT_DECODE_SEGMENT_FRAMES,
    playlistSeconds: DEFAULT_PLAYLIST_DECODE_SECONDS,
    ffmpegBin: "ffmpeg",
    ffprobeBin: "ffprobe",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const entry = argv[index];
    switch (entry) {
      case "--url":
        args.url = argv[index + 1] ?? "";
        index += 1;
        break;
      case "--output":
        args.output = argv[index + 1] ?? "";
        index += 1;
        break;
      case "--checkpoint-seconds":
        args.checkpointSeconds = (argv[index + 1] ?? "")
          .split(",")
          .map((part) => Number.parseInt(part.trim(), 10))
          .filter((value) => Number.isFinite(value) && value >= 0);
        index += 1;
        break;
      case "--segment-frames":
        args.segmentFrames = parseIntegerFlag(argv[index + 1], DEFAULT_DECODE_SEGMENT_FRAMES);
        index += 1;
        break;
      case "--playlist-seconds":
        args.playlistSeconds = parseIntegerFlag(argv[index + 1], DEFAULT_PLAYLIST_DECODE_SECONDS);
        index += 1;
        break;
      case "--redirect-limit":
        args.redirectLimit = parseIntegerFlag(argv[index + 1], DEFAULT_REDIRECT_LIMIT);
        index += 1;
        break;
      case "--ffmpeg-bin":
        args.ffmpegBin = argv[index + 1] ?? "ffmpeg";
        index += 1;
        break;
      case "--ffprobe-bin":
        args.ffprobeBin = argv[index + 1] ?? "ffprobe";
        index += 1;
        break;
      case "--help":
        usage();
        process.exit(0);
      default:
        fail(`Unknown argument: ${entry}`);
    }
  }

  if (!args.url) {
    usage();
    fail("Missing required --url argument.");
  }

  if (args.checkpointSeconds.length === 0) {
    args.checkpointSeconds = [...DEFAULT_CHECKPOINTS_SECONDS];
  }

  return args;
};

const truncateText = (value, limit = 1200) => {
  if (!value) {
    return "";
  }

  return value.length <= limit ? value : `${value.slice(0, limit)}...`;
};

const parseManifest = (manifestBody, manifestUrl) => {
  const lines = manifestBody.split(/\r?\n/);
  const segments = [];
  let pendingDuration = null;
  let elapsedSeconds = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    if (trimmed.startsWith("#EXTINF:")) {
      const durationText = trimmed.slice("#EXTINF:".length).split(",")[0] ?? "";
      const parsedDuration = Number.parseFloat(durationText.trim());
      pendingDuration = Number.isFinite(parsedDuration) && parsedDuration >= 0 ? parsedDuration : null;
      continue;
    }

    if (trimmed.startsWith("#")) {
      continue;
    }

    const resolvedUrl = new URL(trimmed, manifestUrl).toString();
    const durationSeconds = pendingDuration ?? 0;
    const startSeconds = elapsedSeconds;
    elapsedSeconds += durationSeconds;
    segments.push({
      index: segments.length,
      durationSeconds,
      startSeconds,
      elapsedEndSeconds: elapsedSeconds,
      rawLine: trimmed,
      url: resolvedUrl,
    });
    pendingDuration = null;
  }

  return {
    lines,
    segments,
    totalDurationSeconds: elapsedSeconds,
  };
};

const pickSampleSegments = (segments, checkpointsSeconds) => {
  if (segments.length === 0) {
    return [];
  }

  const selected = new Map();
  for (const checkpoint of checkpointsSeconds) {
    const candidate = segments.find((segment) => (
      checkpoint <= segment.startSeconds || checkpoint < segment.elapsedEndSeconds
    )) ?? segments[segments.length - 1];
    if (candidate) {
      selected.set(candidate.index, {
        checkpointSeconds: checkpoint,
        segment: candidate,
      });
    }
  }

  const lastSegment = segments[segments.length - 1];
  selected.set(lastSegment.index, {
    checkpointSeconds: Math.floor(lastSegment.startSeconds),
    segment: lastSegment,
  });

  return [...selected.values()].sort((left, right) => left.segment.index - right.segment.index);
};

const summarizeRedirectStep = (url, response, redirectedTo) => ({
  url,
  status: response.status,
  location: response.headers.get("location"),
  redirectedTo,
});

const resolveRedirectChain = async (initialUrl, redirectLimit) => {
  const chain = [];
  let currentUrl = initialUrl;

  for (let step = 0; step <= redirectLimit; step += 1) {
    const response = await fetch(currentUrl, { redirect: "manual" });
    const location = response.headers.get("location");
    const isRedirect = response.status >= 300 && response.status < 400 && !!location;
    const redirectedTo = isRedirect ? new URL(location, currentUrl).toString() : null;
    chain.push(summarizeRedirectStep(currentUrl, response, redirectedTo));

    if (!isRedirect) {
      return {
        finalUrl: currentUrl,
        response,
        chain,
      };
    }

    currentUrl = redirectedTo;
  }

  fail(`Redirect chain exceeded limit (${redirectLimit}).`);
};

const runProcess = (command, args) => {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });

  return {
    command,
    args,
    status: result.status,
    signal: result.signal,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error ? String(result.error.message || result.error) : null,
  };
};

const runFfprobe = (ffprobeBin, targetUrl) => {
  const result = runProcess(ffprobeBin, [
    "-v",
    "error",
    "-show_streams",
    "-show_format",
    "-of",
    "json",
    targetUrl,
  ]);

  let parsed = null;
  if (result.status === 0 && result.stdout.trim()) {
    try {
      parsed = JSON.parse(result.stdout);
    } catch {
      parsed = null;
    }
  }

  return {
    ok: result.status === 0,
    status: result.status,
    signal: result.signal,
    error: result.error,
    stderr: truncateText(result.stderr),
    streams: parsed?.streams ?? null,
    format: parsed?.format ?? null,
  };
};

const runFfmpegDecodeProbe = (ffmpegBin, targetUrl, frames) => {
  const result = runProcess(ffmpegBin, [
    "-v",
    "error",
    "-i",
    targetUrl,
    "-frames:v",
    String(Math.max(1, frames)),
    "-f",
    "null",
    "-",
  ]);

  return {
    ok: result.status === 0,
    status: result.status,
    signal: result.signal,
    error: result.error,
    stderr: truncateText(result.stderr),
  };
};

const runPlaylistDecodeProbe = (ffmpegBin, manifestUrl, seconds) => {
  const result = runProcess(ffmpegBin, [
    "-v",
    "error",
    "-i",
    manifestUrl,
    "-t",
    String(Math.max(1, seconds)),
    "-f",
    "null",
    "-",
  ]);

  return {
    ok: result.status === 0,
    status: result.status,
    signal: result.signal,
    error: result.error,
    stderr: truncateText(result.stderr, 1600),
  };
};

const buildConsoleSummary = (artifact) => {
  const lines = [];
  lines.push(`[timeshift-hls-probe] initial URL: ${artifact.initialUrl}`);
  lines.push(`[timeshift-hls-probe] final URL: ${artifact.finalManifestUrl}`);
  lines.push(`[timeshift-hls-probe] redirects: ${artifact.redirectChain.length - 1}`);
  lines.push(
    `[timeshift-hls-probe] manifest: ${artifact.manifest.segmentCount} segments, ${artifact.manifest.totalDurationSeconds.toFixed(3)}s total`,
  );
  lines.push(
    `[timeshift-hls-probe] playlist decode: ${artifact.playlistDecode.ok ? "ok" : "failed"}`
      + (artifact.playlistDecode.stderr ? ` (${artifact.playlistDecode.stderr.split("\n")[0]})` : ""),
  );

  for (const sample of artifact.samples) {
    lines.push(
      `[timeshift-hls-probe] segment #${sample.index} @~${sample.checkpointSeconds}s: `
        + `ffprobe=${sample.ffprobe.ok ? "ok" : "failed"}, `
        + `ffmpeg=${sample.ffmpegDecode.ok ? "ok" : "failed"}`,
    );
  }

  return lines.join("\n");
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  const initialUrl = new URL(args.url).toString();
  const redirectResult = await resolveRedirectChain(initialUrl, args.redirectLimit);

  if (!redirectResult.response.ok) {
    fail(`Final response returned ${redirectResult.response.status} for ${redirectResult.finalUrl}.`);
  }

  const manifestBody = await redirectResult.response.text();
  const manifest = parseManifest(manifestBody, redirectResult.finalUrl);
  if (manifest.segments.length === 0) {
    fail("Final manifest did not contain any media segments.");
  }

  const samples = pickSampleSegments(manifest.segments, args.checkpointSeconds)
    .map(({ checkpointSeconds, segment }) => ({
      checkpointSeconds,
      index: segment.index,
      startSeconds: segment.startSeconds,
      durationSeconds: segment.durationSeconds,
      url: segment.url,
      ffprobe: runFfprobe(args.ffprobeBin, segment.url),
      ffmpegDecode: runFfmpegDecodeProbe(args.ffmpegBin, segment.url, args.segmentFrames),
    }));

  const playlistDecode = runPlaylistDecodeProbe(
    args.ffmpegBin,
    redirectResult.finalUrl,
    args.playlistSeconds,
  );

  const artifact = {
    generatedAt: new Date().toISOString(),
    initialUrl,
    finalManifestUrl: redirectResult.finalUrl,
    redirectChain: redirectResult.chain,
    manifest: {
      segmentCount: manifest.segments.length,
      totalDurationSeconds: manifest.totalDurationSeconds,
      sampleRawLines: manifest.segments.slice(0, 3).map((segment) => segment.rawLine),
    },
    samples,
    playlistDecode,
  };

  if (args.output) {
    const outputPath = path.resolve(process.cwd(), args.output);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(artifact, null, 2));
    console.error(`[timeshift-hls-probe] wrote artifact: ${outputPath}`);
  }

  console.log(buildConsoleSummary(artifact));
};

const isDirectCliEntry = () => {
  if (!process.argv[1]) {
    return false;
  }

  try {
    return new URL(`file://${path.resolve(process.argv[1])}`).href === import.meta.url;
  } catch {
    return false;
  }
};

if (isDirectCliEntry()) {
  main().catch((error) => {
    fail(error instanceof Error ? error.message : String(error), 2);
  });
}

export {
  main,
  parseManifest,
  pickSampleSegments,
};
