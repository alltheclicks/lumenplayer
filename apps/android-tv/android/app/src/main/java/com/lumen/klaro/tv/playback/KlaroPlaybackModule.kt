package com.lumen.klaro.tv.playback

import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.view.SurfaceView
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.facebook.react.module.annotations.ReactModule

/** RN's New Architecture interop hosts this app-local module. All player access is main-thread only. */
@ReactModule(name = "KlaroPlayback")
class KlaroPlaybackModule(private val context: ReactApplicationContext) :
  ReactContextBaseJavaModule(context), LifecycleEventListener {
  private val main = Handler(Looper.getMainLooper())
  private val sessions = mutableMapOf<String, Session>()
  private val surfaces = mutableMapOf<String, SurfaceView>()
  private var foreground = context.lifecycleState == com.facebook.react.common.LifecycleState.RESUMED
  @Volatile private var invalidated = false

  private inner class Session(val id: String, val generation: Double, val player: ExoPlayer) {
    var pending: Promise? = null
    var timeout: Runnable? = null
    var errorCode: String? = null
    var ready = false
    val listener = object : Player.Listener {
      override fun onEvents(player: Player, events: Player.Events) {
        if (sessions[id] !== this@Session) return
        if (player.playbackState == Player.STATE_READY) {
          ready = true
          timeout?.let(main::removeCallbacks)
          timeout = null
          pending?.resolve(null)
          pending = null
        }
        emit(this@Session)
      }
      override fun onPlayerError(error: PlaybackException) {
        if (sessions[id] !== this@Session) return
        // The exception/cause may contain credentials. Never send or log them.
        errorCode = "MEDIA3_${error.errorCode}"
        rejectPending(this@Session, "MEDIA3_LOAD_FAILED")
        emit(this@Session)
      }
    }
    val ticker = object : Runnable {
      override fun run() {
        if (sessions[id] !== this@Session) return
        emit(this@Session)
        main.postDelayed(this, 500)
      }
    }
  }

  init {
    // Media3 may log network Throwable causes containing URLs. Keep diagnostics code-only.
    androidx.media3.common.util.Log.setLogLevel(androidx.media3.common.util.Log.LOG_LEVEL_OFF)
    context.addLifecycleEventListener(this)
  }
  override fun getName() = "KlaroPlayback"
  @ReactMethod fun addListener(eventName: String) { /* Required by NativeEventEmitter. */ }
  @ReactMethod fun removeListeners(count: Double) { /* Subscribers are owned by JS adapters. */ }

  private fun onMain(promise: Promise, action: () -> Unit) {
    main.post {
      if (invalidated) { promise.reject("MEDIA3_UNAVAILABLE", "Playback unavailable"); return@post }
      try { action() } catch (_: Exception) {
        // Do not pass a Throwable to RN; native stack/cause strings can reveal media URLs.
        promise.reject("MEDIA3_OPERATION_FAILED", "Playback operation failed")
      }
    }
  }

  @ReactMethod fun load(id: String, generation: Double, url: String, type: String, promise: Promise) = onMain(promise) {
    val uri = Uri.parse(url)
    require(uri.scheme == "https" || uri.scheme == "http")
    require(!uri.host.isNullOrEmpty() && generation.isFinite() && generation >= 0)
    check(foreground) { "Playback requires foreground" }
    val mime = when (type) {
      "hls" -> MimeTypes.APPLICATION_M3U8
      "dash" -> MimeTypes.APPLICATION_MPD
      "mp4" -> MimeTypes.VIDEO_MP4
      else -> throw IllegalArgumentException("Unsupported media type")
    }
    // Release each old player rather than reusing its listeners for another generation.
    sessions.remove(id)?.let(::dispose)
    val player = ExoPlayer.Builder(context).setLooper(Looper.getMainLooper()).build()
    val session = Session(id, generation, player)
    sessions[id] = session
    session.pending = promise
    try {
      player.addListener(session.listener)
      player.setAudioAttributes(AudioAttributes.Builder().setUsage(C.USAGE_MEDIA)
        .setContentType(C.AUDIO_CONTENT_TYPE_MOVIE).build(), true)
      player.setHandleAudioBecomingNoisy(true)
      surfaces[id]?.let(player::setVideoSurfaceView)
      // URL is retained only by Media3 for this session. No persistence/metadata/logging.
      player.setMediaItem(MediaItem.Builder().setUri(uri).setMimeType(mime).build())
      session.timeout = Runnable {
        if (sessions[id] === session && session.pending != null) {
          session.errorCode = "MEDIA3_LOAD_TIMEOUT"
          rejectPending(session, "MEDIA3_LOAD_TIMEOUT")
          emit(session)
          sessions.remove(id)
          dispose(session)
        }
      }.also { main.postDelayed(it, 30_000) }
      main.post(session.ticker)
      player.prepare()
      player.play()
    } catch (_: Exception) {
      sessions.remove(id)
      dispose(session)
    }
  }

  private fun withSession(id: String, generation: Double, promise: Promise, action: (Session) -> Unit) = onMain(promise) {
    val session = sessions[id]
    if (session == null || session.generation != generation) {
      promise.reject("MEDIA3_STALE_SESSION", "Playback session is unavailable")
    } else {
      action(session)
      promise.resolve(null)
    }
  }
  @ReactMethod fun play(id: String, generation: Double, promise: Promise) = withSession(id, generation, promise) {
    check(foreground)
    it.player.play()
  }
  @ReactMethod fun pause(id: String, generation: Double, promise: Promise) = withSession(id, generation, promise) { it.player.pause() }
  @ReactMethod fun seek(id: String, generation: Double, positionMs: Double, promise: Promise) = withSession(id, generation, promise) {
    require(positionMs.isFinite())
    check(it.player.isCurrentMediaItemSeekable)
    val duration = it.player.duration
    val target = positionMs.toLong().coerceAtLeast(0).let { value ->
      if (duration != C.TIME_UNSET && duration >= 0) value.coerceAtMost(duration) else value
    }
    it.player.seekTo(target)
  }
  @ReactMethod fun returnToLive(id: String, generation: Double, promise: Promise) = withSession(id, generation, promise) {
    check(foreground && it.player.isCurrentMediaItemLive)
    it.player.seekToDefaultPosition()
    it.player.play()
  }
  @ReactMethod fun stop(id: String, generation: Double, promise: Promise) = onMain(promise) {
    sessions[id]?.takeIf { it.generation == generation }?.let {
      sessions.remove(id)
      dispose(it)
    }
    promise.resolve(null)
  }
  @ReactMethod fun release(id: String, promise: Promise) = onMain(promise) {
    sessions.remove(id)?.let(::dispose)
    promise.resolve(null)
  }

  internal fun bindSurface(id: String, surface: SurfaceView) {
    check(Looper.myLooper() == Looper.getMainLooper())
    surfaces[id]?.takeIf { it !== surface }?.let { previous ->
      sessions[id]?.player?.clearVideoSurfaceView(previous)
    }
    surfaces[id] = surface
    sessions[id]?.player?.setVideoSurfaceView(surface)
  }
  internal fun unbindSurface(id: String, surface: SurfaceView) {
    if (surfaces[id] !== surface) return
    surfaces.remove(id)
    // A removed playback surface must not leave invisible audio playing.
    sessions.remove(id)?.let { session ->
      session.player.pause()
      emit(session)
      dispose(session)
    }
  }
  private fun rejectPending(session: Session, code: String) {
    session.timeout?.let(main::removeCallbacks)
    session.timeout = null
    session.pending?.reject(code, "Playback request ended")
    session.pending = null
  }
  private fun dispose(session: Session) {
    rejectPending(session, "MEDIA3_CANCELLED")
    main.removeCallbacks(session.ticker)
    session.player.removeListener(session.listener)
    session.player.clearVideoSurface()
    session.player.stop()
    session.player.clearMediaItems()
    session.player.release()
  }
  private fun emit(session: Session) {
    if (invalidated || !context.hasActiveReactInstance()) return
    val player = session.player
    val state = when {
      session.errorCode != null -> "error"
      player.playbackState == Player.STATE_ENDED -> "ended"
      player.playbackState == Player.STATE_BUFFERING -> if (session.ready) "buffering" else "loading"
      player.isPlaying -> "playing"
      player.playbackState == Player.STATE_READY -> "paused"
      else -> "idle"
    }
    val duration = player.duration
    val event = Arguments.createMap().apply {
      putString("sessionId", session.id)
      putDouble("generation", session.generation)
      putString("state", state)
      putDouble("positionMs", player.currentPosition.coerceAtLeast(0).toDouble())
      if (duration == C.TIME_UNSET || duration < 0) putNull("durationMs") else putDouble("durationMs", duration.toDouble())
      session.errorCode?.let { putString("errorCode", it) }
    }
    context.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      .emit("KlaroPlaybackChanged", event)
  }

  override fun onHostResume() { main.post { foreground = true } }
  override fun onHostPause() {
    main.post {
      foreground = false
      sessions.values.toList().forEach { session ->
        session.player.pause()
        if (session.pending != null) {
          session.errorCode = "MEDIA3_BACKGROUND_CANCELLED"
          rejectPending(session, "MEDIA3_BACKGROUND_CANCELLED")
          emit(session)
          sessions.remove(session.id)
          dispose(session)
        } else emit(session)
      }
    }
  }
  override fun onHostDestroy() {
    main.post {
      foreground = false
      sessions.values.toList().forEach { session ->
        session.player.pause()
        session.errorCode = "MEDIA3_HOST_DESTROYED"
        emit(session)
        dispose(session)
      }
      sessions.clear()
      surfaces.clear()
    }
  }
  override fun invalidate() {
    invalidated = true
    context.removeLifecycleEventListener(this)
    main.post {
      sessions.values.toList().forEach(::dispose)
      sessions.clear()
      surfaces.clear()
    }
    super.invalidate()
  }
}
