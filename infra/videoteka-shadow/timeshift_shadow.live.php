<?php

error_reporting(0);
set_time_limit(0);
ignore_user_abort(true);

register_shutdown_function('shutdown');
register_shutdown_function('shadowCatchupShutdown');

require '../init.php';

define('SHADOW_TOKEN_KEY', 'REDACTED_SEE_SERVER_ENV'); // original value lives only on the server, not in git
define('SHADOW_ARCHIVE_ROOT', IPTV_PANEL_DIR . 'tv_archive_shadow/');
define('SHADOW_CACHE_ROOT', '/tmp/catchup_shadow_hls/');

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

$shadowActivityId = 0;
$shadowDate = time();
$shadowExternalDevice = '';
$shadowContainerPriority = 'TV Archive';
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

function shadowCatchupShutdown()
{
    global $shadowActivityId, $shadowUserInfo, $shadowStreamId, $shadowDate, $shadowUserAgent, $shadowUserIp;
    global $shadowGeoipCountryCode, $shadowExternalDevice, $shadowContainerPriority;

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
            $shadowUserInfo['con_isp_name'],
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

function shadowDecryptToken($data, $key)
{
    $i = 0;
    $output = '';

    foreach (str_split($data) as $char) {
        $output .= chr(ord($char) ^ ord($key[$i++ % strlen($key)]));
    }

    return $output;
}

function shadowGetRequest()
{
    $request = array(
        'username' => '',
        'password' => '',
        'stream' => '',
        'stream_id' => 0,
        'start' => '',
        'duration' => 0,
        'extension' => '',
        'play_token' => null,
        'segment_index' => null,
        'is_token' => false,
        'raw_token' => '',
        'archive_source' => empty($_GET['archive_source']) ? 'live' : strtolower(trim($_GET['archive_source']))
    );

    if (!empty($_GET['token'])) {
        $decoded = @json_decode(shadowDecryptToken(base64_decode($_GET['token']), SHADOW_TOKEN_KEY), true);
        if (!is_array($decoded) || empty($decoded['stream_id'])) {
            header('HTTP/1.1 403 Forbidden');
            die;
        }

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

        if (isset($_GET['seg'])) {
            $segment = preg_replace('/\.ts$/i', '', $_GET['seg']);
            $parts = explode('_', $segment);
            $request['segment_index'] = intval($parts[0]);
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
            $segment = preg_replace('/\.ts$/i', '', $_GET['seg']);
            $parts = explode('_', $segment);
            $request['segment_index'] = intval($parts[0]);
        }
    }

    if (!in_array($request['archive_source'], array('live', 'shadow'), true)) {
        $request['archive_source'] = 'live';
    }

    return $request;
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
        . ' -v error -show_entries stream=index,codec_type,codec_name,profile,sample_rate,channels'
        . ' -of json ' . escapeshellarg($inputFile);
    $json = @shell_exec($command);
    $data = @json_decode($json, true);

    $probe = array(
        'has_video' => false,
        'has_audio' => false,
        'video_codec' => '',
        'audio_codec' => '',
        'audio_profile' => '',
        'audio_sample_rate' => 0,
        'audio_channels' => 0,
        'audio_copy_safe' => false
    );

    if (empty($data['streams']) || !is_array($data['streams'])) {
        return $probe;
    }

    foreach ($data['streams'] as $stream) {
        if ($stream['codec_type'] === 'video' && !$probe['has_video']) {
            $probe['has_video'] = true;
            $probe['video_codec'] = empty($stream['codec_name']) ? '' : strtolower($stream['codec_name']);
        }

        if ($stream['codec_type'] === 'audio' && !$probe['has_audio']) {
            $probe['has_audio'] = true;
            $probe['audio_codec'] = empty($stream['codec_name']) ? '' : strtolower($stream['codec_name']);
            $probe['audio_profile'] = empty($stream['profile']) ? '' : strtoupper($stream['profile']);
            $probe['audio_sample_rate'] = empty($stream['sample_rate']) ? 0 : intval($stream['sample_rate']);
            $probe['audio_channels'] = empty($stream['channels']) ? 0 : intval($stream['channels']);
        }
    }

    if ($probe['has_audio'] && $probe['audio_codec'] === 'aac') {
        $profileSafe = ($probe['audio_profile'] === '' || strpos($probe['audio_profile'], 'LC') !== false);
        $rateSafe = in_array($probe['audio_sample_rate'], array(0, 44100, 48000), true);
        $probe['audio_copy_safe'] = ($profileSafe && $rateSafe);
    }

    return $probe;
}

function shadowRemoveGlob($pattern)
{
    foreach (glob($pattern) as $path) {
        @unlink($path);
    }
}

function shadowBuildPass1Command($sourceFile, $outputFile, $probe, $audioMode, $logFile)
{
    $command = FFMPEG_PATH
        . ' -y -nostdin -hide_banner -loglevel warning'
        . ' -fflags +genpts+discardcorrupt+igndts'
        . ' -err_detect ignore_err'
        . ' -i ' . escapeshellarg($sourceFile)
        . ' -t 59'
        . ' -map 0:v:0? -map 0:a:0?';

    if ($probe['has_video']) {
        $command .= ' -c:v copy';
        if ($probe['video_codec'] === 'h264') {
            $command .= ' -bsf:v h264_mp4toannexb';
        }
    }

    if ($probe['has_audio']) {
        if ($audioMode === 'copy') {
            $command .= ' -c:a copy';
        } else {
            $command .= ' -c:a aac -profile:a aac_low -b:a 128k -ac 2 -ar 48000';
        }
    }

    $command .= ' -copyinkf'
        . ' -avoid_negative_ts make_zero'
        . ' -max_interleave_delta 0'
        . ' -muxdelay 0 -muxpreload 0'
        . ' -max_muxing_queue_size 2048'
        . ' -mpegts_flags +pat_pmt_at_frames+resend_headers'
        . ' -f mpegts ' . escapeshellarg($outputFile)
        . ' 2>>' . escapeshellarg($logFile);

    return $command;
}

function shadowBuildHlsCommand($concatFile, $playlistFile, $cacheDir, $logFile)
{
    return FFMPEG_PATH
        . ' -y -nostdin -hide_banner -loglevel warning'
        . ' -fflags +genpts+igndts'
        . ' -f concat -safe 0 -i ' . escapeshellarg($concatFile)
        . ' -map 0:v:0? -map 0:a:0?'
        . ' -c copy'
        . ' -copyinkf'
        . ' -avoid_negative_ts make_zero'
        . ' -max_interleave_delta 0'
        . ' -muxdelay 0 -muxpreload 0'
        . ' -mpegts_flags +pat_pmt_at_frames+resend_headers'
        . ' -f hls'
        . ' -hls_time 6'
        . ' -hls_list_size 0'
        . ' -hls_playlist_type vod'
        . ' -hls_segment_type mpegts'
        . ' -start_number 0'
        . ' -hls_segment_filename ' . escapeshellarg($cacheDir . '/seg_%05d.ts')
        . ' ' . escapeshellarg($playlistFile)
        . ' 2>' . escapeshellarg($logFile);
}

function shadowGenerateHls($archiveFiles, $cacheDir, $playlistFile, $probe, $audioMode)
{
    $logFile = $cacheDir . '/ffmpeg_' . $audioMode . '.log';
    $cleanDir = $cacheDir . '/clean_' . $audioMode;
    $concatFile = $cacheDir . '/concat_' . $audioMode . '.txt';

    @mkdir($cleanDir, 0755, true);
    shadowRemoveGlob($cleanDir . '/*.ts');
    shadowRemoveGlob($cacheDir . '/seg_*.ts');
    @unlink($playlistFile);
    @unlink($concatFile);

    $cleanFiles = array();
    foreach ($archiveFiles as $index => $archiveFile) {
        $cleanFile = $cleanDir . '/c' . sprintf('%04d', $index) . '.ts';
        $command = shadowBuildPass1Command($archiveFile, $cleanFile, $probe, $audioMode, $logFile);
        exec($command, $output, $returnCode);
        if ($returnCode === 0 && file_exists($cleanFile) && filesize($cleanFile) > 0) {
            $cleanFiles[] = $cleanFile;
        }
    }

    if (empty($cleanFiles)) {
        return false;
    }

    $concatContent = '';
    foreach ($cleanFiles as $cleanFile) {
        $concatContent .= "file '" . str_replace("'", "'\\''", $cleanFile) . "'\n";
    }
    file_put_contents($concatFile, $concatContent);

    $command = shadowBuildHlsCommand($concatFile, $playlistFile, $cacheDir, $logFile);
    exec($command, $output, $returnCode);

    @unlink($concatFile);
    shadowRemoveGlob($cleanDir . '/*.ts');
    @rmdir($cleanDir);

    return ($returnCode === 0 && file_exists($playlistFile));
}

function shadowSegmentUrl($request, $segmentIndex)
{
    $segmentToken = $segmentIndex . '_0.ts';

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
$shadowUserIp = shadowGetUserIP();
$shadowUserAgent = empty($_SERVER['HTTP_USER_AGENT']) ? '' : htmlentities(trim($_SERVER['HTTP_USER_AGENT']));

$shadowGeoipCountryCode = shadowGetGeoCountryCode($shadowUserIp);

$shadowUserInfo = shadowGetUserInfo(
    null,
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

if (!$shadowUserInfo) {
    header('HTTP/1.1 403 Forbidden');
    die;
}

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
        json_encode(array('old' => $shadowUserInfo['isp_desc'], 'new' => $shadowUserInfo['con_isp_name']))
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
            'isp' => $shadowUserInfo['con_isp_name'],
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
    $shadowUserInfo['con_isp_name'],
    'archive'
));

if (empty($channelInfo)) {
    http_response_code(403);
    die;
}

$duration = intval($request['duration']);
$startTimestamp = shadowParseStartTimestamp($request['start'], $duration);
$archiveRoot = shadowArchiveRoot($request['archive_source']);

if (is_numeric($request['start'])) {
    $startTimestamp = shadowResolveNumericStart($archiveRoot, $shadowStreamId, $request['start']);
}

if (empty($shadowStreamId) || empty($startTimestamp) || empty($duration)) {
    header('HTTP/1.1 400 Bad Request');
    die;
}

$archiveFiles = shadowCollectArchiveFiles($archiveRoot, $shadowStreamId, $startTimestamp, $duration);
if (empty($archiveFiles)) {
    header('HTTP/1.1 404 Not Found');
    die;
}

$cacheKey = implode('_', array(
    $request['archive_source'],
    $shadowStreamId,
    $startTimestamp,
    $duration
));
$cacheDir = SHADOW_CACHE_ROOT . $cacheKey;
$playlistFile = $cacheDir . '/playlist.m3u8';
$lockFile = $cacheDir . '/remux.lock';

if ($request['segment_index'] !== null) {
    $segmentFile = $cacheDir . '/seg_' . sprintf('%05d', $request['segment_index']) . '.ts';
    $wait = 0;
    while (!file_exists($segmentFile) && file_exists($lockFile) && $wait < 60) {
        usleep(500000);
        $wait++;
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

    header('Content-Type: video/mp2t');
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

if ($db->num_rows() == 0) {
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
        $shadowUserInfo['con_isp_name'],
        $shadowExternalDevice,
        $shadowDate
    );
    $shadowActivityId = $db->last_insert_id();
} else {
    $row = $db->get_row();
    if ($row['hls_end'] == 1) {
        header($_SERVER['SERVER_PROTOCOL'] . ' 403 Forbidden', true, 403);
        die;
    }
    $shadowActivityId = $row['activity_id'];
    $db->query('UPDATE `user_activity_now` SET `hls_last_read` = \'%d\' WHERE `activity_id` = \'%d\'', time(), $shadowActivityId);
}

@mkdir($cacheDir, 0755, true);

$needsBuild = !file_exists($playlistFile) || (time() - filemtime($playlistFile)) > 300;
if ($needsBuild) {
    if (file_exists($lockFile) && (time() - filemtime($lockFile)) < 300) {
        $wait = 0;
        while (!file_exists($playlistFile) && $wait < 120) {
            usleep(500000);
            $wait++;
        }
    } else {
        file_put_contents($lockFile, getmypid());
        $probe = shadowProbeMedia($archiveFiles[0]);
        $audioMode = ($probe['has_audio'] && $probe['audio_copy_safe']) ? 'copy' : 'aac';
        shadowLog('shadow build stream=' . $shadowStreamId . ' start=' . $startTimestamp . ' source=' . $request['archive_source'] . ' audio=' . $audioMode);

        $buildOk = shadowGenerateHls($archiveFiles, $cacheDir, $playlistFile, $probe, $audioMode);
        if (!$buildOk && $audioMode === 'copy' && $probe['has_audio']) {
            shadowLog('shadow retry stream=' . $shadowStreamId . ' start=' . $startTimestamp . ' source=' . $request['archive_source'] . ' audio=aac');
            $buildOk = shadowGenerateHls($archiveFiles, $cacheDir, $playlistFile, $probe, 'aac');
        }

        @unlink($lockFile);

        if (!$buildOk) {
            header('HTTP/1.1 500 Internal Server Error');
            die('Shadow remux failed.');
        }
    }
}

if (!file_exists($playlistFile)) {
    header('HTTP/1.1 503 Service Unavailable');
    header('Retry-After: 5');
    die;
}

$manifestLines = file($playlistFile, FILE_IGNORE_NEW_LINES);
$output = '';
$segmentIndex = 0;

foreach ($manifestLines as $line) {
    if (preg_match('/^seg_\d+\.ts$/', $line)) {
        $output .= shadowSegmentUrl($request, $segmentIndex) . "\n";
        $segmentIndex++;
    } else {
        $output .= $line . "\n";
    }
}

header('Content-Type: application/vnd.apple.mpegurl');
header('Content-Length: ' . strlen($output));
header('Cache-Control: public, max-age=60');
echo $output;
