#!/usr/bin/env bash
#
# probe-codec-map.sh — Lumen catch-up shadow codec map refresher
#
# WHY: source feeds change. A channel that is AAC today can become MP2 tomorrow
# (and vice-versa). timeshift_shadow.php reads the JSON this script writes to
# decide, per stream, whether it must transcode (MP2/AC3/...) or can step aside
# (AAC/MP3 -> browser plays it natively). Running this on a cron keeps that
# decision LIVE instead of a hardcoded whitelist.
#
# WHAT IT DOES (read-only against the archive):
#   - For each recorded stream (a numeric dir under tv_archive), ffprobe the
#     newest .ts segment and record audio_codec + video_codec.
#   - Write an atomic JSON map to SHADOW_CODEC_MAP_FILE.
#
# SAFETY: only reads archive files + runs ffprobe. Never writes into the
# archive, never touches the original timeshift.php, never restarts a service.
#
# USAGE (cron, e.g. every 30 min):
#   */30 * * * * /home/xtreamcodes/iptv_xtream_codes/wwwdir/streaming/probe-codec-map.sh >/dev/null 2>&1
#
# Env overrides:
#   TV_ARCHIVE_DIR   (default: /home/xtreamcodes/iptv_xtream_codes/tv_archive)
#   FFPROBE_BIN      (default: /home/xtreamcodes/iptv_xtream_codes/bin/ffprobe)
#   CODEC_MAP_FILE   (default: /tmp/catchup_shadow_codecmap.json)
#   MAX_STREAMS      (default: 0 = no limit)

set -u

TV_ARCHIVE_DIR="${TV_ARCHIVE_DIR:-/home/xtreamcodes/iptv_xtream_codes/tv_archive}"
FFPROBE_BIN="${FFPROBE_BIN:-/home/xtreamcodes/iptv_xtream_codes/bin/ffprobe}"
CODEC_MAP_FILE="${CODEC_MAP_FILE:-/tmp/catchup_shadow_codecmap.json}"
MAX_STREAMS="${MAX_STREAMS:-0}"
LOG_FILE="${CODEC_MAP_LOG:-/tmp/catchup_shadow_codecmap.log}"

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*" >>"$LOG_FILE"; }

if [ ! -x "$FFPROBE_BIN" ]; then
    # Fall back to PATH ffprobe if the bundled one is missing.
    if command -v ffprobe >/dev/null 2>&1; then
        FFPROBE_BIN="$(command -v ffprobe)"
    else
        log "ERROR: ffprobe not found ($FFPROBE_BIN)"
        exit 1
    fi
fi

if [ ! -d "$TV_ARCHIVE_DIR" ]; then
    log "ERROR: archive dir not found ($TV_ARCHIVE_DIR)"
    exit 1
fi

tmp_file="$(mktemp "${CODEC_MAP_FILE}.XXXXXX")" || { log "ERROR: mktemp failed"; exit 1; }
trap 'rm -f "$tmp_file"' EXIT

probe_one() {
    local stream_dir="$1" stream_id="$2"
    # newest .ts segment (catch-up rolls forward, so -t newest is representative)
    local seg
    seg="$(find "$stream_dir" -maxdepth 1 -name '*.ts' -type f -printf '%T@ %p\n' 2>/dev/null \
        | sort -rn | head -1 | cut -d' ' -f2-)"
    [ -z "$seg" ] && return 1
    local acodec vcodec
    acodec="$("$FFPROBE_BIN" -v error -select_streams a:0 -show_entries stream=codec_name -of csv=p=0 "$seg" 2>/dev/null | head -1)"
    vcodec="$("$FFPROBE_BIN" -v error -select_streams v:0 -show_entries stream=codec_name -of csv=p=0 "$seg" 2>/dev/null | head -1)"
    [ -z "$acodec" ] && acodec="none"
    [ -z "$vcodec" ] && vcodec="none"
    printf '    "%s": {"audio_codec": "%s", "video_codec": "%s"}' "$stream_id" "$acodec" "$vcodec"
}

generated_at="$(date +%s)"
{
    echo "{"
    echo "  \"generated_at\": $generated_at,"
    echo "  \"streams\": {"

    first=1
    count=0
    for stream_dir in "$TV_ARCHIVE_DIR"/*/; do
        [ -d "$stream_dir" ] || continue
        stream_id="$(basename "$stream_dir")"
        # only numeric stream ids (skip log files / stray dirs)
        case "$stream_id" in
            ''|*[!0-9]*) continue ;;
        esac
        entry="$(probe_one "$stream_dir" "$stream_id")" || continue
        if [ "$first" -eq 1 ]; then
            first=0
        else
            echo ","
        fi
        printf '%s' "$entry"
        count=$((count + 1))
        if [ "$MAX_STREAMS" -gt 0 ] && [ "$count" -ge "$MAX_STREAMS" ]; then
            break
        fi
    done
    echo ""
    echo "  }"
    echo "}"
} >"$tmp_file"

# Validate JSON if python is available; refuse to publish a broken map.
if command -v python3 >/dev/null 2>&1; then
    if ! python3 -c "import json,sys; json.load(open('$tmp_file'))" 2>/dev/null; then
        log "ERROR: generated map is invalid JSON, keeping previous map"
        exit 1
    fi
fi

mv -f "$tmp_file" "$CODEC_MAP_FILE"
trap - EXIT
log "OK: wrote codec map ($count streams) -> $CODEC_MAP_FILE"
