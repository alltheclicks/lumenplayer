#!/usr/bin/env python3
# GC + concurrency-cap patch for timeshift_shadow.php (v9 inline).
# ADD-only: inserts 3 constants, 2 helper functions, 1 GC call, 1 concurrency
# guard. Reuses the existing v9 shadowRemoveTree(). Token line is NEVER touched.
# Idempotent: refuses to patch if markers already present.
import sys

PATH = sys.argv[1]
with open(PATH, "r") as f:
    src = f.read()

if "SHADOW_MAX_CONCURRENT_BUILDS" in src:
    print("ALREADY_PATCHED")
    sys.exit(0)

# --- 1) constants after SHADOW_BUILD_VERSION define ---
anchor_const = "define('SHADOW_BUILD_VERSION', 'v9');"
if anchor_const not in src:
    print("ERR: const anchor not found"); sys.exit(2)
const_block = anchor_const + """

// HARDENING (ADD-only, GC patch): protect /tmp + CPU under beta load.
// Concurrency cap applies ONLY to new transcode builds (cache hits unaffected).
define('SHADOW_MAX_CONCURRENT_BUILDS', 4);
define('SHADOW_CACHE_GC_MAX_AGE', 7200);    // seconds; stale build dirs removed
define('SHADOW_CACHE_GC_PROBABILITY', 25);  // run GC on ~1/25 of requests"""
src = src.replace(anchor_const, const_block, 1)

# --- 2) helper functions after shadowLog() ---
anchor_log = """function shadowLog($message)
{
    file_put_contents('/tmp/catchup_shadow.log', date('Y-m-d H:i:s') . ' ' . $message . "\\n", FILE_APPEND);
}"""
if anchor_log not in src:
    print("ERR: shadowLog anchor not found"); sys.exit(3)
helpers = anchor_log + """

// HARDENING helpers (ADD-only). Reuse existing v9 shadowRemoveTree().
function shadowActiveBuildCount()
{
    $count = 0;
    $locks = @glob(SHADOW_CACHE_ROOT . '*/remux.lock');
    if (!is_array($locks)) { return 0; }
    $now = time();
    foreach ($locks as $lock) {
        $mtime = @filemtime($lock);
        if ($mtime !== false && ($now - $mtime) < 300) { $count++; }
    }
    return $count;
}

function shadowMaybeGarbageCollect()
{
    if (SHADOW_CACHE_GC_PROBABILITY < 1) { return; }
    if (((getmypid() + (int) date('s')) % SHADOW_CACHE_GC_PROBABILITY) !== 0) { return; }
    $dirs = @glob(SHADOW_CACHE_ROOT . '*', GLOB_ONLYDIR);
    if (!is_array($dirs)) { return; }
    $now = time();
    $removed = 0;
    foreach ($dirs as $dir) {
        $lock = $dir . '/remux.lock';
        if (file_exists($lock) && ($now - (int) @filemtime($lock)) < 300) { continue; }
        $mtime = @filemtime($dir);
        if ($mtime !== false && ($now - $mtime) > SHADOW_CACHE_GC_MAX_AGE) {
            shadowRemoveTree($dir);
            $removed++;
        }
    }
    if ($removed > 0) { shadowLog('cache gc removed=' . $removed); }
}"""
src = src.replace(anchor_log, helpers, 1)

# --- 3) GC call at start of shadowEnsurePlayableHls ---
anchor_fn = """function shadowEnsurePlayableHls($requestedSource, $streamId, $startTimestamp, $duration)
{
    $sources = array($requestedSource);"""
if anchor_fn not in src:
    print("ERR: ensure-playable anchor not found"); sys.exit(4)
fn_block = """function shadowEnsurePlayableHls($requestedSource, $streamId, $startTimestamp, $duration)
{
    shadowMaybeGarbageCollect(); // HARDENING: sampled /tmp cache GC

    $sources = array($requestedSource);"""
src = src.replace(anchor_fn, fn_block, 1)

# --- 4) concurrency cap before creating a NEW build lock ---
anchor_lock = """            } else {
                file_put_contents($lockFile, getmypid());

                $probe = shadowProbeMedia($archiveFiles[0]);"""
if anchor_lock not in src:
    print("ERR: lock anchor not found"); sys.exit(5)
lock_block = """            } else {
                // HARDENING: cap NEW transcode builds (cache hits/lock-waits unaffected).
                if (shadowActiveBuildCount() >= SHADOW_MAX_CONCURRENT_BUILDS) {
                    shadowLog('build deferred (concurrency cap) stream=' . $streamId . ' start=' . $startTimestamp . ' active=' . shadowActiveBuildCount() . ' cap=' . SHADOW_MAX_CONCURRENT_BUILDS);
                    header('HTTP/1.1 503 Service Unavailable');
                    header('Retry-After: 5');
                    die;
                }

                file_put_contents($lockFile, getmypid());

                $probe = shadowProbeMedia($archiveFiles[0]);"""
src = src.replace(anchor_lock, lock_block, 1)

with open(PATH, "w") as f:
    f.write(src)
print("PATCHED_OK")
