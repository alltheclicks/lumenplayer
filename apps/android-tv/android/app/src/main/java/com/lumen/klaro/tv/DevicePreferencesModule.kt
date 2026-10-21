package com.lumen.klaro.tv

import android.content.Context
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class DevicePreferencesModule(context: ReactApplicationContext) :
  ReactContextBaseJavaModule(context) {

  override fun getName(): String = "KlaroDevicePreferences"

  @ReactMethod
  fun getLanguage(promise: Promise) {
    try {
      promise.resolve(preferences().getString(LANGUAGE_KEY, null))
    } catch (error: Exception) {
      promise.reject("DEVICE_PREFERENCE_READ_FAILED", error)
    }
  }

  @ReactMethod
  fun setLanguage(language: String, promise: Promise) {
    try {
      val saved = preferences().edit().putString(LANGUAGE_KEY, language).commit()
      if (saved) {
        promise.resolve(null)
      } else {
        promise.reject("DEVICE_PREFERENCE_WRITE_FAILED", "Could not save language preference")
      }
    } catch (error: Exception) {
      promise.reject("DEVICE_PREFERENCE_WRITE_FAILED", error)
    }
  }

  private fun preferences() =
    reactApplicationContext.getSharedPreferences(PREFERENCES_FILE, Context.MODE_PRIVATE)

  private companion object {
    const val PREFERENCES_FILE = "klaro_device_preferences"
    const val LANGUAGE_KEY = "language"
  }
}
