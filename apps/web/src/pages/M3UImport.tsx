import { useMemo, useState } from "react";
import { BRAND_NAME } from '@/config/brand';
import { useNavigate } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { parseM3U } from "@lumen/api";
import { ArrowLeft, FileUp, Link as LinkIcon, Loader2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { saveImportedM3UPlaylist } from "@/services/m3uImport";

const M3UImport = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [playlistUrl, setPlaylistUrl] = useState("");
  const [isLoadingUrl, setIsLoadingUrl] = useState(false);
  const [isLoadingFile, setIsLoadingFile] = useState(false);
  const [lastImportedCount, setLastImportedCount] = useState<number | null>(null);
  const [lastImportedSource, setLastImportedSource] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isBusy = isLoadingUrl || isLoadingFile;
  const canImportUrl = useMemo(
    () => playlistUrl.trim().length > 0 && !isBusy,
    [playlistUrl, isBusy],
  );

  const persistChannels = async (
    content: string,
    sourceType: "url" | "file",
    sourceLabel: string,
  ) => {
    const channels = parseM3U(content);
    if (channels.length === 0) {
      throw new Error("Playlist is empty or invalid.");
    }

    await saveImportedM3UPlaylist({
      sourceType,
      sourceLabel,
      importedAt: new Date().toISOString(),
      channels,
    });

    setLastImportedCount(channels.length);
    setLastImportedSource(sourceLabel);

    toast({
      title: "Playlist imported",
      description: `${channels.length} channels ready for playback.`,
    });
  };

  const importFromUrl = async () => {
    setError(null);
    setIsLoadingUrl(true);

    try {
      const response = await fetch(playlistUrl.trim());
      if (!response.ok) {
        throw new Error(`Request failed (${response.status})`);
      }

      const content = await response.text();
      await persistChannels(content, "url", playlistUrl.trim());
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to import playlist URL.";
      setError(message);
    } finally {
      setIsLoadingUrl(false);
    }
  };

  const importFromFile = async (file: File | null) => {
    if (!file) {
      return;
    }

    setError(null);
    setIsLoadingFile(true);

    try {
      const content = await file.text();
      await persistChannels(content, "file", file.name);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to import M3U file.";
      setError(message);
    } finally {
      setIsLoadingFile(false);
    }
  };

  return (
    <>
      <Helmet>
        <title>{`Import M3U Playlist - ${BRAND_NAME}`}</title>
      </Helmet>

      <div className="min-h-screen bg-background p-4 md:p-8">
        <div className="mx-auto w-full max-w-3xl space-y-4">
          <Button variant="ghost" onClick={() => navigate("/login")} className="gap-2">
            <ArrowLeft className="h-4 w-4" />
            Back to Login
          </Button>

          <Card>
            <CardHeader>
              <CardTitle>Import M3U Playlist</CardTitle>
              <CardDescription>
                Add playlist by URL or upload a local M3U/M3U8 file.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="m3u-url">Playlist URL</Label>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input
                    id="m3u-url"
                    type="url"
                    placeholder="https://example.com/playlist.m3u"
                    value={playlistUrl}
                    onChange={(event) => setPlaylistUrl(event.target.value)}
                    disabled={isBusy}
                  />
                  <Button onClick={() => void importFromUrl()} disabled={!canImportUrl} className="gap-2">
                    {isLoadingUrl ? <Loader2 className="h-4 w-4 animate-spin" /> : <LinkIcon className="h-4 w-4" />}
                    Import URL
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="m3u-file">Upload file</Label>
                <Input
                  id="m3u-file"
                  type="file"
                  accept=".m3u,.m3u8,text/plain,audio/x-mpegurl,application/vnd.apple.mpegurl"
                  disabled={isBusy}
                  onChange={(event) => {
                    const file = event.target.files?.[0] ?? null;
                    void importFromFile(file);
                    event.target.value = "";
                  }}
                />
                <p className="text-sm text-muted-foreground">
                  Supported extensions: .m3u, .m3u8
                </p>
              </div>

              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              {lastImportedCount !== null && lastImportedSource && (
                <Alert>
                  <FileUp className="h-4 w-4" />
                  <AlertDescription>
                    Imported {lastImportedCount} channels from {lastImportedSource}.
                  </AlertDescription>
                </Alert>
              )}

              <div className="flex flex-col gap-2 sm:flex-row">
                <Button
                  variant="secondary"
                  onClick={() => navigate("/player")}
                  disabled={isBusy}
                >
                  Open Player
                </Button>
                <Button
                  variant="outline"
                  onClick={() => navigate("/login")}
                  disabled={isBusy}
                >
                  Done
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
};

export default M3UImport;
