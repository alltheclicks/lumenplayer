package com.lumen.klaro.tv.playback

import android.view.SurfaceView
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.ViewManager
import com.facebook.react.uimanager.annotations.ReactProp

class KlaroPlaybackSurface(context: ThemedReactContext) : SurfaceView(context) {
  var sessionId: String? = null
}

class KlaroPlaybackSurfaceManager : SimpleViewManager<KlaroPlaybackSurface>() {
  override fun getName() = "KlaroPlaybackSurface"
  override fun createViewInstance(context: ThemedReactContext) = KlaroPlaybackSurface(context).apply {
    isFocusable = false
    isFocusableInTouchMode = false
  }
  private fun module(view: KlaroPlaybackSurface) =
    (view.context as ThemedReactContext).getNativeModule(KlaroPlaybackModule::class.java)

  @ReactProp(name = "sessionId")
  fun setSessionId(view: KlaroPlaybackSurface, id: String?) {
    if (view.sessionId == id) return
    view.sessionId?.let { module(view)?.unbindSurface(it, view) }
    view.sessionId = id
    id?.let { module(view)?.bindSurface(it, view) }
  }
  override fun onDropViewInstance(view: KlaroPlaybackSurface) {
    view.sessionId?.let { module(view)?.unbindSurface(it, view) }
    view.sessionId = null
    super.onDropViewInstance(view)
  }
}

class KlaroPlaybackPackage : ReactPackage {
  @Suppress("OVERRIDE_DEPRECATION")
  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> = listOf(KlaroPlaybackModule(reactContext))
  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> = listOf(KlaroPlaybackSurfaceManager())
}
