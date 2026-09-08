import { useCallback, useEffect, useRef, useState } from 'react';
import type { SessionSource } from '@lumen/session-core';
import {
  getOnDemandProgressScope, loadOnDemandProgress, onDemandProgressKey, saveOnDemandProgress,
  type OnDemandProgress,
} from '@/services/onDemandProgress';

export const useOnDemandHistory = () => {
  const [isLoading, setIsLoading] = useState(true);
  const [entries, setEntries] = useState<Record<string, OnDemandProgress>>({});
  useEffect(() => {
    let cancelled = false;
    void loadOnDemandProgress().then(result => { if (!cancelled) { setEntries(result); setIsLoading(false); } });
    return () => { cancelled = true; };
  }, []);
  return { entries, isLoading };
};

/** Save periodically, on pause/source changes, and before leaving the player. */
export const useSaveOnDemandProgress = (
  source: SessionSource | null, positionMs: number, durationMs: number, playback: string,
) => {
  const scope = useRef<Promise<string | null> | null>(null);
  const resolvedScope = useRef<string | null>(null);
  const latest = useRef<OnDemandProgress | null>(null);
  const lastSavedAt = useRef(0);
  const key = onDemandProgressKey(source?.metadata);

  const persist = useCallback((entry: OnDemandProgress | null) => {
    if (!entry) return;
    if (resolvedScope.current) { void saveOnDemandProgress(resolvedScope.current, entry); return; }
    if (scope.current) void scope.current.then(value => {
      if (value) return saveOnDemandProgress(value, entry);
    });
  }, []);

  useEffect(() => {
    scope.current = getOnDemandProgressScope();
    void scope.current.then(value => { resolvedScope.current = value; });
    const flush = () => persist(latest.current);
    const onVisibility = () => { if (document.visibilityState === 'hidden') flush(); };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      flush();
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [persist]);

  useEffect(() => {
    if (latest.current?.key !== key) {
      persist(latest.current);
      latest.current = null;
      lastSavedAt.current = 0;
    }
    if (!key || durationMs <= 0 || !Number.isFinite(durationMs) || !['playing', 'paused'].includes(playback)) return;
    const now = Date.now();
    latest.current = { key, positionMs, durationMs, updatedAt: now };
    if (playback === 'paused' || now - lastSavedAt.current >= 5_000) {
      persist(latest.current);
      lastSavedAt.current = now;
    }
  }, [key, positionMs, durationMs, playback, persist]);

  return useCallback(() => {
    if (!latest.current) return;
    latest.current = { ...latest.current, positionMs: latest.current.durationMs, updatedAt: Date.now() };
    persist(latest.current);
  }, [persist]);
};
