import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  BackHandler,
  NativeModules,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import type { TVPlaybackRequest, PlaybackError } from "@lumen/types";
import { AndroidPlaybackSurface, createAndroidPlaybackAdapter, androidPlaybackAvailable } from "./src/adapters/android/native";
import { createPlaybackController } from "./src/composition/playback";
import {
  backDestination,
  initialPlaybackState,
  reducePlaybackState,
  type Screen,
} from "./src/focus/shell-state";
import {
  getMessages,
  isLocale,
  languageOptions,
  type Locale,
} from "./src/i18n/messages";

interface DevicePreferencesModule {
  getLanguage(): Promise<string | null>;
  setLanguage(language: string): Promise<void>;
}

const devicePreferences = NativeModules.KlaroDevicePreferences as DevicePreferencesModule;

type FocusButtonProps = {
  label: string;
  onPress: () => void;
  primary?: boolean;
  preferred?: boolean;
  accessibilityLabel?: string;
};

function FocusButton({
  label,
  onPress,
  primary = false,
  preferred = false,
  accessibilityLabel,
}: FocusButtonProps) {
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      hasTVPreferredFocus={preferred}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPress={onPress}
      style={[
        styles.button,
        primary ? styles.primaryButton : styles.secondaryButton,
        focused && styles.focusedButton,
      ]}
    >
      <Text style={[styles.buttonText, primary && styles.primaryButtonText]}>{label}</Text>
    </Pressable>
  );
}

function getPlaybackError(error: unknown): PlaybackError {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return {
      code: /^[A-Z0-9_.-]{1,64}$/i.test(error.code) ? error.code : "PLAYBACK_START_FAILED",
      message: "Playback could not start.",
      fatal: true,
    };
  }
  return {
    code: "PLAYBACK_START_FAILED",
    message: "Playback could not start.",
    fatal: true,
  };
}

export default function App() {
  const controller = useRef<ReturnType<typeof createPlaybackController> | null>(null);
  const playbackGeneration = useRef(0);
  const { width } = useWindowDimensions();
  const [screen, setScreen] = useState<Screen>("home");
  const [settingsOrigin, setSettingsOrigin] = useState<Screen>("home");
  const [locale, setLocale] = useState<Locale>("en");
  const [languageReady, setLanguageReady] = useState(false);
  const [languageError, setLanguageError] = useState<"load" | "save" | null>(null);
  const [sourceUrl, setSourceUrl] = useState("");
  const [surfaceSessionId, setSurfaceSessionId] = useState<string | null>(null);
  const [playback, setPlayback] = useState(initialPlaybackState);
  const messages = useMemo(() => getMessages(locale), [locale]);
  const compact = width < 1100;

  useEffect(() => {
    let mounted = true;
    devicePreferences.getLanguage()
      .then((stored) => {
        if (!mounted) return;
        if (stored == null) {
          setLocale("en");
          setScreen("settings");
        } else if (isLocale(stored)) {
          setLocale(stored);
        } else {
          setLocale("en");
          setLanguageError("load");
        }
      })
      .catch(() => {
        if (mounted) setLanguageError("load");
      })
      .finally(() => {
        if (mounted) setLanguageReady(true);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const returnToPreviousScreen = useCallback(() => {
    const destination = backDestination(screen, settingsOrigin);
    if (destination == null) return false;
    playbackGeneration.current += 1;
    controller.current?.destroy();
    controller.current = null;
    setSurfaceSessionId(null);
    setSourceUrl("");
    setPlayback(initialPlaybackState);
    setScreen(destination);
    return true;
  }, [screen, settingsOrigin]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      return returnToPreviousScreen();
    });
    return () => subscription.remove();
  }, [returnToPreviousScreen]);

  useEffect(() => () => {
    playbackGeneration.current += 1;
    controller.current?.destroy();
    controller.current = null;
  }, []);

  const chooseLocale = useCallback(async (nextLocale: Locale) => {
    setLanguageError(null);
    try {
      await devicePreferences.setLanguage(nextLocale);
      setLocale(nextLocale);
    } catch {
      setLanguageError("save");
    }
  }, []);

  const beginPlayback = useCallback(async () => {
    const generation = ++playbackGeneration.current;
    setPlayback((current) => reducePlaybackState(current, { type: "start" }));
    controller.current?.destroy();
    const adapter = createAndroidPlaybackAdapter();
    setSurfaceSessionId(adapter?.sessionId ?? null);
    const playbackController = createPlaybackController(adapter);
    controller.current = playbackController;
    playbackController.onChange((snapshot) => {
      if (generation !== playbackGeneration.current) return;
      setPlayback((current) => snapshot.error
        ? reducePlaybackState(current, { type: "failed", error: snapshot.error })
        : reducePlaybackState(current, { type: "stateChanged", state: snapshot.state }));
    });
    const request: TVPlaybackRequest = {
      kind: "live", sourceId: "shell-test", channelId: "shell-test",
      media: {
        url: sourceUrl.trim(),
        type: "hls",
      },
    };
    setSourceUrl("");
    try {
      await playbackController.load(request);
      if (generation !== playbackGeneration.current) return;
      setPlayback((current) =>
        reducePlaybackState(current, { type: "stateChanged", state: playbackController.getSnapshot().state }),
      );
    } catch (error) {
      if (generation !== playbackGeneration.current) return;
      setPlayback((current) =>
        reducePlaybackState(current, { type: "failed", error: getPlaybackError(error) }),
      );
    }
  }, [sourceUrl]);

  if (!languageReady) {
    return (
      <View style={styles.loadingRoot}>
        <ActivityIndicator color={colors.accent} size="large" />
        <Text style={styles.loadingLabel}>{messages.appName}</Text>
      </View>
    );
  }

  const navigate = (nextScreen: Screen) => {
    playbackGeneration.current += 1;
    controller.current?.destroy();
    controller.current = null;
    setSurfaceSessionId(null);
    setSourceUrl("");
    setPlayback(initialPlaybackState);
    if (nextScreen === "settings") setSettingsOrigin(screen);
    setLanguageError(null);
    if (nextScreen === "playback") {
      setSourceUrl("");
    }
    setScreen(nextScreen);
  };

  return (
    <View style={styles.root}>
      <StatusBar hidden />
      <View style={styles.header}>
        <View style={styles.brandMark}>
          <Text style={styles.brandMarkText}>K</Text>
        </View>
        <View>
          <Text style={styles.brandName}>{messages.appName}</Text>
          <Text style={styles.headerCaption}>{messages.platformCaption}</Text>
        </View>
        <View style={styles.headerSpacer} />
        {screen !== "home" ? (
          <FocusButton label={messages.back} onPress={returnToPreviousScreen} />
        ) : null}
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {screen === "home" ? (
          <View style={[styles.columns, compact && styles.columnsCompact]}>
            <View style={styles.heroColumn}>
              <Text style={styles.eyebrow}>{messages.tagline}</Text>
              <Text style={styles.title}>{messages.intro}</Text>
              <Text style={styles.description}>{messages.description}</Text>
              <Text style={styles.remoteHint}>{messages.remoteHint}</Text>
            </View>
            <View style={styles.menuColumn}>
              <Text style={styles.sectionTitle}>{messages.home}</Text>
              <FocusButton
                label={messages.openPlayback}
                onPress={() => navigate("playback")}
                primary
                preferred
              />
              <FocusButton label={messages.settings} onPress={() => navigate("settings")} />
            </View>
          </View>
        ) : null}

        {screen === "settings" ? (
          <View style={styles.settingsPanel}>
            <Text style={styles.eyebrow}>{messages.settings}</Text>
            <Text style={styles.title}>{messages.chooseLanguage}</Text>
            {languageOptions.map((option) => (
              <FocusButton
                key={option.id}
                label={`${option.nativeName}${locale === option.id ? "  ✓" : ""}`}
                accessibilityLabel={option.nativeName}
                onPress={() => void chooseLocale(option.id)}
                primary={locale === option.id}
                preferred={locale === option.id}
              />
            ))}
            {languageError ? (
              <Text style={styles.errorText} accessibilityRole="alert">
                {languageError === "load" ? messages.loadLanguageError : messages.saveLanguageError}
              </Text>
            ) : null}
          </View>
        ) : null}

        {screen === "playback" ? (
          <View style={[styles.columns, compact && styles.columnsCompact]}>
            <View style={styles.playerPanel}>
              <View style={styles.playerScreen}>
                {surfaceSessionId ? (
                  <AndroidPlaybackSurface
                    sessionId={surfaceSessionId}
                    style={StyleSheet.absoluteFill}
                  />
                ) : null}
                {playback.status === "loading" ? (
                  <ActivityIndicator color={colors.accentLight} size="large" />
                ) : playback.status !== "playing" ? (
                  <View style={styles.playIcon}>
                    <Text style={styles.playIconText}>▶</Text>
                  </View>
                ) : null}
                <Text style={styles.playerStatus}>
                  {playback.engineState === "playing" ? messages.statePlaying
                    : playback.engineState === "paused" ? messages.statePaused
                      : playback.engineState === "ended" ? messages.stateEnded
                        : playback.engineState === "buffering" ? messages.stateBuffering
                          : playback.engineState === "loading" || playback.engineState === "seeking" ? messages.stateLoading
                            : playback.engineState === "error" ? messages.stateError : messages.stateIdle}
                </Text>
                {playback.status === "error" ? (
                  <Text style={styles.errorText} accessibilityRole="alert">
                    {androidPlaybackAvailable ? messages.playbackFailed : messages.noPlaybackAdapter}
                  </Text>
                ) : null}
              </View>
            </View>
            <View style={styles.controlsPanel}>
              <Text style={styles.eyebrow}>{messages.playbackTitle}</Text>
              <Text style={styles.sectionTitle}>{messages.playbackTitle}</Text>
              <Text style={styles.description}>{androidPlaybackAvailable ? messages.playbackDescription : messages.noPlaybackAdapter}</Text>
              <TextInput
                accessibilityLabel={messages.streamUrl}
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry
                keyboardType="url"
                onChangeText={setSourceUrl}
                placeholder={messages.streamUrl}
                placeholderTextColor={colors.muted}
                returnKeyType="done"
                style={styles.sourceInput}
                value={sourceUrl}
              />
              <FocusButton
                label={messages.startPlayback}
                onPress={() => void beginPlayback()}
                primary
                preferred
              />
              {playback.error ? (
                <Text style={styles.codeText}>{playback.error.code}</Text>
              ) : null}
              {languageError ? (
                <Text style={styles.errorText} accessibilityRole="alert">
                  {languageError === "load" ? messages.loadLanguageError : messages.saveLanguageError}
                </Text>
              ) : null}
              <FocusButton label={messages.settings} onPress={() => navigate("settings")} />
            </View>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const colors = {
  background: "#07101f",
  panel: "#101c30",
  panelRaised: "#172640",
  text: "#f3f7ff",
  muted: "#a8b6ce",
  accent: "#2684ff",
  accentLight: "#66c7ff",
  error: "#ffb3ad",
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  loadingRoot: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.background,
  },
  loadingLabel: { color: colors.text, fontSize: 24, marginTop: 18 },
  header: {
    minHeight: 96,
    paddingHorizontal: 60,
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: 1,
    borderBottomColor: "#25334b",
  },
  brandMark: {
    width: 46,
    height: 46,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 16,
    backgroundColor: colors.accent,
  },
  brandMarkText: { color: "white", fontSize: 26, fontWeight: "800" },
  brandName: { color: colors.text, fontSize: 21, fontWeight: "700" },
  headerCaption: { color: colors.muted, fontSize: 11, letterSpacing: 2, marginTop: 4 },
  headerSpacer: { flex: 1 },
  scrollContent: { flexGrow: 1, paddingHorizontal: 60, paddingVertical: 48 },
  columns: { flex: 1, flexDirection: "row", alignItems: "center", gap: 48 },
  columnsCompact: { flexDirection: "column", alignItems: "stretch", gap: 30 },
  heroColumn: { flex: 1.2, justifyContent: "center", minHeight: 320 },
  menuColumn: {
    flex: 0.8,
    maxWidth: 570,
    minWidth: 350,
    padding: 32,
    gap: 14,
    borderRadius: 24,
    backgroundColor: colors.panel,
  },
  eyebrow: { color: colors.accentLight, fontSize: 13, fontWeight: "700", letterSpacing: 2 },
  title: { color: colors.text, fontSize: 48, lineHeight: 58, fontWeight: "700", marginTop: 16 },
  description: { color: colors.muted, fontSize: 21, lineHeight: 32, marginTop: 16 },
  remoteHint: { color: colors.muted, fontSize: 16, marginTop: 36 },
  sectionTitle: { color: colors.text, fontSize: 28, fontWeight: "700", marginBottom: 8 },
  settingsPanel: {
    width: "100%",
    maxWidth: 760,
    alignSelf: "center",
    padding: 36,
    gap: 14,
    borderRadius: 24,
    backgroundColor: colors.panel,
  },
  button: {
    minHeight: 60,
    paddingHorizontal: 22,
    paddingVertical: 14,
    borderWidth: 2,
    borderRadius: 14,
    justifyContent: "center",
  },
  primaryButton: { borderColor: colors.accent, backgroundColor: colors.accent },
  secondaryButton: { borderColor: "#344761", backgroundColor: colors.panelRaised },
  focusedButton: { borderColor: colors.accentLight, transform: [{ scale: 1.035 }] },
  buttonText: { color: colors.text, fontSize: 19, fontWeight: "600" },
  primaryButtonText: { color: "#ffffff" },
  playerPanel: { flex: 1.25, minHeight: 360 },
  playerScreen: {
    flex: 1,
    minHeight: 360,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
    backgroundColor: "#020711",
    borderWidth: 1,
    borderColor: "#25334b",
  },
  playIcon: {
    width: 76,
    height: 76,
    borderRadius: 38,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.panelRaised,
  },
  playIconText: { color: colors.accentLight, fontSize: 28 },
  playerStatus: { color: colors.text, fontSize: 21, fontWeight: "600", marginTop: 24 },
  controlsPanel: {
    flex: 0.75,
    minWidth: 350,
    maxWidth: 560,
    padding: 28,
    gap: 14,
    borderRadius: 24,
    backgroundColor: colors.panel,
  },
  sourceInput: {
    minHeight: 60,
    borderWidth: 1,
    borderColor: "#42536d",
    borderRadius: 12,
    color: colors.text,
    fontSize: 18,
    paddingHorizontal: 18,
    marginVertical: 6,
  },
  errorText: { color: colors.error, fontSize: 17, lineHeight: 25, marginTop: 8 },
  codeText: { color: colors.muted, fontSize: 13, marginTop: 2 },
});
