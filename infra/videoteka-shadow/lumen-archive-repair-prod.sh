#!/bin/bash
# lumen-archive-repair-prod.sh — FORWARD-ONLY catch-up dead-zone repair (production).
#
# XUI's ionCube archive writer cuts the live stream on wall-clock minute
# boundaries that land mid-GOP (2s GOP), so each tv_archive/<id>/*.ts minute
# file starts header-less -> browser HLS.js stutters. This re-muxes each freshly
# CLOSED minute file with dump_extra so SPS/PPS sit at every keyframe head.
# Pure -c copy: no transcode, no A/V risk.
#
# PRODUCTION posture (ns3239635: 103 channels, 24TB, 7-day retention, 16 CPU):
#  - FORWARD-ONLY: repairs only minutes closed in the last MAX_AGE_S seconds.
#    No backfill — the 7-day window self-heals as old files expire and new ones
#    are born clean. The whole archive is current within 7 days, zero bulk load.
#  - LOAD GUARD: bails out if 1-min load average exceeds LOAD_CEIL, so a busy
#    recording server is never starved by repairs.
#  - LOW PRIORITY: ffmpeg runs under nice+ionice so the 101 live segmenters and
#    serving always win the CPU/IO.
#  - SELF-VALIDATING + ATOMIC: repair to temp, verify 0 decode errors, atomic mv
#    over the original (in-flight fopen reads finish on the old inode). Idempotent
#    via a .lumen_fixed marker. Never touches live/, never transcodes, never deletes.
#  - MARKER GC: removes orphan .lumen_fixed sidecars whose .ts has expired.
set -u

# Pin /usr/local/bin/ffmpeg (matches the toolchain proven on .107); fall back to
# the XUI 2018 build only if absent. Both carry the dump_extra bsf.
FF="${FF:-/usr/local/bin/ffmpeg}"
[ -x "$FF" ] || FF="/home/xtreamcodes/iptv_xtream_codes/bin/ffmpeg"
ARCHIVE_ROOT="${ARCHIVE_ROOT:-/home/xtreamcodes/iptv_xtream_codes/tv_archive}"
MIN_AGE_S="${MIN_AGE_S:-120}"          # don't touch a minute younger than this (writer may hold it)
MAX_AGE_S="${MAX_AGE_S:-179}"          # forward-only window ~1 min wide -> ~1 file/channel/tick
LOAD_CEIL="${LOAD_CEIL:-10}"           # bail if 1-min load average exceeds this (16-core box)
MARKER=".lumen_fixed"
DRYRUN="${DRYRUN:-0}"
LIMIT="${LIMIT:-0}"
PARALLEL="${PARALLEL:-3}"              # concurrent repairs (bounded; 16-core box, live wins)

# Low-priority wrappers so live recording always wins (degrade gracefully if absent).
NICE="$(command -v nice || true)"; [ -n "$NICE" ] && NICE="$NICE -n 19"
IONICE="$(command -v ionice || true)"; [ -n "$IONICE" ] && IONICE="$IONICE -c2 -n7"
LOWPRIO="$NICE $IONICE"

# Repair one file (called per-file by xargs for bounded parallelism). Self-contained
# so it can run in a subshell: repair to temp, validate 0 errors on the first second,
# preserve owner/perms, atomic mv, drop marker. On any failure keep the original.
repair_one() {
  local f="$1" tmp after
  [ -f "$f" ] || return 0
  [ -f "${f}${MARKER}" ] && return 0
  tmp="${f}.lumenfix.$$"
  $LOWPRIO "$FF" -hide_banner -v error -y -i "$f" -c copy \
    -bsf:v dump_extra=freq=k -mpegts_flags +resend_headers \
    -f mpegts "$tmp" 2>/dev/null
  if [ ! -s "$tmp" ]; then rm -f "$tmp"; echo "FAIL empty $f"; return 0; fi
  after=$($LOWPRIO "$FF" -hide_banner -v error -i "$tmp" -t 1 -f null - 2>&1 | grep -ciE "non-existing PPS|no frame")
  if [ "$after" -ne 0 ]; then rm -f "$tmp"; echo "FAIL after=$after $f"; return 0; fi
  chown --reference="$f" "$tmp" 2>/dev/null
  chmod --reference="$f" "$tmp" 2>/dev/null
  mv -f "$tmp" "$f"
  : > "${f}${MARKER}"
  echo "OK $f"
}
export -f repair_one
export FF LOWPRIO MARKER

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

# Preflight: the whole fix hinges on dump_extra being present. A build without it
# would silently produce a copy that passes nothing — abort loudly instead.
if ! "$FF" -hide_banner -bsfs 2>/dev/null | grep -q '^dump_extra$'; then
  log "ABORT: $FF lacks the dump_extra bitstream filter"
  exit 1
fi

# Load guard: never pile repairs onto an already-busy recording server.
load1=$(awk '{print $1}' /proc/loadavg 2>/dev/null || echo 0)
if awk "BEGIN{exit !($load1 > $LOAD_CEIL)}"; then
  log "SKIP run: load $load1 > ceil $LOAD_CEIL"
  exit 0
fi

now=$(date +%s)
repaired=0; skipped_clean=0; skipped_window=0; failed=0; checked=0; gc=0

# Marker GC (GC=1 mode only — runs from a separate, infrequent cron, NOT every
# minute): drop orphan .lumen_fixed sidecars whose .ts has expired. Scanning all
# markers is a full-archive walk, so it must not run on the per-minute hot path.
if [ "${GC:-0}" = "1" ]; then
  for mk in "$ARCHIVE_ROOT"/*/*"$MARKER"; do
    [ -e "$mk" ] || continue
    ts="${mk%$MARKER}"
    [ -f "$ts" ] || { rm -f "$mk"; gc=$((gc+1)); }
  done
  log "GC DONE removed_orphan_markers=$gc"
  exit 0
fi

# Target files by DETERMINISTIC NAME, not by scanning. XUI names each archive
# minute tv_archive/<id>/<Y-m-d:H-M>.ts on the panel's local wall clock, so the
# freshly-closed minutes are computable: just take the current minute minus
# MIN..MAX/60 and build the filenames directly. This avoids walking the ~1M-file
# archive every tick (a find over 24TB HDD takes >60s); instead it is ~3 names ×
# active channels = a few hundred direct `test -f` checks, all O(1).
#
# TZ: filenames follow the panel timezone (Europe/Vienna on this box), which may
# differ from the system clock. We derive the minute strings from `date` honoring
# TZ so the names match what the writer produced. Generate a small window of
# candidate minute strings spanning MIN_AGE_S..MAX_AGE_S ago.
PANEL_TZ="${PANEL_TZ:-Europe/Vienna}"
min_from=$(( MIN_AGE_S / 60 ))           # nearest closed minute (e.g. 1)
min_to=$(( (MAX_AGE_S + 59) / 60 ))      # oldest minute in the forward window (e.g. 4)
minute_strs=""
for ((m = min_from; m <= min_to; m++)); do
  minute_strs="$minute_strs $(TZ="$PANEL_TZ" date -d "@$((now - m*60))" '+%Y-%m-%d:%H-%M')"
done

# Collect the candidate files (deterministic names, O(1) existence checks), skip
# already-marked ones, then repair them with bounded parallelism via xargs -P.
candidates=()
for chan_dir in "$ARCHIVE_ROOT"/*/; do
  [ -d "$chan_dir" ] || continue
  for ms in $minute_strs; do
    f="${chan_dir}${ms}.ts"
    [ -f "$f" ] || continue
    [ -f "${f}${MARKER}" ] && { skipped_clean=$((skipped_clean+1)); continue; }
    candidates+=("$f")
    [ "$LIMIT" -gt 0 ] && [ "${#candidates[@]}" -ge "$LIMIT" ] && break 2
  done
done
checked=${#candidates[@]}

if [ "$DRYRUN" = "1" ]; then
  for f in "${candidates[@]}"; do log "DRYRUN would repair ${f##*tv_archive/}"; done
  log "DONE(dryrun) load=$load1 would_repair=$checked skipped_clean=$skipped_clean"
  exit 0
fi

# Run repairs in parallel; each prints OK/FAIL. Tally the results.
results=""
if [ "$checked" -gt 0 ]; then
  results=$(printf '%s\0' "${candidates[@]}" | xargs -0 -P "$PARALLEL" -I {} bash -c 'repair_one "$@"' _ {} 2>/dev/null)
fi
repaired=$(printf '%s\n' "$results" | grep -c '^OK ')
failed=$(printf '%s\n' "$results" | grep -c '^FAIL ')

log "DONE load=$load1 checked=$checked repaired=$repaired skipped_clean=$skipped_clean failed=$failed gc=$gc parallel=$PARALLEL"
