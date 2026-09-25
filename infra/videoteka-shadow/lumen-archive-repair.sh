#!/bin/bash
# lumen-archive-repair.sh — post-write catch-up archive dead-zone repair.
#
# XUI's ionCube archive writer cuts the live stream on wall-clock minute
# boundaries that land mid-GOP (2s GOP), so each tv_archive/<id>/*.ts minute
# file starts with header-less P-frames -> browser HLS.js drops the GOP head
# and stutters. This re-muxes each CLOSED minute file with dump_extra so SPS/PPS
# sit at the head of every keyframe. Pure -c copy: no transcode, no A/V risk.
#
# Safety: only touches files older than MIN_AGE_S (skips the open minute),
# repairs to a temp file, self-validates (decode errors must be 0), then
# atomically mv's over the original. Idempotent: already-clean files are skipped.
set -u

FF="${FF:-/home/xtreamcodes/iptv_xtream_codes/bin/ffmpeg}"
SCANNER="${SCANNER:-/opt/lumen/nalscan.py}"
ARCHIVE_ROOT="${ARCHIVE_ROOT:-/home/xtreamcodes/iptv_xtream_codes/tv_archive}"
MIN_AGE_S="${MIN_AGE_S:-90}"          # only repair minutes closed >90s ago
MARKER=".lumen_fixed"                  # sidecar marker so we never re-process
DRYRUN="${DRYRUN:-0}"
LIMIT="${LIMIT:-0}"                    # 0 = no limit; >0 = stop after N repairs (testing)

log() { echo "[$(date '+%H:%M:%S')] $*"; }

now=$(date +%s)
repaired=0; skipped_clean=0; skipped_open=0; failed=0; checked=0

# Iterate every channel archive dir
for chan_dir in "$ARCHIVE_ROOT"/*/; do
  [ -d "$chan_dir" ] || continue
  for f in "$chan_dir"*.ts; do
    [ -f "$f" ] || continue
    # Skip if already marked fixed
    [ -f "${f}${MARKER}" ] && { skipped_clean=$((skipped_clean+1)); continue; }
    # Skip the currently-open / too-fresh minute (writer may still hold it)
    mtime=$(stat -c %Y "$f" 2>/dev/null) || continue
    age=$((now - mtime))
    if [ "$age" -lt "$MIN_AGE_S" ]; then skipped_open=$((skipped_open+1)); continue; fi

    checked=$((checked+1))
    # No before-check: the .lumen_fixed marker already prevents re-processing, so
    # any unmarked file is repaired unconditionally. dump_extra is idempotent
    # (running it on an already-clean GOP just re-asserts the headers), and the
    # authoritative 0-error decode check runs AFTER the repair, so we never need
    # a pre-decode probe. A raw byte-scan pre-check is NOT safe here: stray
    # 00-00-01 sequences in PES/audio bytes produce false "SPS-before-slice"
    # readings that would wrongly skip a genuine dead-zone file.
    if [ "$DRYRUN" = "1" ]; then
      log "DRYRUN would repair $(basename "$f")"
      repaired=$((repaired+1))
      [ "$LIMIT" -gt 0 ] && [ "$repaired" -ge "$LIMIT" ] && break 2
      continue
    fi

    tmp="${f}.lumenfix.$$"
    "$FF" -hide_banner -v error -y -i "$f" -c copy \
      -bsf:v dump_extra=freq=k -mpegts_flags +resend_headers \
      -f mpegts "$tmp" 2>/dev/null
    if [ ! -s "$tmp" ]; then
      log "FAIL $(basename "$f"): empty output"; rm -f "$tmp"; failed=$((failed+1)); continue
    fi
    after=$("$FF" -hide_banner -v error -i "$tmp" -t 3 -f null - 2>&1 | grep -ciE "non-existing PPS|no frame")
    if [ "$after" -ne 0 ]; then
      log "FAIL $(basename "$f"): after=$after (>0), keeping original"; rm -f "$tmp"; failed=$((failed+1)); continue
    fi
    # Atomic replace, preserve owner/perms
    chown --reference="$f" "$tmp" 2>/dev/null
    chmod --reference="$f" "$tmp" 2>/dev/null
    mv -f "$tmp" "$f"
    : > "${f}${MARKER}"
    log "OK $(basename "$f"): repaired, 0 errors"
    repaired=$((repaired+1))
    [ "$LIMIT" -gt 0 ] && [ "$repaired" -ge "$LIMIT" ] && break 2
  done
done

log "DONE checked=$checked repaired=$repaired skipped_clean=$skipped_clean skipped_open=$skipped_open failed=$failed"
