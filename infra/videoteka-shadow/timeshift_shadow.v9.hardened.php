<?php

error_reporting(0);
set_time_limit(0);
ignore_user_abort(true);

register_shutdown_function('shutdown');
register_shutdown_function('shadowCatchupShutdown');

require '../init.php';

// HARDENING: token key is read from the server environment, never committed.
// On the server set it in the php-fpm pool env, e.g.:
//   env[SHADOW_TOKEN_KEY] = <the real key>
// The original v9 inlined the literal here; we redact it for git and require env.
define('SHADOW_TOKEN_KEY', getenv('SHADOW_TOKEN_KEY') !== false ? getenv('SHADOW_TOKEN_KEY') : '');
if (SHADOW_TOKEN_KEY === '') {
    header('HTTP/1.1 500 Internal Server Error');
    die('Shadow token key not configured.');
}
define('SHADOW_ARCHIVE_ROOT', IPTV_PANEL_DIR . 'tv_archive_shadow/');
define('SHADOW_CACHE_ROOT', '/tmp/catchup_shadow_hls/');
define('SHADOW_BUILD_VERSION', 'v9');

// HARDENING constants (ADD-only, do not alter v9 behavior unless engaged).
// 1) Global concurrency cap on simultaneous transcode builds (beta ≤500 users).
define('SHADOW_MAX_CONCURRENT_BUILDS', 4);
// 2) Inline /tmp cache GC: sampled (1-in-N) sweep of stale build dirs.
define('SHADOW_CACHE_GC_MAX_AGE', 7200);     // seconds; dirs older than this are removed
define('SHADOW_CACHE_GC_PROBABILITY', 25);   // run GC on ~1/25 of requests
// 3) Dynamic codec map: cron-produced JSON of per-stream audio/video codecs so the
//    shadow can step aside (409) for streams that are already browser-safe (AAC/MP3 + H.264).
define('SHADOW_CODEC_MAP_FILE', '/tmp/catchup_shadow_codecmap.json');
define('SHADOW_CODEC_MAP_MAX_AGE', 21600);   // 6h; older map is treated as unknown (fail-open)

function shadowAliasRuntime($alias, array $candidates)
{
    if (class_exists($alias, false)) {
        return;
    }

    foreach ($candidates as $candidate) {
        if (class_exists($candidate, false)) {
            class_alias($candidate, $alias);
            return;
        }
    }

    header('HTTP/1.1 500 Internal Server Error');
    die('Missing runtime class: ' . $alias);
}

shadowAliasRuntime('ipTV_lib', array(
    'A78Bf8d35765BE2408c50712ce7a43AD',
    'e2D73953a5089B9C7983838f61F23Acf'
));
shadowAliasRuntime('ipTV_streaming', array(
    'cd89785224751CCA8017139dAF9e891E',
    'F1CA094152763c79018e9f1893eF1E48'
));

if (!class_exists('geoip', false)) {
    foreach (array('eA991bA3EC74F0FB90aCC94C2D2dE518', 'FFCABA9D38408D4853b09feD9B2F7571') as $geoCandidate) {
        if (class_exists($geoCandidate, false)) {
            class_alias($geoCandidate, 'geoip');
            break;
        }
    }
}

function shadowResolveStreamingMethod(array $candidates, $required = true)
{
    foreach ($candidates as $candidate) {
        if (method_exists('ipTV_streaming', $candidate)) {
            return $candidate;
        }
    }

    if ($required) {
        header('HTTP/1.1 500 Internal Server Error');
        die('Missing runtime streaming method.');
    }

    return null;
}

function shadowResolveGeoMethod()
{
    if (!class_exists('geoip', false)) {
        return null;
    }

    foreach (array('c6a76952b4cef18f3c98c0e6a9dd1274', 'F0C9B48F97cf10f24DA4e7bE863374aF') as $candidate) {
        if (method_exists('geoip', $candidate)) {
            return $candidate;
        }
    }

    return null;
}

function shadowResolveDbMethod(array $candidates, $required = true)
{
    $db = ipTV_lib::$ipTV_db;

    foreach ($candidates as $candidate) {
        if (method_exists($db, $candidate)) {
            return $candidate;
        }
    }

    if ($required) {
        header('HTTP/1.1 500 Internal Server Error');
        die('Missing runtime DB method.');
    }

    return null;
}

define('STREAM_METHOD_CLOSE_AND_TRANSFER', shadowResolveStreamingMethod(array(
    'CloseAndTransfer',
    'E990445b40642e0eFD070e994375F6af',
    'e01C6247dc62e1Ede6Da6671b6adBb8D'
)));
define('STREAM_METHOD_GET_USER_INFO', shadowResolveStreamingMethod(array(
    'GetUserInfo',
    'E5550592AA298DD1D5ee59cdcE063A12',
    'D909B0D1a6FFFDcDB838046fac418b04'
)));
define('STREAM_METHOD_CLOSE_LAST_CON', shadowResolveStreamingMethod(array(
    'CloseLastCon',
    'a813cBD1E7EA2Bb17742dE7BB2392ebF'
), false));
define('STREAM_METHOD_CLIENT_LOG', shadowResolveStreamingMethod(array(
    'ClientLog',
    'c1591643EAfdAaE33ff6E69e5e49D651'
), false));
define('STREAM_METHOD_SHOW_VIDEO', shadowResolveStreamingMethod(array(
    'ShowVideo',
    'd0b968cd6CFdf340CA85B1c3d9A40649'
), false));
define('STREAM_METHOD_GET_USER_IP', shadowResolveStreamingMethod(array(
    'getUserIP',
    'e1F75a50f74A8f4E2129ba474f45d670',
    'cdB7Ed3e4910A38DAaB7bdEdc40d824F'
)));
define('STREAM_METHOD_CHANNEL_CHECK', shadowResolveStreamingMethod(array(
    'F3c105bCCed491229d4Aed6937F96a8c',
    'F3c105BCCEd491229D4Aed6937F96A8C',
    'F3d10AFc1F577769323A685BA204079e'
)));
define('STREAM_METHOD_CRACKED_IP', shadowResolveStreamingMethod(array(
    'C57799E5196664CB99139813250673e2'
), false));
define('STREAM_METHOD_SAVE_OFFLINE', shadowResolveStreamingMethod(array(
    'A49c2Fb1ebA096C52a352A85C8d09D8D',
    'A49c2Fb1EBa096c52a352a85C8d09d8D'
), false));
define('STREAM_METHOD_GEO_LOOKUP', shadowResolveGeoMethod());
define('DB_METHOD_NUM_ROWS', shadowResolveDbMethod(array(
    'num_rows',
    'D4A34259FC10B35feDbCCdA0A23d69AE',
    'dcEaB38EEd908557c244f9Ef2E68b426'
)));
define('DB_METHOD_GET_ROW', shadowResolveDbMethod(array(
    'get_row',
    'eb6BFe16d93814cAf26D92092d5a4052'
)));
define('DB_METHOD_LAST_ID', shadowResolveDbMethod(array(
    'last_insert_id',
    'c02fB3004CeC2de0bC39f4ED412479B1',
    'C02fb3004CEc2de0BC39F4ED412479B1'
)));

$shadowActivityId = 0;
$shadowDate = time();
$shadowExternalDevice = '';
$shadowContainerPriority = 'TV Archive';
$shadowConnectionIsp = '';
$shadowStreamId = 0;
$shadowUserInfo = null;
$shadowUserAgent = '';
$shadowUserIp = '';
$shadowGeoipCountryCode = '';

header('Access-Control-Allow-Origin: *');

if (ipTV_lib::$settings['use_buffer'] == 0) {
    header('X-Accel-Buffering: no');
}

function shadowLog($message)
{
    file_put_contents('/tmp/catchup_shadow.log', date('Y-m-d H:i:s') . ' ' . $message . "\n", FILE_APPEND);
}

// ---------------------------------------------------------------------------
// HARDENING helpers (ADD-only). None of these run unless explicitly called from
// the build path below; on the original v9 hot path they are pure additions.
// ---------------------------------------------------------------------------

// Count active builds by counting fresh remux.lock files under the cache root.
// A lock older than 300s is considered stale (matches v9's own staleness window).
function shadowActiveBuildCount()
{
    $count = 0;
    $locks = @glob(SHADOW_CACHE_ROOT . '*/remux.lock');
    if (!is_array($locks)) {
        return 0;
    }
    $now = time();
    foreach ($locks as $lock) {
        $mtime = @filemtime($lock);
        if ($mtime !== false && ($now - $mtime) < 300) {
            $count++;
        }
    }
    return $count;
}

// NOTE: shadowRemoveTree() already exists in v9 (recursive dir removal); the GC
// below reuses it rather than redeclaring. We only ever pass it our own
// SHADOW_CACHE_ROOT subdirs — never archive or panel files.

// Sampled GC of stale build dirs in /tmp so the recording server's /tmp does not
// fill up under sustained beta load. Skips dirs with a fresh lock (active build).
function shadowMaybeGarbageCollect()
{
    if (SHADOW_CACHE_GC_PROBABILITY < 1) {
        return;
    }
    // Deterministic-enough sampling without Math.random-style nondeterminism:
    // use pid + second so it fires on ~1/N of requests without a global counter.
    if (((getmypid() + (int) date('s')) % SHADOW_CACHE_GC_PROBABILITY) !== 0) {
        return;
    }

    $dirs = @glob(SHADOW_CACHE_ROOT . '*', GLOB_ONLYDIR);
    if (!is_array($dirs)) {
        return;
    }
    $now = time();
    $removed = 0;
    foreach ($dirs as $dir) {
        $lock = $dir . '/remux.lock';
        if (file_exists($lock) && ($now - (int) @filemtime($lock)) < 300) {
            continue; // active build, leave it
        }
        $mtime = @filemtime($dir);
        if ($mtime !== false && ($now - $mtime) > SHADOW_CACHE_GC_MAX_AGE) {
            shadowRemoveTree($dir);
            $removed++;
        }
    }
    if ($removed > 0) {
        shadowLog('cache gc removed=' . $removed);
    }
}

// Read the cron-produced codec map and return the safety status for a stream:
//   'safe'    => already browser-playable (AAC/MP3 audio + non-HEVC video) → step aside
//   'unsafe'  => needs transcode (MP2 audio, or anything not known-safe)   → keep building
//   'unknown' => no entry / stale map / unreadable                          → fail-open (build)
function shadowCodecMapStatus($streamId)
{
    if (!file_exists(SHADOW_CODEC_MAP_FILE)) {
        return 'unknown';
    }
    $raw = @file_get_contents(SHADOW_CODEC_MAP_FILE);
    if ($raw === false) {
        return 'unknown';
    }
    $map = @json_decode($raw, true);
    if (!is_array($map)) {
        return 'unknown';
    }

    // Staleness: prefer the map's own generated_at (set by probe-codec-map.sh),
    // fall back to file mtime. A stale map is not trusted → fail-open (build).
    $generatedAt = isset($map['generated_at']) ? (int) $map['generated_at'] : (int) @filemtime(SHADOW_CODEC_MAP_FILE);
    if ((time() - $generatedAt) > SHADOW_CODEC_MAP_MAX_AGE) {
        return 'unknown';
    }

    // Map shape (probe-codec-map.sh): { generated_at, streams: { "<id>": {audio_codec, video_codec} } }
    $streams = isset($map['streams']) && is_array($map['streams']) ? $map['streams'] : $map;
    $key = (string) intval($streamId);
    if (!isset($streams[$key]) || !is_array($streams[$key])) {
        return 'unknown';
    }
    $entry = $streams[$key];
    $audio = isset($entry['audio_codec']) ? strtolower((string) $entry['audio_codec']) : '';
    $video = isset($entry['video_codec']) ? strtolower((string) $entry['video_codec']) : '';
    // Browser-safe audio: AAC or MP3 (Chrome MSE decodes both). MP2 is the problem.
    $audioSafe = ($audio === 'aac' || $audio === 'mp3');
    // HEVC is not transcoded here anyway; do not claim "safe" for it (client warns).
    $videoSafe = ($video !== 'hevc' && $video !== 'h265' && $video !== '' && $video !== 'none');
    if ($audioSafe && $videoSafe) {
        return 'safe';
    }
    return 'unsafe';
}

function shadowCatchupShutdown()
{
    global $shadowActivityId, $shadowUserInfo, $shadowStreamId, $shadowDate, $shadowUserAgent, $shadowUserIp;
    global $shadowGeoipCountryCode, $shadowExternalDevice, $shadowContainerPriority;
    global $shadowConnectionIsp;

    if (!empty($shadowActivityId) && !empty($shadowUserInfo) && !empty($shadowStreamId)) {
        shadowCloseAndTransfer($shadowActivityId);
        shadowSaveOfflineConnection(
            SERVER_ID,
            $shadowUserInfo['id'],
            $shadowStreamId,
            $shadowDate,
            $shadowUserAgent,
            $shadowUserIp,
            $shadowContainerPriority,
            $shadowGeoipCountryCode,
            $shadowConnectionIsp,
            $shadowExternalDevice
        );
    }

    if (function_exists('fastcgi_finish_request')) {
        @fastcgi_finish_request();
    }
}

function shadowStreamingCall($method, array $args = array())
{
    if (empty($method)) {
        return null;
    }
    return call_user_func_array(array('ipTV_streaming', $method), $args);
}

function shadowGetUserIP()
{
    return shadowStreamingCall(STREAM_METHOD_GET_USER_IP);
}

function shadowGetUserInfo()
{
    return shadowStreamingCall(STREAM_METHOD_GET_USER_INFO, func_get_args());
}

function shadowClientLog()
{
    return shadowStreamingCall(STREAM_METHOD_CLIENT_LOG, func_get_args());
}

function shadowShowVideo()
{
    if (empty(STREAM_METHOD_SHOW_VIDEO)) {
        http_response_code(403);
        die;
    }
    return shadowStreamingCall(STREAM_METHOD_SHOW_VIDEO, func_get_args());
}

function shadowCloseLastCon()
{
    return shadowStreamingCall(STREAM_METHOD_CLOSE_LAST_CON, func_get_args());
}

function shadowCloseAndTransfer($activityId)
{
    return shadowStreamingCall(STREAM_METHOD_CLOSE_AND_TRANSFER, array($activityId));
}

function shadowSaveOfflineConnection()
{
    return shadowStreamingCall(STREAM_METHOD_SAVE_OFFLINE, func_get_args());
}

function shadowGetGeoCountryCode($ipAddress)
{
    if (function_exists('geoip_country_code_by_name')) {
        $code = @geoip_country_code_by_name($ipAddress);
        if (!empty($code)) {
            return $code;
        }
    }

    if (!class_exists('geoip', false) || empty(STREAM_METHOD_GEO_LOOKUP)) {
        return '';
    }

    $geo = new geoip(GEOIP2_FILENAME);
    $method = STREAM_METHOD_GEO_LOOKUP;
    $data = $geo->$method($ipAddress);

    if (method_exists($geo, 'close')) {
        $geo->close();
    }

    if (empty($data) || !is_array($data)) {
        return '';
    }

    if (!empty($data['registered_country']['iso_code'])) {
        return $data['registered_country']['iso_code'];
    }

    if (!empty($data['country']['iso_code'])) {
        return $data['country']['iso_code'];
    }

    return '';
}

function shadowDbCall($db, $method, array $args = array())
{
    return call_user_func_array(array($db, $method), $args);
}

function shadowDecryptToken($data, $key)
{
    $i = 0;
    $output = '';

    foreach (str_split($data) as $char) {
        $output .= chr(ord($char) ^ ord($key[$i++ % strlen($key)]));
    }

    return $output;
}

function shadowDecodeTokenPayload($rawToken)
{
    $normalized = rawurldecode($rawToken);
    $normalized = str_replace(' ', '+', $normalized);
    $decoded = false;

    $binary = base64_decode($normalized, true);
    if ($binary !== false) {
        if (function_exists('decrypt_config')) {
            $decoded = @json_decode(decrypt_config($binary, md5(ipTV_lib::$settings['crypt_load_balancing'])), true);
        }

        if (!is_array($decoded) && function_exists('F08cC5C567Cd66B30a2A1f399445489c')) {
            $decoded = @json_decode(F08cC5C567Cd66B30a2A1f399445489c($binary, md5(ipTV_lib::$settings['crypt_load_balancing'])), true);
        }

        if (!is_array($decoded)) {
            $decoded = @json_decode(shadowDecryptToken($binary, SHADOW_TOKEN_KEY), true);
        }
    }

    return is_array($decoded) ? $decoded : null;
}

function shadowTokenIpHeaders()
{
    return array(
        'HTTP_INCAP_CLIENT_IP',
        'HTTP_CF_CONNECTING_IP',
        'HTTP_CLIENT_IP',
        'HTTP_X_FORWARDED_FOR',
        'HTTP_X_FORWARDED',
        'HTTP_X_CLUSTER_CLIENT_IP',
        'HTTP_FORWARDED_FOR',
        'HTTP_FORWARDED',
        'REMOTE_ADDR'
    );
}

function shadowTokenHashForIp(array $request, $ipAddress)
{
    $raw = empty($request['token_payload']) || !is_array($request['token_payload']) ? array() : $request['token_payload'];

    return md5(json_encode(array(
        'user_id' => array_key_exists('user_id', $raw) ? $raw['user_id'] : $request['user_id'],
        'username' => array_key_exists('username', $raw) ? $raw['username'] : $request['username'],
        'password' => array_key_exists('password', $raw) ? $raw['password'] : $request['password'],
        'user_ip' => $ipAddress,
        'live_streaming_pass' => ipTV_lib::$settings['live_streaming_pass'],
        'external_device' => array_key_exists('external_device', $raw) ? $raw['external_device'] : $request['token_external_device'],
        'isp' => array_key_exists('isp', $raw) ? $raw['isp'] : $request['token_isp'],
        'country' => array_key_exists('country', $raw) ? $raw['country'] : $request['token_country'],
        'stream_id' => array_key_exists('stream_id', $raw) ? $raw['stream_id'] : $request['stream_id'],
        'start' => array_key_exists('start', $raw) ? $raw['start'] : $request['start'],
        'duration' => array_key_exists('duration', $raw) ? $raw['duration'] : $request['duration'],
        'extension' => array_key_exists('extension', $raw) ? $raw['extension'] : $request['extension'],
        'time' => array_key_exists('time', $raw) ? $raw['time'] : $request['token_time']
    )));
}

function shadowResolveTokenUserIp(array $request)
{
    if (empty($request['token_hash'])) {
        return shadowGetUserIP();
    }

    if (intval(ipTV_lib::$settings['hash_lb']) === 1) {
        foreach (shadowTokenIpHeaders() as $header) {
            if (!array_key_exists($header, $_SERVER)) {
                continue;
            }

            foreach (explode(',', $_SERVER[$header]) as $candidateIp) {
                $candidateIp = trim($candidateIp);
                if (empty($candidateIp)) {
                    continue;
                }

                if (hash_equals($request['token_hash'], shadowTokenHashForIp($request, $candidateIp))) {
                    return $candidateIp;
                }
            }
        }

        return '';
    }

    if (!empty($_SERVER['REMOTE_ADDR'])) {
        return $_SERVER['REMOTE_ADDR'];
    }

    return shadowGetUserIP();
}

function shadowTokenStillValid(array $request)
{
    if (empty($request['token_time'])) {
        return true;
    }

    $serverNow = time();
    if (!empty(ipTV_lib::$StreamingServers[SERVER_ID]['diff_time_main'])) {
        $serverNow += intval(ipTV_lib::$StreamingServers[SERVER_ID]['diff_time_main']);
    }

    return intval($request['token_time']) >= $serverNow;
}

function shadowGetRequest()
{
    $request = array(
        'user_id' => 0,
        'username' => '',
        'password' => '',
        'stream' => '',
        'stream_id' => 0,
        'start' => '',
        'duration' => 0,
        'extension' => '',
        'play_token' => null,
        'segment_token' => null,
        'segment_index' => null,
        'segment_extension' => 'ts',
        'segment_is_init' => false,
        'is_token' => false,
        'raw_token' => '',
        'token_country' => '',
        'token_isp' => '',
        'token_time' => 0,
        'token_hash' => '',
        'token_external_device' => '',
        'token_payload' => array(),
        'archive_source' => empty($_GET['archive_source']) ? 'live' : strtolower(trim($_GET['archive_source']))
    );

    if (!empty($_GET['token'])) {
        $decoded = shadowDecodeTokenPayload($_GET['token']);
        if (!is_array($decoded) || empty($decoded['stream_id'])) {
            shadowLog('token decode failed len=' . strlen($_GET['token']));
            header('HTTP/1.1 403 Forbidden');
            die;
        }

        $request['user_id'] = empty($decoded['user_id']) ? 0 : intval($decoded['user_id']);
        $request['username'] = empty($decoded['username']) ? '' : $decoded['username'];
        $request['password'] = empty($decoded['password']) ? '' : $decoded['password'];
        $request['stream'] = $decoded['stream_id'];
        $request['stream_id'] = intval($decoded['stream_id']);
        $request['start'] = empty($decoded['start']) ? '' : $decoded['start'];
        $request['duration'] = empty($decoded['duration']) ? 0 : intval($decoded['duration']);
        $request['extension'] = empty($decoded['extension']) ? 'm3u8' : $decoded['extension'];
        $request['play_token'] = empty($decoded['play_token']) ? null : $decoded['play_token'];
        $request['is_token'] = true;
        $request['raw_token'] = $_GET['token'];
        $request['token_country'] = empty($decoded['country']) ? '' : $decoded['country'];
        $request['token_isp'] = empty($decoded['isp']) ? '' : $decoded['isp'];
        $request['token_time'] = empty($decoded['time']) ? 0 : intval($decoded['time']);
        $request['token_hash'] = empty($decoded['hash']) ? '' : $decoded['hash'];
        $request['token_external_device'] = empty($decoded['external_device']) ? '' : $decoded['external_device'];
        $request['token_payload'] = $decoded;
        shadowLog('token decode ok stream=' . $request['stream_id'] . ' start=' . $request['start'] . ' duration=' . $request['duration']);

        if (isset($_GET['seg'])) {
            shadowApplySegmentRequest($request, $_GET['seg']);
        }
    } else {
        $direct = $_GET;
        if (empty($direct['stream']) && !empty(ipTV_lib::$request['stream'])) {
            $direct = array_merge(ipTV_lib::$request, $direct);
        }

        $request['username'] = empty($direct['username']) ? '' : $direct['username'];
        $request['password'] = empty($direct['password']) ? '' : $direct['password'];
        $request['stream'] = empty($direct['stream']) ? '' : $direct['stream'];
        $request['start'] = empty($direct['start']) ? '' : $direct['start'];
        $request['duration'] = empty($direct['duration']) ? 0 : intval($direct['duration']);
        $request['extension'] = empty($direct['extension']) ? 'm3u8' : $direct['extension'];
        $request['play_token'] = empty($direct['play_token']) ? null : $direct['play_token'];

        if (!empty($request['stream']) && !is_numeric($request['stream']) && strpos($request['stream'], '_') !== false) {
            $parts = explode('_', $request['stream']);
            $request['stream_id'] = intval($parts[0]);
            $request['segment_index'] = intval($parts[1]);
            $request['extension'] = 'm3u8';
        } else {
            $request['stream_id'] = intval($request['stream']);
        }

        if (isset($_GET['seg'])) {
            shadowApplySegmentRequest($request, $_GET['seg']);
        }
    }

    if (!in_array($request['archive_source'], array('live', 'shadow'), true)) {
        $request['archive_source'] = 'live';
    }

    return $request;
}

function shadowApplySegmentRequest(array &$request, $segmentToken)
{
    $segmentToken = trim((string) $segmentToken);
    if ($segmentToken === '') {
        return;
    }

    if (!preg_match('/^(?:init(?:_\d+)?\.mp4|seg_\d+(?:_\d+)?\.(?:ts|m4s)|\d+(?:_\d+)?\.(?:ts|m4s))$/i', $segmentToken)) {
        return;
    }

    $request['segment_token'] = $segmentToken;

    if (preg_match('/^init(?:_\d+)?\.mp4$/i', $segmentToken)) {
        $request['segment_is_init'] = true;
        $request['segment_extension'] = 'mp4';
        $request['segment_index'] = null;
        return;
    }

    if (preg_match('/^seg_(\d+)\.(ts|m4s)$/i', $segmentToken, $matches)) {
        $request['segment_index'] = intval($matches[1]);
        $request['segment_extension'] = strtolower($matches[2]);
        return;
    }

    if (preg_match('/^(\d+)(?:_\d+)?\.(ts|m4s)$/i', $segmentToken, $matches)) {
        $request['segment_index'] = intval($matches[1]);
        $request['segment_extension'] = strtolower($matches[2]);
        return;
    }

    $segment = preg_replace('/\.(ts|m4s)$/i', '', $segmentToken);
    $parts = explode('_', $segment);
    $request['segment_index'] = intval($parts[0]);
}

function shadowParseStartTimestamp($startParam, &$duration)
{
    if (!is_numeric($startParam)) {
        if (substr_count($startParam, '-') == 1) {
            list($datePart, $hourPart) = explode('-', $startParam);
            $year = substr($datePart, 0, 4);
            $month = substr($datePart, 4, 2);
            $day = substr($datePart, 6, 2);
            $minutes = 0;
            $hour = $hourPart;
        } else {
            list($datePart, $timePart) = explode(':', $startParam);
            list($year, $month, $day) = explode('-', $datePart);
            list($hour, $minutes) = explode('-', $timePart);
        }

        return mktime($hour, $minutes, 0, $month, $day, $year);
    }

    $duration *= 24;
    return intval($startParam);
}

function shadowResolveNumericStart($archiveRoot, $streamId, $startOffset)
{
    $fileList = array_values(array_filter(explode("\n", trim((string) shell_exec(
        'ls -tr ' . escapeshellarg($archiveRoot . $streamId) . ' 2>/dev/null'
    )))));

    if (empty($fileList)) {
        return 0;
    }

    $offset = intval($startOffset) * 24;
    if (count($fileList) >= $offset && $offset > 0) {
        $candidate = $fileList[count($fileList) - $offset];
    } else {
        $candidate = $fileList[0];
    }

    if (preg_match('/(.*)-(.*)-(.*):(.*)\./', $candidate, $matches)) {
        return mktime($matches[4], 0, 0, $matches[2], $matches[3], $matches[1]);
    }

    return 0;
}

function shadowArchiveRoot($source)
{
    if ($source === 'shadow') {
        return SHADOW_ARCHIVE_ROOT;
    }

    return TV_ARCHIVE;
}

function shadowCollectArchiveFiles($archiveRoot, $streamId, $startTimestamp, $duration)
{
    $files = array();

    for ($index = 0; $index < $duration; $index++) {
        $path = $archiveRoot . $streamId . '/' . date('Y-m-d:H-i', $startTimestamp + ($index * 60)) . '.ts';
        if (file_exists($path) && is_readable($path) && filesize($path) > 0) {
            $files[] = $path;
        }
    }

    return $files;
}

function shadowProbeMedia($inputFile)
{
    $command = FFPROBE_PATH
        . ' -v error -show_entries stream=index,codec_type,codec_name,profile,sample_rate,channels,start_time'
        . ' -of json ' . escapeshellarg($inputFile);
    $json = @shell_exec($command);
    $data = @json_decode($json, true);

    $probe = array(
        'has_video' => false,
        'has_audio' => false,
        'video_codec' => '',
        'video_start_time' => 0.0,
        'audio_codec' => '',
        'audio_profile' => '',
        'audio_start_time' => 0.0,
        'audio_sample_rate' => 0,
        'audio_channels' => 0,
        'audio_copy_safe' => false,
        'av_start_delta' => 0.0
    );

    if (empty($data['streams']) || !is_array($data['streams'])) {
        return $probe;
    }

    foreach ($data['streams'] as $stream) {
        if ($stream['codec_type'] === 'video' && !$probe['has_video']) {
            $probe['has_video'] = true;
            $probe['video_codec'] = empty($stream['codec_name']) ? '' : strtolower($stream['codec_name']);
            $probe['video_start_time'] = isset($stream['start_time']) ? (float) $stream['start_time'] : 0.0;
        }

        if ($stream['codec_type'] === 'audio' && !$probe['has_audio']) {
            $probe['has_audio'] = true;
            $probe['audio_codec'] = empty($stream['codec_name']) ? '' : strtolower($stream['codec_name']);
            $probe['audio_profile'] = empty($stream['profile']) ? '' : strtoupper($stream['profile']);
            $probe['audio_start_time'] = isset($stream['start_time']) ? (float) $stream['start_time'] : 0.0;
            $probe['audio_sample_rate'] = empty($stream['sample_rate']) ? 0 : intval($stream['sample_rate']);
            $probe['audio_channels'] = empty($stream['channels']) ? 0 : intval($stream['channels']);
        }
    }

    if ($probe['has_audio'] && $probe['audio_codec'] === 'aac') {
        $profileSafe = ($probe['audio_profile'] === '' || strpos($probe['audio_profile'], 'LC') !== false);
        $rateSafe = in_array($probe['audio_sample_rate'], array(0, 44100, 48000), true);
        $probe['audio_copy_safe'] = ($profileSafe && $rateSafe);
    }

    if ($probe['has_video'] && $probe['has_audio']) {
        $probe['av_start_delta'] = max(0.0, $probe['video_start_time'] - $probe['audio_start_time']);
    }

    return $probe;
}

function shadowProbePrefersMp4($probe)
{
    return ($probe['has_video'] && $probe['has_audio'] && $probe['av_start_delta'] >= 0.4);
}

function shadowStreamPrefersMp4($streamId, $probe)
{
    // Browser-sensitive catchup channels where TS output repeatedly falls back
    // after decode validation. Start with fMP4 to avoid slow rejected TS builds.
    if (in_array(intval($streamId), array(75, 105, 112), true)) {
        return true;
    }

    return shadowProbePrefersMp4($probe);
}

function shadowProbeNeedsAudioRealign($probe)
{
    return ($probe['has_video'] && $probe['has_audio'] && $probe['av_start_delta'] >= 0.15);
}

function shadowRemoveGlob($pattern)
{
    foreach (glob($pattern) as $path) {
        @unlink($path);
    }
}

function shadowRemoveTree($path)
{
    if (!is_dir($path)) {
        return;
    }

    foreach (glob($path . '/*') as $childPath) {
        if (is_dir($childPath)) {
            shadowRemoveTree($childPath);
        } else {
            @unlink($childPath);
        }
    }

    @rmdir($path);
}

function shadowWaitForBuildLock($lockFile, $watchedFile = null, $timeoutSeconds = 120)
{
    $maxWait = max(1, intval($timeoutSeconds)) * 2;
    $wait = 0;

    clearstatcache(true, $lockFile);
    if ($watchedFile !== null) {
        clearstatcache(true, $watchedFile);
    }

    while (file_exists($lockFile) && $wait < $maxWait) {
        usleep(500000);
        $wait++;
        clearstatcache(true, $lockFile);
        if ($watchedFile !== null) {
            clearstatcache(true, $watchedFile);
        }
    }

    return !file_exists($lockFile);
}

function shadowBuildPass1Command($sourceFile, $outputFile, $probe, $audioMode, $buildProfile, $logFile)
{
    $audioRealign = ($buildProfile === 'mp4' && $audioMode === 'aac' && shadowProbeNeedsAudioRealign($probe));
    $command = FFMPEG_PATH
        . ' -y -nostdin -hide_banner -loglevel warning'
        . ' -fflags +genpts+discardcorrupt+igndts'
        . ' -err_detect ignore_err';

    if ($audioRealign) {
        $command .= ' -i ' . escapeshellarg($sourceFile)
            . ' -itsoffset ' . sprintf('%.3f', $probe['av_start_delta'])
            . ' -i ' . escapeshellarg($sourceFile)
            . ' -t 59'
            . ' -map 0:v:0? -map 1:a:0?';
    } else {
        $command .= ' -i ' . escapeshellarg($sourceFile)
            . ' -t 59'
            . ' -map 0:v:0? -map 0:a:0?';
    }

    if ($probe['has_video']) {
        $command .= ' -c:v copy';
        if ($buildProfile === 'ts' && $probe['video_codec'] === 'h264') {
            $command .= ' -bsf:v h264_mp4toannexb';
        }
    } else {
        $command .= ' -vn';
    }

    if ($probe['has_audio']) {
        if ($audioMode === 'copy') {
            $command .= ' -c:a copy';
        } else {
            $command .= ' -c:a aac -profile:a aac_low -b:a 128k -ac 2 -ar 48000';
        }
    } else {
        $command .= ' -an';
    }

    $command .= ' -avoid_negative_ts make_zero'
        . ' -max_interleave_delta 0'
        . ' -muxdelay 0 -muxpreload 0'
        . ' -max_muxing_queue_size 2048';

    if ($buildProfile === 'ts') {
        $command .= ' -copyinkf'
            . ' -mpegts_flags +pat_pmt_at_frames+resend_headers'
            . ' -f mpegts ' . escapeshellarg($outputFile);
    } else {
        $command .= ' -movflags +faststart'
            . ' -f mp4 ' . escapeshellarg($outputFile);
    }

    $command .= ' 2>>' . escapeshellarg($logFile);

    return $command;
}

function shadowProbeNeedsLeadGapFix($probe)
{
    return (
        $probe['has_video']
        && $probe['has_audio']
        && ($probe['video_start_time'] - $probe['audio_start_time']) >= 0.5
    );
}

function shadowBuildCleanMp4LeadFixCommand($inputFile, $outputFile, $probe, $audioMode, $logFile)
{
    $audioOffset = max(0.0, $probe['video_start_time'] - $probe['audio_start_time']);
    $command = FFMPEG_PATH
        . ' -y -nostdin -hide_banner -loglevel warning'
        . ' -i ' . escapeshellarg($inputFile)
        . ' -itsoffset ' . sprintf('%.3f', $audioOffset)
        . ' -i ' . escapeshellarg($inputFile)
        . ' -map 0:v:0? -map 1:a:0?';

    if ($probe['has_video']) {
        $command .= ' -c:v copy';
    } else {
        $command .= ' -vn';
    }

    if ($probe['has_audio']) {
        if ($audioMode === 'copy' && !empty($probe['audio_copy_safe'])) {
            $command .= ' -c:a copy';
        } else {
            $command .= ' -c:a aac -profile:a aac_low -b:a 128k -ac 2 -ar 48000';
        }
    } else {
        $command .= ' -an';
    }

    $command .= ' -avoid_negative_ts make_zero'
        . ' -max_interleave_delta 0'
        . ' -muxdelay 0 -muxpreload 0'
        . ' -max_muxing_queue_size 2048'
        . ' -movflags +faststart'
        . ' -f mp4 ' . escapeshellarg($outputFile)
        . ' 2>>' . escapeshellarg($logFile);

    return $command;
}

function shadowMaybeFixCleanMp4LeadGap($cleanFile, $audioMode, $logFile)
{
    $cleanProbe = shadowProbeMedia($cleanFile);
    if (!shadowProbeNeedsLeadGapFix($cleanProbe)) {
        return;
    }

    @file_put_contents(
        $logFile,
        'lead_gap_fix start file=' . basename($cleanFile)
            . ' delta=' . sprintf('%.3f', $cleanProbe['video_start_time'] - $cleanProbe['audio_start_time'])
            . "\n",
        FILE_APPEND
    );

    $fixedFile = $cleanFile . '.leadfix.mp4';
    @unlink($fixedFile);

    $command = shadowBuildCleanMp4LeadFixCommand($cleanFile, $fixedFile, $cleanProbe, $audioMode, $logFile);
    exec($command, $output, $returnCode);

    if ($returnCode !== 0 || !file_exists($fixedFile) || filesize($fixedFile) === 0) {
        @unlink($fixedFile);
        return;
    }

    $fixedProbe = shadowProbeMedia($fixedFile);
    if (!$fixedProbe['has_video'] || !$fixedProbe['has_audio']) {
        @unlink($fixedFile);
        return;
    }

    $originalDelta = max(0.0, $cleanProbe['video_start_time'] - $cleanProbe['audio_start_time']);
    $fixedDelta = max(0.0, $fixedProbe['video_start_time'] - $fixedProbe['audio_start_time']);
    if ($fixedDelta >= $originalDelta) {
        @unlink($fixedFile);
        return;
    }

    if (!@rename($fixedFile, $cleanFile)) {
        @copy($fixedFile, $cleanFile);
        @unlink($fixedFile);
    }

    @file_put_contents(
        $logFile,
        'lead_gap_fix done file=' . basename($cleanFile)
            . ' delta=' . sprintf('%.3f', $fixedDelta)
            . "\n",
        FILE_APPEND
    );
}

function shadowBuildHlsCommand($concatFile, $playlistFile, $cacheDir, $probe, $buildProfile, $logFile)
{
    $command = FFMPEG_PATH
        . ' -y -nostdin -hide_banner -loglevel warning'
        . ' -fflags +genpts'
        . ' -f concat -safe 0 -i ' . escapeshellarg($concatFile)
        . ' -map 0:v:0? -map 0:a:0?'
        . ' -c copy';

    if ($buildProfile === 'ts') {
        $command .= ' -copyinkf';
    }

    $command .= ' -avoid_negative_ts make_zero'
        . ' -max_interleave_delta 0'
        . ' -muxdelay 0 -muxpreload 0'
        . ' -max_muxing_queue_size 2048'
        . ' -f hls'
        . ' -hls_time 6'
        . ' -hls_list_size 0'
        . ' -hls_playlist_type vod'
        . ' -start_number 0';

    if ($buildProfile === 'ts') {
        $command .= ' -mpegts_flags +pat_pmt_at_frames+resend_headers'
            . ' -hls_segment_type mpegts'
            . ' -hls_segment_filename ' . escapeshellarg($cacheDir . '/seg_%05d.ts');
    } else {
        $command .= ' -hls_segment_type fmp4'
            . ' -hls_fmp4_init_filename init.mp4'
            . ' -hls_segment_filename ' . escapeshellarg($cacheDir . '/seg_%05d.m4s');
    }

    $command .= ' ' . escapeshellarg($playlistFile)
        . ' 2>' . escapeshellarg($logFile);

    return $command;
}

function shadowBuildMinuteFmp4Playlist($inputFile, $partDir, $logFile)
{
    shadowRemoveTree($partDir);
    @mkdir($partDir, 0755, true);

    $playlistFile = $partDir . '/playlist.m3u8';
    $command = FFMPEG_PATH
        . ' -y -nostdin -hide_banner -loglevel warning'
        . ' -i ' . escapeshellarg($inputFile)
        . ' -map 0:v:0? -map 0:a:0?'
        . ' -c copy'
        . ' -avoid_negative_ts make_zero'
        . ' -max_interleave_delta 0'
        . ' -muxdelay 0 -muxpreload 0'
        . ' -max_muxing_queue_size 2048'
        . ' -f hls'
        . ' -hls_time 6'
        . ' -hls_list_size 0'
        . ' -hls_playlist_type vod'
        . ' -start_number 0'
        . ' -hls_segment_type fmp4'
        . ' -hls_fmp4_init_filename init.mp4'
        . ' -hls_segment_filename ' . escapeshellarg($partDir . '/seg_%05d.m4s')
        . ' ' . escapeshellarg($playlistFile)
        . ' 2>>' . escapeshellarg($logFile);

    exec($command, $output, $returnCode);

    return ($returnCode === 0 && file_exists($playlistFile)) ? $playlistFile : false;
}

function shadowBuildStitchedFmp4Playlist($cleanFiles, $cacheDir, $playlistFile, $logFile)
{
    foreach (glob($cacheDir . '/part_*') as $partPath) {
        if (is_dir($partPath)) {
            shadowRemoveTree($partPath);
        }
    }

    shadowRemoveGlob($cacheDir . '/seg_*.m4s');
    shadowRemoveGlob($cacheDir . '/init*.mp4');
    @unlink($playlistFile);

    $mergedLines = array();
    $successfulParts = 0;
    $segmentIndex = 0;
    $targetDuration = 1;

    foreach ($cleanFiles as $fileIndex => $cleanFile) {
        $partDir = $cacheDir . '/part_' . sprintf('%04d', $fileIndex);
        $partPlaylist = shadowBuildMinuteFmp4Playlist($cleanFile, $partDir, $logFile);
        if ($partPlaylist === false) {
            continue;
        }

        $partLines = file($partPlaylist, FILE_IGNORE_NEW_LINES);
        if ($partLines === false) {
            shadowRemoveTree($partDir);
            continue;
        }

        $partOutput = array();
        $partHasSegments = false;
        $partInitSeen = false;
        $initName = ($successfulParts === 0)
            ? 'init.mp4'
            : 'init_' . sprintf('%04d', $successfulParts) . '.mp4';

        foreach ($partLines as $line) {
            if (preg_match('/^#EXT-X-TARGETDURATION:(\d+)/', $line, $matches)) {
                $targetDuration = max($targetDuration, intval($matches[1]));
                continue;
            }

            if (
                strpos($line, '#EXTM3U') === 0
                || strpos($line, '#EXT-X-VERSION') === 0
                || strpos($line, '#EXT-X-MEDIA-SEQUENCE') === 0
                || strpos($line, '#EXT-X-PLAYLIST-TYPE') === 0
                || strpos($line, '#EXT-X-ENDLIST') === 0
            ) {
                continue;
            }

            if ($line === '#EXT-X-MAP:URI="init.mp4"') {
                $initSource = $partDir . '/init.mp4';
                if (file_exists($initSource) && filesize($initSource) > 0) {
                    if (!@rename($initSource, $cacheDir . '/' . $initName)) {
                        @copy($initSource, $cacheDir . '/' . $initName);
                        @unlink($initSource);
                    }
                    $partOutput[] = '#EXT-X-MAP:URI="' . $initName . '"';
                    $partInitSeen = true;
                }
                continue;
            }

            if (preg_match('/^seg_\d+\.m4s$/', $line)) {
                $segmentSource = $partDir . '/' . $line;
                if (!file_exists($segmentSource) || filesize($segmentSource) === 0) {
                    continue;
                }

                $segmentName = 'seg_' . sprintf('%05d', $segmentIndex) . '.m4s';
                $segmentIndex++;
                if (!@rename($segmentSource, $cacheDir . '/' . $segmentName)) {
                    @copy($segmentSource, $cacheDir . '/' . $segmentName);
                    @unlink($segmentSource);
                }
                $partOutput[] = $segmentName;
                $partHasSegments = true;
                continue;
            }

            $partOutput[] = $line;
        }

        shadowRemoveTree($partDir);

        if (!$partHasSegments || !$partInitSeen) {
            continue;
        }

        if ($successfulParts > 0) {
            $mergedLines[] = '#EXT-X-DISCONTINUITY';
        }

        $mergedLines = array_merge($mergedLines, $partOutput);
        $successfulParts++;
    }

    if ($successfulParts === 0 || empty($mergedLines)) {
        return false;
    }

    $finalLines = array(
        '#EXTM3U',
        '#EXT-X-VERSION:7',
        '#EXT-X-TARGETDURATION:' . max(1, $targetDuration),
        '#EXT-X-MEDIA-SEQUENCE:0',
        '#EXT-X-PLAYLIST-TYPE:VOD'
    );
    $finalLines = array_merge($finalLines, $mergedLines, array('#EXT-X-ENDLIST'));

    file_put_contents($playlistFile, implode("\n", $finalLines) . "\n");

    return file_exists($playlistFile);
}

function shadowProbeSegmentDuration($segmentFile)
{
    $command = FFPROBE_PATH
        . ' -v error -show_entries format=duration'
        . ' -of default=noprint_wrappers=1:nokey=1 '
        . escapeshellarg($segmentFile) . ' 2>/dev/null';
    $duration = trim((string) @shell_exec($command));
    if ($duration === '') {
        return 0.0;
    }

    return (float) $duration;
}

function shadowNormalizePlaylistDurations($playlistFile, $cacheDir)
{
    if (!file_exists($playlistFile)) {
        return false;
    }

    $lines = file($playlistFile, FILE_IGNORE_NEW_LINES);
    if ($lines === false) {
        return false;
    }

    $updated = false;
    $maxDuration = 0.0;

    for ($index = 0; $index < count($lines); $index++) {
        if (!preg_match('/^#EXTINF:([0-9.]+)/', $lines[$index], $matches)) {
            continue;
        }

        $duration = (float) $matches[1];
        $segmentLine = isset($lines[$index + 1]) ? $lines[$index + 1] : '';

        if ($duration < 0.5 && preg_match('/^seg_\d+\.ts$/', $segmentLine)) {
            $realDuration = shadowProbeSegmentDuration($cacheDir . '/' . $segmentLine);
            if ($realDuration >= 0.5) {
                $duration = $realDuration;
                $lines[$index] = '#EXTINF:' . sprintf('%.6f', $realDuration) . ',';
                $updated = true;
            }
        }

        if ($duration > $maxDuration) {
            $maxDuration = $duration;
        }
    }

    $targetDuration = max(1, (int) ceil($maxDuration));
    for ($index = 0; $index < count($lines); $index++) {
        if (preg_match('/^#EXT-X-TARGETDURATION:(\d+)/', $lines[$index], $matches)) {
            if ((int) $matches[1] !== $targetDuration) {
                $lines[$index] = '#EXT-X-TARGETDURATION:' . $targetDuration;
                $updated = true;
            }
            break;
        }
    }

    if ($updated) {
        file_put_contents($playlistFile, implode("\n", $lines) . "\n");
    }

    return true;
}

function shadowPlaylistDecodeErrors($playlistFile, $seekSeconds = null)
{
    if (!file_exists($playlistFile)) {
        return true;
    }

    $command = 'cd ' . escapeshellarg(dirname($playlistFile)) . ' && '
        . FFMPEG_PATH
        . ' -analyzeduration 100M -probesize 100M -v warning'
        . ' -i ' . escapeshellarg(basename($playlistFile));

    if ($seekSeconds !== null) {
        $command .= ' -ss ' . intval($seekSeconds);
    }

    $command .= ' -map 0:v:0 -frames:v 5 -f null - 2>&1';
    $output = (string) @shell_exec($command);

    return (bool) preg_match(
        '/non-existing PPS|decode_slice_header error|no frame!|Could not find codec parameters|Cannot determine format of input stream/i',
        $output
    );
}

function shadowTsPlaylistNeedsFallback($playlistFile, $expectedMinutes)
{
    if (shadowPlaylistDecodeErrors($playlistFile, null)) {
        return true;
    }

    if ($expectedMinutes >= 2 && shadowPlaylistDecodeErrors($playlistFile, 58)) {
        return true;
    }

    return false;
}

function shadowGenerateHls($archiveFiles, $cacheDir, $playlistFile, $probe, $audioMode, $buildProfile)
{
    $logFile = $cacheDir . '/ffmpeg_' . $buildProfile . '_' . $audioMode . '.log';
    $cleanDir = $cacheDir . '/clean_' . $buildProfile . '_' . $audioMode;
    $concatFile = $cacheDir . '/concat_' . $buildProfile . '_' . $audioMode . '.txt';
    $cleanExtension = ($buildProfile === 'mp4') ? '.mp4' : '.ts';

    @mkdir($cleanDir, 0755, true);
    shadowRemoveGlob($cleanDir . '/*' . $cleanExtension);
    shadowRemoveGlob($cacheDir . '/seg_*.ts');
    shadowRemoveGlob($cacheDir . '/seg_*.m4s');
    @unlink($playlistFile);
    @unlink($cacheDir . '/init.mp4');
    @unlink($concatFile);

    $cleanFiles = array();
    foreach ($archiveFiles as $index => $archiveFile) {
        $cleanFile = $cleanDir . '/c' . sprintf('%04d', $index) . $cleanExtension;
        $fileProbe = shadowProbeMedia($archiveFile);
        if (empty($fileProbe['has_video']) && empty($fileProbe['has_audio'])) {
            $fileProbe = $probe;
        }
        $command = shadowBuildPass1Command($archiveFile, $cleanFile, $fileProbe, $audioMode, $buildProfile, $logFile);
        exec($command, $output, $returnCode);
        if ($returnCode === 0 && file_exists($cleanFile) && filesize($cleanFile) > 0) {
            if ($buildProfile === 'mp4') {
                shadowMaybeFixCleanMp4LeadGap($cleanFile, $audioMode, $logFile);
            }
            $cleanFiles[] = $cleanFile;
        }
    }

    if (empty($cleanFiles)) {
        return false;
    }

    if ($buildProfile === 'mp4') {
        $result = shadowBuildStitchedFmp4Playlist($cleanFiles, $cacheDir, $playlistFile, $logFile);
        shadowRemoveGlob($cleanDir . '/*' . $cleanExtension);
        @rmdir($cleanDir);
        @unlink($concatFile);
        return $result;
    }

    $concatContent = '';
    foreach ($cleanFiles as $cleanFile) {
        $concatContent .= "file '" . str_replace("'", "'\\''", $cleanFile) . "'\n";
    }
    file_put_contents($concatFile, $concatContent);

    $command = shadowBuildHlsCommand($concatFile, $playlistFile, $cacheDir, $probe, $buildProfile, $logFile);
    exec($command, $output, $returnCode);

    @unlink($concatFile);
    shadowRemoveGlob($cleanDir . '/*' . $cleanExtension);
    @rmdir($cleanDir);

    return ($returnCode === 0 && file_exists($playlistFile));
}

function shadowPlaylistStats($playlistFile)
{
    $stats = array(
        'target_duration' => 0.0,
        'segment_count' => 0,
        'total_duration' => 0.0,
        'min_duration' => null,
        'max_duration' => 0.0,
        'tiny_segments' => 0
    );

    if (!file_exists($playlistFile)) {
        return $stats;
    }

    foreach (file($playlistFile, FILE_IGNORE_NEW_LINES) as $line) {
        if (preg_match('/^#EXT-X-TARGETDURATION:(\d+)/', $line, $matches)) {
            $stats['target_duration'] = (float) $matches[1];
            continue;
        }

        if (preg_match('/^#EXTINF:([0-9.]+)/', $line, $matches)) {
            $duration = (float) $matches[1];
            $stats['segment_count']++;
            $stats['total_duration'] += $duration;
            $stats['max_duration'] = max($stats['max_duration'], $duration);
            $stats['min_duration'] = ($stats['min_duration'] === null)
                ? $duration
                : min($stats['min_duration'], $duration);

            if ($duration < 0.5) {
                $stats['tiny_segments']++;
            }
        }
    }

    return $stats;
}

function shadowPlaylistLooksBroken($playlistFile, $expectedMinutes)
{
    if (!file_exists($playlistFile)) {
        return true;
    }

    $stats = shadowPlaylistStats($playlistFile);
    if ($stats['segment_count'] === 0) {
        return true;
    }

    if ($stats['max_duration'] < 1.0) {
        return true;
    }

    if ($stats['target_duration'] >= 4.0 && $stats['max_duration'] < max(1.0, ($stats['target_duration'] / 3.0))) {
        return true;
    }

    if ($stats['tiny_segments'] >= max(2, (int) floor($stats['segment_count'] / 4))) {
        return true;
    }

    if ($expectedMinutes > 0) {
        $expectedSeconds = max(1, $expectedMinutes * 59);
        if ($stats['total_duration'] < min(30.0, $expectedSeconds * 0.15)) {
            return true;
        }
    }

    return false;
}

function shadowEnsurePlayableHls($requestedSource, $streamId, $startTimestamp, $duration)
{
    // HARDENING (sampled cache GC): keep /tmp from filling under sustained load.
    shadowMaybeGarbageCollect();

    $sources = array($requestedSource);
    if ($requestedSource === 'shadow') {
        $sources[] = 'live';
    }

    $foundArchive = false;

    foreach (array_values(array_unique($sources)) as $source) {
        $archiveRoot = shadowArchiveRoot($source);
        $archiveFiles = shadowCollectArchiveFiles($archiveRoot, $streamId, $startTimestamp, $duration);

        if (empty($archiveFiles)) {
            shadowLog('archive miss stream=' . $streamId . ' start=' . $startTimestamp . ' duration=' . $duration . ' source=' . $source);
            continue;
        }

        $foundArchive = true;
        shadowLog('archive ok stream=' . $streamId . ' files=' . count($archiveFiles) . ' source=' . $source);

        $cacheKey = implode('_', array(
            $source,
            SHADOW_BUILD_VERSION,
            $streamId,
            $startTimestamp,
            $duration
        ));
        $cacheDir = SHADOW_CACHE_ROOT . $cacheKey;
        $playlistFile = $cacheDir . '/playlist.m3u8';
        $lockFile = $cacheDir . '/remux.lock';

        @mkdir($cacheDir, 0755, true);

        $playlistBroken = shadowPlaylistLooksBroken($playlistFile, $duration);
        $needsBuild = !file_exists($playlistFile) || (time() - filemtime($playlistFile)) > 300 || $playlistBroken;

        if ($needsBuild) {
            if ($playlistBroken && file_exists($playlistFile)) {
                shadowLog('playlist rejected stream=' . $streamId . ' start=' . $startTimestamp . ' source=' . $source);
            }

            if (file_exists($lockFile) && (time() - filemtime($lockFile)) < 300) {
                shadowWaitForBuildLock($lockFile, $playlistFile, 120);
            } else {
                // HARDENING (concurrency cap): only NEW transcode builds are capped.
                // Cache hits and in-progress lock waits above are unaffected, so this
                // never throttles already-built segments — only protects CPU when too
                // many fresh transcodes would start at once under beta load.
                if (shadowActiveBuildCount() >= SHADOW_MAX_CONCURRENT_BUILDS) {
                    shadowLog(
                        'build deferred (concurrency cap) stream=' . $streamId
                        . ' start=' . $startTimestamp
                        . ' active=' . shadowActiveBuildCount()
                        . ' cap=' . SHADOW_MAX_CONCURRENT_BUILDS
                    );
                    header('HTTP/1.1 503 Service Unavailable');
                    header('Retry-After: 5');
                    die;
                }

                file_put_contents($lockFile, getmypid());

                $probe = shadowProbeMedia($archiveFiles[0]);
                $audioModes = array();
                if ($probe['has_audio'] && $probe['audio_copy_safe']) {
                    $audioModes[] = 'copy';
                }
                $audioModes[] = 'aac';

                $buildOk = false;
                $buildProfiles = shadowStreamPrefersMp4($streamId, $probe) ? array('mp4', 'ts') : array('ts', 'mp4');
                foreach ($buildProfiles as $buildProfile) {
                    $profileAudioModes = array_values(array_unique($audioModes));
                    if ($buildProfile === 'mp4' && shadowProbeNeedsAudioRealign($probe)) {
                        $profileAudioModes = array('aac');
                        if ($probe['audio_copy_safe']) {
                            $profileAudioModes[] = 'copy';
                        }
                    }

                    foreach ($profileAudioModes as $audioMode) {
                        shadowLog(
                            'shadow build stream=' . $streamId
                            . ' start=' . $startTimestamp
                            . ' source=' . $source
                            . ' profile=' . $buildProfile
                            . ' audio=' . $audioMode
                            . ' av_delta=' . sprintf('%.3f', $probe['av_start_delta'])
                        );

                        $buildOk = shadowGenerateHls($archiveFiles, $cacheDir, $playlistFile, $probe, $audioMode, $buildProfile);
                        if (!$buildOk) {
                            continue;
                        }

                        $rawBroken = shadowPlaylistLooksBroken($playlistFile, $duration);
                        if ($buildProfile === 'ts' && $rawBroken) {
                            $buildOk = false;
                            shadowLog(
                                'shadow build rejected stream=' . $streamId
                                . ' start=' . $startTimestamp
                                . ' source=' . $source
                                . ' profile=' . $buildProfile
                                . ' reason=raw_playlist'
                            );
                            continue;
                        }

                        if ($buildProfile === 'ts') {
                            shadowNormalizePlaylistDurations($playlistFile, $cacheDir);
                        }

                        if ($buildProfile === 'ts' && shadowTsPlaylistNeedsFallback($playlistFile, $duration)) {
                            $buildOk = false;
                            shadowLog(
                                'shadow build rejected stream=' . $streamId
                                . ' start=' . $startTimestamp
                                . ' source=' . $source
                                . ' profile=' . $buildProfile
                                . ' reason=decode_fallback'
                            );
                            continue;
                        }

                        if (!shadowPlaylistLooksBroken($playlistFile, $duration)) {
                            break 2;
                        }

                        $buildOk = false;
                        shadowLog(
                            'shadow build rejected stream=' . $streamId
                            . ' start=' . $startTimestamp
                            . ' source=' . $source
                            . ' profile=' . $buildProfile
                            . ' reason=normalized_playlist'
                        );
                    }
                }

                @unlink($lockFile);

                if (!$buildOk) {
                    shadowLog('shadow build failed stream=' . $streamId . ' start=' . $startTimestamp . ' source=' . $source);
                    continue;
                }
            }
        }

        if (!file_exists($playlistFile)) {
            continue;
        }

        if (shadowPlaylistLooksBroken($playlistFile, $duration)) {
            shadowLog('playlist still broken stream=' . $streamId . ' start=' . $startTimestamp . ' source=' . $source);
            continue;
        }

        return array(
            'ok' => true,
            'source' => $source,
            'archive_files' => $archiveFiles,
            'cache_dir' => $cacheDir,
            'playlist_file' => $playlistFile,
            'lock_file' => $lockFile
        );
    }

    return array(
        'ok' => false,
        'status' => $foundArchive ? 'build_failed' : 'archive_missing'
    );
}

function shadowSegmentUrl($request, $segmentToken)
{
    if ($request['is_token']) {
        $params = array(
            'token' => $request['raw_token'],
            'seg' => $segmentToken
        );
        if ($request['archive_source'] === 'shadow') {
            $params['archive_source'] = 'shadow';
        }
        return '/streaming/timeshift_shadow.php?' . http_build_query($params);
    }

    $params = array(
        'username' => $request['username'],
        'password' => $request['password'],
        'duration' => $request['duration'],
        'start' => $request['start'],
        'stream' => $request['stream_id'],
        'extension' => 'm3u8',
        'seg' => $segmentToken
    );
    if (!empty($request['play_token'])) {
        $params['play_token'] = $request['play_token'];
    }
    if ($request['archive_source'] === 'shadow') {
        $params['archive_source'] = 'shadow';
    }

    return '/streaming/timeshift_shadow.php?' . http_build_query($params);
}

$request = shadowGetRequest();

if (empty($request['stream_id']) || empty($request['start']) || empty($request['duration'])) {
    header('HTTP/1.1 400 Bad Request');
    die('Missing parameters.');
}

$shadowStreamId = $request['stream_id'];
$shadowUserAgent = empty($_SERVER['HTTP_USER_AGENT']) ? '' : htmlentities(trim($_SERVER['HTTP_USER_AGENT']));
$shadowExternalDevice = $request['is_token'] ? $request['token_external_device'] : '';

if ($request['is_token']) {
    $shadowUserIp = shadowResolveTokenUserIp($request);
    if (empty($shadowUserIp)) {
        shadowLog('token hash mismatch stream=' . $shadowStreamId . ' user_id=' . $request['user_id']);
        header('HTTP/1.1 403 Forbidden');
        die;
    }
    if (!shadowTokenStillValid($request)) {
        shadowLog('token expired stream=' . $shadowStreamId . ' user_id=' . $request['user_id']);
        header('HTTP/1.1 403 Forbidden');
        die;
    }
    $shadowGeoipCountryCode = !empty($request['token_country']) ? $request['token_country'] : shadowGetGeoCountryCode($shadowUserIp);
} else {
    $shadowUserIp = shadowGetUserIP();
    $shadowGeoipCountryCode = shadowGetGeoCountryCode($shadowUserIp);
}

shadowLog('auth begin stream=' . $shadowStreamId . ' token=' . intval($request['is_token']) . ' user_id=' . $request['user_id'] . ' ip=' . $shadowUserIp . ' geo=' . $shadowGeoipCountryCode);

if ($request['is_token']) {
    $shadowUserInfo = shadowGetUserInfo(
        empty($request['user_id']) ? null : $request['user_id'],
        null,
        null,
        true,
        true,
        false,
        false
    );
} else {
    $shadowUserInfo = shadowGetUserInfo(
        empty($request['user_id']) ? null : $request['user_id'],
        $request['username'],
        $request['password'],
        true,
        false,
        true,
        array(),
        false,
        $shadowUserIp,
        $shadowUserAgent,
        array(),
        $request['play_token'],
        $shadowStreamId
    );
}

if (!$shadowUserInfo) {
    shadowLog('auth failed stream=' . $shadowStreamId . ' user=' . $request['username'] . ' user_id=' . $request['user_id']);
    header('HTTP/1.1 403 Forbidden');
    die;
}

if ($request['is_token']) {
    if (!empty($request['username']) && isset($shadowUserInfo['username']) && $shadowUserInfo['username'] !== $request['username']) {
        shadowLog('token username mismatch stream=' . $shadowStreamId . ' user_id=' . $request['user_id']);
        header('HTTP/1.1 403 Forbidden');
        die;
    }
    if (!empty($request['password']) && isset($shadowUserInfo['password']) && $shadowUserInfo['password'] !== $request['password']) {
        shadowLog('token password mismatch stream=' . $shadowStreamId . ' user_id=' . $request['user_id']);
        header('HTTP/1.1 403 Forbidden');
        die;
    }
}

$shadowConnectionIsp = $request['is_token'] && !empty($request['token_isp'])
    ? $request['token_isp']
    : (empty($shadowUserInfo['con_isp_name']) ? '' : $shadowUserInfo['con_isp_name']);
shadowLog('auth ok stream=' . $shadowStreamId . ' user_id=' . $shadowUserInfo['id'] . ' isp=' . $shadowConnectionIsp);

if (isset($shadowUserInfo['mag_invalid_token'])) {
    shadowClientLog($shadowStreamId, $shadowUserInfo['id'], 'MAG_TOKEN_INVALID', $shadowUserIp);
    die;
}

if (!is_null($shadowUserInfo['exp_date']) && time() >= $shadowUserInfo['exp_date']) {
    shadowClientLog($shadowStreamId, $shadowUserInfo['id'], 'USER_EXPIRED', $shadowUserIp);
    shadowShowVideo($shadowUserInfo['is_restreamer'], 'show_expired_video', 'expired_video_path');
    die;
}

if ($shadowUserInfo['admin_enabled'] == 0) {
    shadowClientLog($shadowStreamId, $shadowUserInfo['id'], 'USER_BAN', $shadowUserIp);
    shadowShowVideo($shadowUserInfo['is_restreamer'], 'show_banned_video', 'banned_video_path');
    die;
}

if ($shadowUserInfo['enabled'] == 0) {
    shadowClientLog($shadowStreamId, $shadowUserInfo['id'], 'USER_DISABLED', $shadowUserIp);
    shadowShowVideo($shadowUserInfo['is_restreamer'], 'show_banned_video', 'banned_video_path');
    die;
}

if (empty($shadowUserAgent) && ipTV_lib::$settings['disallow_empty_user_agents'] == 1) {
    shadowClientLog($shadowStreamId, $shadowUserInfo['id'], 'EMPTY_UA', $shadowUserIp);
    die;
}

if (!empty($shadowUserInfo['allowed_ips']) && !in_array($shadowUserIp, array_map('gethostbyname', $shadowUserInfo['allowed_ips']))) {
    shadowClientLog($shadowStreamId, $shadowUserInfo['id'], 'IP_BAN', $shadowUserIp);
    die;
}

if (!empty($shadowGeoipCountryCode)) {
    $forcedCountry = !empty($shadowUserInfo['forced_country']);
    if ($forcedCountry && $shadowUserInfo['forced_country'] != 'ALL' && $shadowGeoipCountryCode != $shadowUserInfo['forced_country']) {
        shadowClientLog($shadowStreamId, $shadowUserInfo['id'], 'COUNTRY_DISALLOW', $shadowUserIp);
        die;
    }
    if (!$forcedCountry && !in_array('ALL', ipTV_lib::$settings['allow_countries']) && !in_array($shadowGeoipCountryCode, ipTV_lib::$settings['allow_countries'])) {
        shadowClientLog($shadowStreamId, $shadowUserInfo['id'], 'COUNTRY_DISALLOW', $shadowUserIp);
        die;
    }
}

if (!empty($shadowUserInfo['allowed_ua']) && !in_array($shadowUserAgent, $shadowUserInfo['allowed_ua'])) {
    shadowClientLog($shadowStreamId, $shadowUserInfo['id'], 'USER_AGENT_BAN', $shadowUserIp);
    die;
}

if (!empty(STREAM_METHOD_CRACKED_IP) && shadowStreamingCall(STREAM_METHOD_CRACKED_IP, array($shadowUserIp))) {
    shadowClientLog($shadowStreamId, $shadowUserInfo['id'], 'CRACKED', $shadowUserIp);
    die;
}

if (isset($shadowUserInfo['ip_limit_reached'])) {
    shadowClientLog($shadowStreamId, $shadowUserInfo['id'], 'USER_ALREADY_CONNECTED', $shadowUserIp);
    die;
}

if (!in_array($shadowStreamId, $shadowUserInfo['channel_ids'])) {
    http_response_code(406);
    shadowClientLog($shadowStreamId, $shadowUserInfo['id'], 'NOT_IN_BOUQUET', $shadowUserIp);
    die;
}

if ($shadowUserInfo['max_connections'] != 0) {
    if (!empty($shadowUserInfo['pair_line_info']) && $shadowUserInfo['pair_line_info']['max_connections'] != 0) {
        if ($shadowUserInfo['pair_line_info']['active_cons'] >= $shadowUserInfo['pair_line_info']['max_connections']) {
            shadowCloseLastCon($shadowUserInfo['pair_id'], $shadowUserInfo['pair_line_info']['max_connections']);
        }
    }
    if ($shadowUserInfo['active_cons'] >= $shadowUserInfo['max_connections']) {
        shadowCloseLastCon($shadowUserInfo['id'], $shadowUserInfo['max_connections']);
    }
}

if ($shadowUserInfo['isp_violate'] == 1) {
    http_response_code(401);
    shadowClientLog(
        $shadowStreamId,
        $shadowUserInfo['id'],
        'ISP_LOCK_FAILED',
        $shadowUserIp,
        json_encode(array('old' => $shadowUserInfo['isp_desc'], 'new' => $shadowConnectionIsp))
    );
    die;
}

if ($shadowUserInfo['isp_is_server'] == 1) {
    shadowClientLog(
        $shadowStreamId,
        $shadowUserInfo['id'],
        'CON_SVP',
        $shadowUserIp,
        json_encode(array(
            'user_agent' => $shadowUserAgent,
            'isp' => $shadowConnectionIsp,
            'type' => $shadowUserInfo['con_isp_type']
        )),
        true
    );
    http_response_code(401);
    die;
}

$channelInfo = shadowStreamingCall(STREAM_METHOD_CHANNEL_CHECK, array(
    $shadowStreamId,
    'ts',
    $shadowUserInfo,
    $shadowUserIp,
    $shadowGeoipCountryCode,
    '',
    $shadowConnectionIsp,
    'archive'
));

if (empty($channelInfo)) {
    shadowLog('channel check failed stream=' . $shadowStreamId . ' user_id=' . $shadowUserInfo['id']);
    http_response_code(403);
    die;
}

shadowLog('channel check ok stream=' . $shadowStreamId . ' user_id=' . $shadowUserInfo['id']);

$duration = intval($request['duration']);
$startTimestamp = shadowParseStartTimestamp($request['start'], $duration);

if (is_numeric($request['start'])) {
    $startTimestamp = shadowResolveNumericStart(
        shadowArchiveRoot($request['archive_source']),
        $shadowStreamId,
        $request['start']
    );
}

if (empty($shadowStreamId) || empty($startTimestamp) || empty($duration)) {
    header('HTTP/1.1 400 Bad Request');
    die;
}

// HARDENING (dynamic codec-map step-aside): if the cron-produced codec map says
// this stream is already browser-safe (AAC/MP3 audio + non-HEVC video), the shadow
// transcode is unnecessary — step aside with 409 so the Lumen client falls back to
// the normal (cheaper) catch-up path. 'unsafe'/'unknown' both keep building, so a
// channel whose source flips to MP2 is still served correctly (fail-open).
$shadowCodecStatus = shadowCodecMapStatus($shadowStreamId);
if ($shadowCodecStatus === 'safe') {
    shadowLog('codec map step-aside stream=' . $shadowStreamId . ' status=safe');
    header('HTTP/1.1 409 Conflict');
    die;
}

$playable = shadowEnsurePlayableHls($request['archive_source'], $shadowStreamId, $startTimestamp, $duration);
if (!$playable['ok']) {
    if ($playable['status'] === 'archive_missing') {
        header('HTTP/1.1 404 Not Found');
        die;
    }

    header('HTTP/1.1 500 Internal Server Error');
    die('Shadow remux failed.');
}

$request['archive_source'] = $playable['source'];
$archiveFiles = $playable['archive_files'];
$cacheDir = $playable['cache_dir'];
$playlistFile = $playable['playlist_file'];
$lockFile = $playable['lock_file'];

if (!empty($request['segment_token'])) {
    $segmentFile = $cacheDir . '/' . $request['segment_token'];
    if (!file_exists($segmentFile) && $request['segment_index'] !== null) {
        $legacyFile = $cacheDir . '/seg_' . sprintf('%05d', $request['segment_index']) . '.' . $request['segment_extension'];
        if (file_exists($legacyFile)) {
            $segmentFile = $legacyFile;
        }
    }
    $wait = 0;
    while (!file_exists($segmentFile) && file_exists($lockFile) && $wait < 60) {
        usleep(500000);
        $wait++;
        clearstatcache(true, $segmentFile);
        clearstatcache(true, $lockFile);
    }

    if (!file_exists($segmentFile)) {
        header('HTTP/1.1 404 Not Found');
        die;
    }

    $db = ipTV_lib::$ipTV_db;
    $db->query(
        'UPDATE `user_activity_now` SET `hls_last_read` = \'%d\' WHERE `user_id` = \'%d\' AND `server_id` = \'%d\' AND `container` = \'hls\' AND `stream_id` = \'%d\'',
        time(),
        $shadowUserInfo['id'],
        SERVER_ID,
        $shadowStreamId
    );

    header('Content-Type: ' . (($request['segment_extension'] === 'ts') ? 'video/mp2t' : 'video/mp4'));
    header('Content-Length: ' . filesize($segmentFile));
    header('Cache-Control: public, max-age=86400');
    readfile($segmentFile);
    die;
}

$db = ipTV_lib::$ipTV_db;
$db->query(
    'SELECT activity_id,hls_end FROM `user_activity_now` WHERE `user_id` = \'%d\' AND `server_id` = \'%d\' AND `container` = \'hls\' AND `user_ip` = \'%s\' AND `user_agent` = \'%s\' AND `stream_id` = \'%d\'',
    $shadowUserInfo['id'],
    SERVER_ID,
    $shadowUserIp,
    $shadowUserAgent,
    $shadowStreamId
);

if (shadowDbCall($db, DB_METHOD_NUM_ROWS) == 0) {
    if ($shadowUserInfo['max_connections'] != 0) {
        $db->query('UPDATE `user_activity_now` SET `hls_end` = 1 WHERE `user_id` = \'%d\' AND `container` = \'hls\'', $shadowUserInfo['id']);
    }
    $db->query(
        'INSERT INTO `user_activity_now` (`user_id`,`stream_id`,`server_id`,`user_agent`,`user_ip`,`container`,`pid`,`date_start`,`geoip_country_code`,`isp`,`external_device`,`hls_last_read`) VALUES(\'%d\',\'%d\',\'%d\',\'%s\',\'%s\',\'%s\',\'%d\',\'%d\',\'%s\',\'%s\',\'%s\',\'%d\')',
        $shadowUserInfo['id'],
        $shadowStreamId,
        SERVER_ID,
        $shadowUserAgent,
        $shadowUserIp,
        $shadowContainerPriority . ' (HLS Shadow)',
        getmypid(),
        $shadowDate,
        $shadowGeoipCountryCode,
        $shadowConnectionIsp,
        $shadowExternalDevice,
        $shadowDate
    );
    $shadowActivityId = shadowDbCall($db, DB_METHOD_LAST_ID);
} else {
    $row = shadowDbCall($db, DB_METHOD_GET_ROW);
    if ($row['hls_end'] == 1) {
        header($_SERVER['SERVER_PROTOCOL'] . ' 403 Forbidden', true, 403);
        die;
    }
    $shadowActivityId = $row['activity_id'];
    $db->query('UPDATE `user_activity_now` SET `hls_last_read` = \'%d\' WHERE `activity_id` = \'%d\'', time(), $shadowActivityId);
}

if (!file_exists($playlistFile)) {
    header('HTTP/1.1 503 Service Unavailable');
    header('Retry-After: 5');
    die;
}

$manifestLines = file($playlistFile, FILE_IGNORE_NEW_LINES);
$output = '';
$segmentIndex = 0;
$manifestFormat = 'ts';

foreach ($manifestLines as $line) {
    if (preg_match('/^#EXT-X-MAP:URI="([^"]+)"$/', $line, $matches)) {
        $manifestFormat = 'mp4';
        $output .= '#EXT-X-MAP:URI="' . shadowSegmentUrl($request, $matches[1]) . '"' . "\n";
    } elseif (preg_match('/^seg_\d+\.(ts|m4s)$/', $line, $matches)) {
        if (strtolower($matches[1]) === 'm4s') {
            $manifestFormat = 'mp4';
        }
        $output .= shadowSegmentUrl($request, $line) . "\n";
        $segmentIndex++;
    } else {
        $output .= $line . "\n";
    }
}

shadowLog(
    'manifest serve stream=' . $shadowStreamId
    . ' start=' . $startTimestamp
    . ' source=' . $request['archive_source']
    . ' format=' . $manifestFormat
);

header('Content-Type: application/vnd.apple.mpegurl');
header('Content-Length: ' . strlen($output));
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('Pragma: no-cache');
header('Expires: 0');
echo $output;
