import { useEffect, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Loader2, Save, Settings2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import {
  getDefaultAppSettings,
  loadAppSettings,
  saveAppSettings,
  type AppSettings,
} from '@/services/appSettings';

const Settings = () => {
  const navigate = useNavigate();
  const [settings, setSettings] = useState<AppSettings>(getDefaultAppSettings());
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

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
                      onChange={(event) => setSettings((prev) => ({
                        ...prev,
                        theme: event.target.value as AppSettings['theme'],
                      }))}
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
