import React from "react";
import {
  NativeEventEmitter, NativeModules, Platform, requireNativeComponent, UIManager,
  type ViewProps,
} from "react-native";
import type { AndroidPlaybackEvent } from "./AndroidPlaybackAdapter";
import { bindAndroidPlayback, type NativePlaybackModule } from "./native-binding";

interface SurfaceProps extends ViewProps { sessionId: string }
const binding = bindAndroidPlayback({
  platform: Platform.OS,
  module: NativeModules.KlaroPlayback as NativePlaybackModule | undefined,
  hasSurface: () => !!UIManager.getViewManagerConfig("KlaroPlaybackSurface"),
  subscribe: (module, listener) => {
    const emitter = new NativeEventEmitter(module);
    const subscription = emitter.addListener("KlaroPlaybackChanged", (...args: readonly object[]) => {
      listener(args[0] as AndroidPlaybackEvent);
    });
    return () => subscription.remove();
  },
});
export const androidPlaybackAvailable = binding.available;
export const createAndroidPlaybackAdapter = binding.createAdapter;
const NativeSurface = androidPlaybackAvailable
  ? requireNativeComponent<SurfaceProps>("KlaroPlaybackSurface") : null;

export function AndroidPlaybackSurface(props: SurfaceProps) {
  return NativeSurface ? <NativeSurface {...props} /> : null;
}
