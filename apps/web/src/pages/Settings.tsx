import { useEffect, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Download, Loader2, Save, Settings2, Smartphone, Wifi, WifiOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { usePWA } from '@/hooks/usePWA';
import {
  evaluatePushCompatibility,
  getPushCompatibilityMatrix,
  type PushCompatibilityResult,
  type PushSupportStatus,
} from '@/services/pushCompatibility';
import {
  applyThemePreference,
  getDefaultAppSettings,
  loadAppSettings,
  saveAppSettings,
  type AppSettings,
} from '@/services/appSettings';

const statusText: Record<PushSupportStatus, string> = {
  supported: 'Supported',
  'requires-install': 'Requires install',
  unsupported: 'Unsupported',
};

const statusClassName: Record<PushSupportStatus, string> = {
  supported: 'text-emerald-600 dark:text-emerald-400',
  'requires-install': 'text-amber-600 dark:text-amber-400',
  unsupported: 'text-rose-600 dark:text-rose-400',
};

const permissionText: Record<NotificationPermission | 'unsupported', string> = {
  granted: 'Granted',
  denied: 'Denied',
  default: 'Not requested',
  unsupported: 'Unsupported',
};

const getNotificationPermission = (): NotificationPermission | 'unsupported' => {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported';
  }

  return Notification.permission;
};

const getUnsupportedPushCopy = (compatibility: PushCompatibilityResult): string => {
  if (compatibility.platform !== 'web') {
    return 'Push notifications are disabled on TV browser platforms. Use mobile or desktop browser.';
  }

  if (compatibility.isIOS && compatibility.iosVersion === null) {
    return 'Unable to verify iOS version. Update iOS/iPadOS to 16.4+ and install app to Home Screen.';
  }

  if (compatibility.isIOS) {
    return 'Push needs iOS/iPadOS 16.4+ plus Home Screen install. Open this app in Safari and install it.';
  }

  return 'This browser/device currently cannot complete web push setup. Use a modern Chrome/Edge/Samsung Internet/Firefox build.';
};

const Settings = () => {
  const navigate = useNavigate();
  const [settings, setSettings] = useState<AppSettings>(getDefaultAppSettings());
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [installMessage, setInstallMessage] = useState<string | null>(null);
  const [pushCompatibility, setPushCompatibility] = useState(() => evaluatePushCompatibility());
  const [pushPermission, setPushPermission] = useState<NotificationPermission | 'unsupported'>(() =>
    getNotificationPermission()
  );
  const [pushOptInMessage, setPushOptInMessage] = useState<string | null>(null);
  const [showPermissionPromptStep, setShowPermissionPromptStep] = useState(false);
  const pushMatrix = getPushCompatibilityMatrix();
  const { isInstalled, isInstallable, isOnline, promptInstall, isIOS, isAndroid } = usePWA();

  useEffect(() => {
    let cancelled = false;

    const hydrate = async () => {
      const loadedSettings = await loadAppSettings();
      if (!cancelled) {
        setSettings(loadedSettings);
        setIsLoading(false);
      }
    };

    void hydrate();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const syncPermissionState = () => {
      setPushPermission(getNotificationPermission());
      setPushCompatibility(evaluatePushCompatibility());
    };

    syncPermissionState();
    document.addEventListener('visibilitychange', syncPermissionState);
    window.addEventListener('focus', syncPermissionState);

    return () => {
      document.removeEventListener('visibilitychange', syncPermissionState);
      window.removeEventListener('focus', syncPermissionState);
    };
  }, [isInstalled, isInstallable, isIOS, isAndroid]);

  useEffect(() => {
    if (pushPermission !== 'default') {
      setShowPermissionPromptStep(false);
    }
  }, [pushPermission]);

  const handleSave = async () => {
    setIsSaving(true);
    setSaveMessage(null);

    try {
      await saveAppSettings(settings);
      setSaveMessage('Settings saved successfully.');
    } catch {
      setSaveMessage('Failed to save settings. Try again.');
    } finally {
      setIsSaving(false);
    }
  };

  const resetToDefaults = () => {
    const defaults = getDefaultAppSettings();
    setSettings(defaults);
    setSaveMessage(null);
    applyThemePreference(defaults.theme);
  };

  const handleInstall = async () => {
    setInstallMessage(null);
    const accepted = await promptInstall();

    if (accepted) {
      setInstallMessage('Install prompt accepted.');
      return;
    }

    setInstallMessage('Install prompt dismissed or unavailable.');
  };

  const handleStartPushOptIn = () => {
    setPushOptInMessage(null);
    setShowPermissionPromptStep(true);
  };

  const handlePushPermissionPrompt = async () => {
    if (!('Notification' in window)) {
      setPushPermission('unsupported');
      setPushOptInMessage('Notifications API is not available on this device/browser.');
      return;
    }

    try {
      const result = await Notification.requestPermission();
      setPushPermission(result);
      setPushCompatibility(evaluatePushCompatibility());

      if (result === 'granted') {
        setPushOptInMessage('Notifications enabled. Device subscription wiring is handled in backend task phase.');
        return;
      }

      if (result === 'denied') {
        setPushOptInMessage('Permission denied. Enable notifications manually from browser settings if needed.');
        return;
      }

      setPushOptInMessage('Permission prompt dismissed. You can retry anytime.');
    } catch {
      setPushOptInMessage('Failed to request notification permission. Try again.');
    }
  };

  return (
    <>
      <Helmet>
        <title>Settings - IPTV Player</title>
      </Helmet>

      <div className="min-h-screen bg-background p-4 md:p-6">
        <div className="mx-auto max-w-3xl space-y-5">
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="ghost" className="gap-2" onClick={() => navigate('/player')}>
              <ArrowLeft className="h-4 w-4" />
              Back to Player
            </Button>
            <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
          </div>

          {isLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading settings...
            </div>
          ) : (
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <Settings2 className="h-4 w-4" />
                    General
                  </CardTitle>
                  <CardDescription>
                    Theme and language preferences for the web app.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="theme">Theme</Label>
                    <select
                      id="theme"
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      value={settings.theme}
                      onChange={(event) => {
                        const nextTheme = event.target.value as AppSettings['theme'];
                        setSettings((prev) => ({
                          ...prev,
                          theme: nextTheme,
                        }));
                        applyThemePreference(nextTheme);
                      }}
                    >
                      <option value="dark">Dark</option>
                      <option value="light">Light</option>
                      <option value="system">System</option>
                    </select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="language">Language</Label>
                    <select
                      id="language"
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      value={settings.language}
                      onChange={(event) => setSettings((prev) => ({
                        ...prev,
                        language: event.target.value as AppSettings['language'],
                      }))}
                    >
                      <option value="en">English</option>
                      <option value="sr">Serbian</option>
                    </select>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Player Preferences</CardTitle>
                  <CardDescription>
                    Playback defaults used when opening channels and media.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <label className="flex items-center justify-between gap-3 text-sm">
                    <span>Autoplay on source change</span>
                    <input
                      type="checkbox"
                      className="h-4 w-4"
                      checked={settings.player.autoplay}
                      onChange={(event) => setSettings((prev) => ({
                        ...prev,
                        player: {
                          ...prev.player,
                          autoplay: event.target.checked,
                        },
                      }))}
                    />
                  </label>

                  <label className="flex items-center justify-between gap-3 text-sm">
                    <span>Prefer native HLS playback</span>
                    <input
                      type="checkbox"
                      className="h-4 w-4"
                      checked={settings.player.preferNativeHls}
                      onChange={(event) => setSettings((prev) => ({
                        ...prev,
                        player: {
                          ...prev.player,
                          preferNativeHls: event.target.checked,
                        },
                      }))}
                    />
                  </label>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="defaultVolume">Default volume</Label>
                      <span className="text-sm text-muted-foreground">{settings.player.defaultVolume}%</span>
                    </div>
                    <input
                      id="defaultVolume"
                      type="range"
                      className="w-full"
                      min={0}
                      max={100}
                      step={1}
                      value={settings.player.defaultVolume}
                      onChange={(event) => setSettings((prev) => ({
                        ...prev,
                        player: {
                          ...prev.player,
                          defaultVolume: Number(event.target.value),
                        },
                      }))}
                    />
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <Smartphone className="h-4 w-4" />
                    Install App
                  </CardTitle>
                  <CardDescription>
                    Install this app on your device for a full-screen, app-like experience.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    {isOnline ? (
                      <Wifi className="h-4 w-4 text-emerald-500" />
                    ) : (
                      <WifiOff className="h-4 w-4 text-amber-500" />
                    )}
                    <span>{isOnline ? 'You are online' : 'You are offline'}</span>
                  </div>

                  {isInstalled && (
                    <p className="text-sm text-emerald-600 dark:text-emerald-400">
                      App is already installed on this device.
                    </p>
                  )}

                  {!isInstalled && isInstallable && (
                    <div className="space-y-2">
                      <Button onClick={() => void handleInstall()}>
                        <Download className="mr-2 h-4 w-4" />
                        Install app
                      </Button>
                      <p className="text-sm text-muted-foreground">
                        The browser will show a native install prompt.
                      </p>
                    </div>
                  )}

                  {!isInstalled && !isInstallable && isIOS && (
                    <p className="text-sm text-muted-foreground">
                      On iOS: open Share menu in Safari, then choose "Add to Home Screen".
                    </p>
                  )}

                  {!isInstalled && !isInstallable && isAndroid && (
                    <p className="text-sm text-muted-foreground">
                      Install becomes available after browsing this app for a short time in Chrome.
                    </p>
                  )}

                  {!isInstalled && !isInstallable && !isIOS && !isAndroid && (
                    <p className="text-sm text-muted-foreground">
                      Install prompt is not available on this browser/device.
                    </p>
                  )}

                  {installMessage && (
                    <p className="text-sm text-muted-foreground">{installMessage}</p>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Push Compatibility (Spike)</CardTitle>
                  <CardDescription>
                    Runtime capability check for web push support across current device/browser.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <p className={`text-sm font-medium ${statusClassName[pushCompatibility.status]}`}>
                    {statusText[pushCompatibility.status]}: {pushCompatibility.message}
                  </p>

                  <div className="grid gap-2 text-sm sm:grid-cols-3">
                    <div>
                      <p className="text-muted-foreground">Platform</p>
                      <p>{pushCompatibility.platform}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Browser</p>
                      <p>{pushCompatibility.browser}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">iOS Version</p>
                      <p>{pushCompatibility.iosVersion ?? 'n/a'}</p>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <p className="text-sm font-medium">Capability checks</p>
                    <div className="space-y-1 text-sm">
                      {pushCompatibility.capabilityFlags.map((flag) => (
                        <p key={flag.label}>
                          {flag.label}: {flag.supported ? 'yes' : 'no'}
                        </p>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <p className="text-sm font-medium">Device matrix</p>
                    <div className="space-y-1 text-sm">
                      {pushMatrix.map((row) => (
                        <p key={row.target}>
                          {row.target}: {statusText[row.status]} ({row.note})
                        </p>
                      ))}
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Push Notifications</CardTitle>
                  <CardDescription>
                    Opt-in flow with explicit pre-permission step and gesture-based browser prompt.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="text-muted-foreground">Permission:</span>
                    <span>{permissionText[pushPermission]}</span>
                  </div>

                  {pushCompatibility.status === 'unsupported' && (
                    <p className="text-sm text-muted-foreground">
                      {getUnsupportedPushCopy(pushCompatibility)}
                    </p>
                  )}

                  {pushCompatibility.status === 'requires-install' && (
                    <p className="text-sm text-muted-foreground">
                      Push on iOS/iPadOS works only from Home Screen install. Install app first, then return here.
                    </p>
                  )}

                  {pushCompatibility.status === 'supported' && pushPermission === 'default' && !showPermissionPromptStep && (
                    <div className="space-y-2">
                      <p className="text-sm text-muted-foreground">
                        Enable channel reminders and playback alerts. We ask permission only after explicit confirmation.
                      </p>
                      <Button variant="outline" onClick={handleStartPushOptIn}>
                        Continue
                      </Button>
                    </div>
                  )}

                  {pushCompatibility.status === 'supported' && pushPermission === 'default' && showPermissionPromptStep && (
                    <div className="space-y-2">
                      <p className="text-sm text-muted-foreground">
                        Next step opens the browser notification permission prompt.
                      </p>
                      <Button onClick={() => void handlePushPermissionPrompt()}>
                        Allow notifications
                      </Button>
                    </div>
                  )}

                  {pushCompatibility.status === 'supported' && pushPermission === 'granted' && (
                    <p className="text-sm text-emerald-600 dark:text-emerald-400">
                      Notification permission is active on this device.
                    </p>
                  )}

                  {pushCompatibility.status === 'supported' && pushPermission === 'denied' && (
                    <p className="text-sm text-muted-foreground">
                      Browser blocked notifications for this site. Change site notification settings to retry.
                    </p>
                  )}

                  {pushOptInMessage && (
                    <p className="text-sm text-muted-foreground">{pushOptInMessage}</p>
                  )}
                </CardContent>
              </Card>

              <div className="flex flex-wrap items-center gap-2">
                <Button onClick={() => void handleSave()} disabled={isSaving}>
                  {isSaving ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="mr-2 h-4 w-4" />
                  )}
                  Save settings
                </Button>
                <Button variant="outline" onClick={resetToDefaults} disabled={isSaving}>
                  Reset to defaults
                </Button>
                {saveMessage && (
                  <span className="text-sm text-muted-foreground">{saveMessage}</span>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
};

export default Settings;
