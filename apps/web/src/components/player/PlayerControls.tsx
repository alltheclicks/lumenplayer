import { useState, useEffect, useRef, useMemo, useCallback, type MutableRefObject } from 'react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  Play,
  Pause,
  Volume2,
  VolumeX,
  Maximize,
  Minimize,
  Heart,
  Clock,
  Cast,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  X,
  RotateCcw,
  SkipBack,
  SkipForward,
  Radio,
  Calendar,
  Languages,
  Captions,
  PictureInPicture2,
} from 'lucide-react';
import type { AudioTrackOption, PlayerChannel, Program, SubtitleTrackOption } from '@lumen/types';
import { ChannelLogo } from '@/components/player/ChannelLogo';
import { useSessionContext } from '@/context/session-context';
import { xtreamCodesService } from '@/services/xtreamService';
import type { VideoPlayerHandle } from '@/components/player/VideoPlayer';
import { IdleTimer, SeekEngine, type SeekDirection } from '@lumen/player-core';
import { formatDuration, formatTime } from '@lumen/core';
import { shouldRunControlsIdleTimer } from './controlsIdlePolicy';
import { resolveCatchUpEmptyStateReason } from './catchUpEmptyState';
import {
  canStartLiveTimeshift,
  isLiveTimeshiftActivationKey,
  resolveLiveTimeshiftAvailableDurationSeconds,
  resolveLiveTimeshiftPositionSeconds,
} from './liveTimeshift';
import { emitWebObservabilityEvent } from '@/services/observability';
import { resolveCatchUpPlaybackSource } from './catchupSource';
import { findCatchUpProgramById } from './catchupProgramNavigation';
import {
  resolveCatchUpTimelineDurationSeconds,
  resolveTimelineSeekPositionSeconds,
} from './timelineSeek';
import {
  buildLiveSessionSource,
  isCatchUpSessionSourceMetadata,
  parseSessionSourceMetadata,
} from './sessionSources';

interface PlayerControlsProps {
  channel: PlayerChannel;
  catchUpFallbackStreamIds?: number[];
  currentProgram?: Program;
  progress: number;
  isFavorite: boolean;
  isFullscreen: boolean;
  onToggleFavorite: () => void;
  onToggleFullscreen: () => void;
  onPrevChannel: () => void;
  onNextChannel: () => void;
  playerRef: MutableRefObject<VideoPlayerHandle | null>;
  defaultVolume?: number;
  catchUpPanelRequestKey?: number;
  castControl?: {
    isAvailable: boolean;
    isConnected: boolean;
    isConnecting: boolean;
    disabledReason?: string | null;
    onToggle: () => void;
  };
}

interface PendingSeekInteraction {
  direction: SeekDirection;
  tapStepSeconds: number;
}

interface CatchUpSwitchOptions {
  mediaOffsetSeconds?: number;
  timelineDurationSeconds?: number;
  pendingTimelineSeekSeconds?: number;
  initialPositionGuardSeconds?: number;
}

const LONG_PRESS_THRESHOLD_MS = 250;
const CONTROLS_IDLE_TIMEOUT_MS = 3000;
const CONTROLS_IDLE_GRACE_MS = 1000;
const CATCH_UP_REASON_REFRESH_MS = 60_000;
const CATCH_UP_INITIAL_POSITION_GUARD_SECONDS = 15;
const CATCH_UP_MEDIA_DURATION_TOLERANCE_SECONDS = 5;
const CATCH_UP_WINDOWED_SEEK_THRESHOLD_SECONDS = 45;
const groupProgramsByDate = (programs: Program[]): Map<string, Program[]> => {
  const grouped = new Map<string, Program[]>();
  const now = new Date();

  programs
    .filter(p => p.endTime < now && p.hasCatchUp)
    .forEach(program => {
      const dateKey = program.startTime.toDateString();
      if (!grouped.has(dateKey)) {
        grouped.set(dateKey, []);
      }
      grouped.get(dateKey)!.push(program);
    });

  grouped.forEach((progs, key) => {
    grouped.set(key, progs.sort((a, b) => b.startTime.getTime() - a.startTime.getTime()));
  });

  return grouped;
};

const formatFullDate = (date: Date): string => {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  if (date.toDateString() === today.toDateString()) return 'Danas';
  if (date.toDateString() === yesterday.toDateString()) return 'Juče';

  return date.toLocaleDateString('sr-Latn-RS', { weekday: 'long', day: 'numeric', month: 'long' });
};


const PlayerControls = ({
  channel,
  catchUpFallbackStreamIds = [],
  currentProgram,
  progress,
  isFavorite,
  isFullscreen,
  onToggleFavorite,
  onToggleFullscreen,
  onPrevChannel,
  onNextChannel,
  playerRef,
  defaultVolume = 80,
  catchUpPanelRequestKey,
  castControl,
}: PlayerControlsProps) => {
  const { session, commands } = useSessionContext();
  const normalizedDefaultVolume = Math.max(0, Math.min(100, Math.round(defaultVolume)));
  const [showControls, setShowControls] = useState(true);
  const [volume, setVolume] = useState(normalizedDefaultVolume);
  const [isMuted, setIsMuted] = useState(false);
  const [showCatchUp, setShowCatchUp] = useState(false);
  const [showAudioTracks, setShowAudioTracks] = useState(false);
  const [showSubtitleTracks, setShowSubtitleTracks] = useState(false);
  const [showVolumeSlider, setShowVolumeSlider] = useState(false);
  const [audioTracks, setAudioTracks] = useState<AudioTrackOption[]>([]);
  const [selectedAudioTrackId, setSelectedAudioTrackId] = useState<string | null>(null);
  const [subtitleTracks, setSubtitleTracks] = useState<SubtitleTrackOption[]>([]);
  const [selectedSubtitleTrackId, setSelectedSubtitleTrackId] = useState<string | null>(null);
  const [isPictureInPictureSupported, setIsPictureInPictureSupported] = useState(false);
  const [isPictureInPicture, setIsPictureInPicture] = useState(false);
  const [openDays, setOpenDays] = useState<string[]>([]);
  const [catchUpReasonNowMs, setCatchUpReasonNowMs] = useState(() => Date.now());
  const [hoverPosition, setHoverPosition] = useState<number | null>(null);
  const [isSeeking, setIsSeeking] = useState(false);
  const [seekPreviewPosition, setSeekPreviewPosition] = useState<number | null>(null);
  const [mediaDurationSeconds, setMediaDurationSeconds] = useState<number | null>(null);
  const [isLiveProgressFocused, setIsLiveProgressFocused] = useState(false);
  const lastNonZeroVolumeRef = useRef(normalizedDefaultVolume || 80);
  const lastCatchUpPanelRequestKeyRef = useRef(catchUpPanelRequestKey);
  const seekEngineRef = useRef<SeekEngine | null>(null);
  const idleTimerRef = useRef<IdleTimer | null>(null);
  const seekHoldTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSeekInteractionRef = useRef<PendingSeekInteraction | null>(null);
  const seekHoldActiveRef = useRef(false);

  const sessionSourceMetadata = useMemo(
    () => parseSessionSourceMetadata(session.source?.metadata),
    [session.source?.metadata]
  );
  const catchUpProgram = useMemo(() => {
    if (!isCatchUpSessionSourceMetadata(sessionSourceMetadata)) {
      return null;
    }

    return findCatchUpProgramById(channel.epg, sessionSourceMetadata.programId);
  }, [channel.epg, sessionSourceMetadata]);
  const catchUpPosition = catchUpProgram
    ? Math.max(0, (session.positionMs ?? 0) / 1000)
    : 0;
  const isPlaying = session.playback === 'playing' || session.playback === 'buffering';

  const catchUpDurationBase = catchUpProgram
    ? isCatchUpSessionSourceMetadata(sessionSourceMetadata) && sessionSourceMetadata.durationSeconds > 0
      ? sessionSourceMetadata.durationSeconds
      : (catchUpProgram.endTime.getTime() - catchUpProgram.startTime.getTime()) / 1000
    : 0;
  const catchUpMediaOffsetSeconds = isCatchUpSessionSourceMetadata(sessionSourceMetadata)
    ? Math.max(0, Math.floor(sessionSourceMetadata.catchUpMediaOffsetSeconds ?? 0))
    : 0;
  const catchUpDuration = resolveCatchUpTimelineDurationSeconds({
    baseDurationSeconds: catchUpDurationBase,
    mediaDurationSeconds,
    mediaOffsetSeconds: catchUpMediaOffsetSeconds,
    toleranceSeconds: CATCH_UP_MEDIA_DURATION_TOLERANCE_SECONDS,
  });
  const effectiveCatchUpPosition = catchUpProgram
    ? Math.max(
      0,
      Math.min(catchUpDuration, seekPreviewPosition ?? catchUpPosition)
    )
    : 0;
  const catchUpProgressPercent = catchUpDuration > 0
    ? (effectiveCatchUpPosition / catchUpDuration) * 100
    : 0;

  const catchUpByDate = groupProgramsByDate(channel.epg);
  const sortedDates = Array.from(catchUpByDate.keys()).sort((a, b) =>
    new Date(b).getTime() - new Date(a).getTime()
  );
  const catchUpEmptyStateReason = useMemo(
    () => resolveCatchUpEmptyStateReason(channel, new Date(catchUpReasonNowMs)),
    [channel, catchUpReasonNowMs]
  );
  const nowMs = Date.now();
  const hasArchivedCatchUpPrograms = channel.epg.some((program) => (
    program.hasCatchUp && program.endTime.getTime() <= nowMs
  ));
  const canTimeshiftFromLiveBar = canStartLiveTimeshift(channel.hasCatchUp, currentProgram, nowMs, {
    allowWithoutCurrentProgramArchive: hasArchivedCatchUpPrograms,
  });
  const hasMultipleAudioTracks = audioTracks.length > 1;
  const hasSubtitleTracks = subtitleTracks.length > 0;
  const shouldUseControlsIdleTimer = shouldRunControlsIdleTimer({
    isFullscreen,
    showCatchUp,
    showAudioTracks,
    showSubtitleTracks,
    isSeeking,
  });
  const selectedSubtitleTrackLabel = useMemo(() => {
    if (selectedSubtitleTrackId === null) {
      return 'Isključeno';
    }

    return subtitleTracks.find((track) => track.id === selectedSubtitleTrackId)?.label ?? 'Nepoznato';
  }, [selectedSubtitleTrackId, subtitleTracks]);

  useEffect(() => {
    if (
      catchUpPanelRequestKey === undefined ||
      catchUpPanelRequestKey === lastCatchUpPanelRequestKeyRef.current
    ) {
      return;
    }

    lastCatchUpPanelRequestKeyRef.current = catchUpPanelRequestKey;
    setShowAudioTracks(false);
    setShowSubtitleTracks(false);
    setShowVolumeSlider(false);
    setShowControls(true);
    setShowCatchUp(true);
  }, [catchUpPanelRequestKey]);

  useEffect(() => {
    setVolume(normalizedDefaultVolume);
    if (normalizedDefaultVolume > 0) {
      lastNonZeroVolumeRef.current = normalizedDefaultVolume;
    }
    playerRef.current?.setVolume(normalizedDefaultVolume / 100);
    const nextMuted = normalizedDefaultVolume === 0;
    setIsMuted(nextMuted);
    playerRef.current?.setMuted(nextMuted);
  }, [normalizedDefaultVolume, playerRef]);

  useEffect(() => {
    const seekEngine = new SeekEngine();
    seekEngineRef.current = seekEngine;

    const unsubscribe = seekEngine.onStateChange(state => {
      setSeekPreviewPosition(state.active ? state.time : null);
      if (!state.active) {
        setIsSeeking(false);
      }
    });

    return () => {
      if (seekHoldTimeoutRef.current) {
        clearTimeout(seekHoldTimeoutRef.current);
        seekHoldTimeoutRef.current = null;
      }
      pendingSeekInteractionRef.current = null;
      seekHoldActiveRef.current = false;
      unsubscribe();
      seekEngine.destroy();
      seekEngineRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!catchUpProgram) {
      setMediaDurationSeconds(null);
      return;
    }

    const syncMediaDuration = () => {
      const duration = playerRef.current?.getDuration() ?? 0;
      if (!Number.isFinite(duration) || duration <= 0) {
        return;
      }

      setMediaDurationSeconds(duration);
    };

    syncMediaDuration();
    const intervalId = window.setInterval(syncMediaDuration, 1_000);
    return () => {
      window.clearInterval(intervalId);
    };
  }, [catchUpProgram, playerRef, session.source]);

  useEffect(() => {
    const idleTimer = new IdleTimer(
      () => setShowControls(false),
      {
        timeoutMs: CONTROLS_IDLE_TIMEOUT_MS,
        graceMs: CONTROLS_IDLE_GRACE_MS,
      }
    );
    idleTimerRef.current = idleTimer;

    return () => {
      idleTimer.destroy();
      idleTimerRef.current = null;
    };
  }, []);

  const resetControlsIdleTimer = useCallback(() => {
    const idleTimer = idleTimerRef.current;
    if (!idleTimer) {
      return;
    }

    if (!shouldUseControlsIdleTimer) {
      return;
    }

    if (idleTimer.isInGracePeriod()) {
      return;
    }

    setShowControls(true);
    idleTimer.reset();
  }, [shouldUseControlsIdleTimer]);

  useEffect(() => {
    const idleTimer = idleTimerRef.current;
    if (!idleTimer) {
      return;
    }

    if (!shouldUseControlsIdleTimer) {
      idleTimer.clear();
      setShowControls(true);
      return;
    }

    if (showControls) {
      idleTimer.reset();
    }
  }, [shouldUseControlsIdleTimer, showControls]);

  useEffect(() => {
    if (isFullscreen) {
      return;
    }

    const handleWindowActivity = () => {
      resetControlsIdleTimer();
    };

    window.addEventListener('mousemove', handleWindowActivity, { passive: true });
    window.addEventListener('touchstart', handleWindowActivity, { passive: true });

    return () => {
      window.removeEventListener('mousemove', handleWindowActivity);
      window.removeEventListener('touchstart', handleWindowActivity);
    };
  }, [isFullscreen, resetControlsIdleTimer]);

  const syncAudioTracks = useCallback(() => {
    const tracks = playerRef.current?.getAudioTracks() ?? [];
    setAudioTracks(tracks);
    setSelectedAudioTrackId(playerRef.current?.getSelectedAudioTrackId() ?? null);

    if (tracks.length <= 1) {
      setShowAudioTracks(false);
    }
  }, [playerRef]);

  const syncSubtitleTracks = useCallback(() => {
    const tracks = playerRef.current?.getSubtitleTracks() ?? [];
    setSubtitleTracks(tracks);
    setSelectedSubtitleTrackId(playerRef.current?.getSelectedSubtitleTrackId() ?? null);

    if (tracks.length === 0) {
      setShowSubtitleTracks(false);
    }
  }, [playerRef]);

  useEffect(() => {
    if (!session.source) {
      setAudioTracks([]);
      setSelectedAudioTrackId(null);
      setShowAudioTracks(false);
      setShowVolumeSlider(false);
      setSubtitleTracks([]);
      setSelectedSubtitleTrackId(null);
      setShowSubtitleTracks(false);
      return;
    }

    const unsubscribe = playerRef.current?.onAudioTracksChange((tracks, selectedTrackId) => {
      setAudioTracks(tracks);
      setSelectedAudioTrackId(selectedTrackId);
      if (tracks.length <= 1) {
        setShowAudioTracks(false);
      }
    }) ?? (() => {});

    syncAudioTracks();
    return () => {
      unsubscribe();
    };
  }, [playerRef, session.source, syncAudioTracks]);

  useEffect(() => {
    if (!session.source) {
      setSubtitleTracks([]);
      setSelectedSubtitleTrackId(null);
      setShowSubtitleTracks(false);
      setIsPictureInPicture(false);
      setIsPictureInPictureSupported(false);
      return;
    }

    const unsubscribe = playerRef.current?.onSubtitleTracksChange((tracks, selectedTrackId) => {
      setSubtitleTracks(tracks);
      setSelectedSubtitleTrackId(selectedTrackId);
      if (tracks.length === 0) {
        setShowSubtitleTracks(false);
      }
    }) ?? (() => {});

    syncSubtitleTracks();
    return () => {
      unsubscribe();
    };
  }, [playerRef, session.source, syncSubtitleTracks]);

  useEffect(() => {
    const intervalId = globalThis.setInterval(() => {
      setCatchUpReasonNowMs(Date.now());
    }, CATCH_UP_REASON_REFRESH_MS);

    return () => {
      globalThis.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    if (!session.source) {
      setIsPictureInPicture(false);
      setIsPictureInPictureSupported(false);
      return;
    }

    const player = playerRef.current;
    if (!player) {
      setIsPictureInPicture(false);
      setIsPictureInPictureSupported(false);
      return;
    }

    setIsPictureInPictureSupported(player.isPictureInPictureSupported());
    setIsPictureInPicture(player.isPictureInPicture());

    return player.onPictureInPictureChange((inPictureInPicture) => {
      setIsPictureInPicture(inPictureInPicture);
      setIsPictureInPictureSupported(player.isPictureInPictureSupported());
    });
  }, [playerRef, session.source]);

  const handleMouseMove = useCallback(() => {
    resetControlsIdleTimer();
  }, [resetControlsIdleTimer]);

  const handleClick = useCallback(() => {
    if (showCatchUp) {
      setShowCatchUp(false);
      resetControlsIdleTimer();
    } else if (showAudioTracks) {
      setShowAudioTracks(false);
      resetControlsIdleTimer();
    } else if (showSubtitleTracks) {
      setShowSubtitleTracks(false);
      resetControlsIdleTimer();
    } else if (showVolumeSlider) {
      setShowVolumeSlider(false);
      resetControlsIdleTimer();
    } else {
      const idleTimer = idleTimerRef.current;
      if (!showControls && idleTimer?.isInGracePeriod()) {
        return;
      }

      setShowControls(prev => {
        const nextShowControls = !prev;
        if (
          idleTimer &&
          shouldUseControlsIdleTimer
        ) {
          if (nextShowControls) {
            idleTimer.reset();
          } else {
            idleTimer.clear();
          }
        }
        return nextShowControls;
      });
    }
  }, [
    shouldUseControlsIdleTimer,
    resetControlsIdleTimer,
    showAudioTracks,
    showCatchUp,
    showControls,
    showVolumeSlider,
    showSubtitleTracks,
  ]);

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newVolume = parseInt(e.target.value);
    setVolume(newVolume);
    playerRef.current?.setVolume(newVolume / 100);

    if (newVolume > 0) {
      lastNonZeroVolumeRef.current = newVolume;
    }

    const nextMuted = newVolume === 0;
    if (nextMuted !== isMuted) {
      setIsMuted(nextMuted);
      playerRef.current?.setMuted(nextMuted);
    }
  };

  const toggleMute = useCallback(() => {
    setIsMuted(prev => {
      const nextMuted = !prev;
      if (!nextMuted && volume === 0) {
        const restoredVolume = lastNonZeroVolumeRef.current;
        setVolume(restoredVolume);
        playerRef.current?.setVolume(restoredVolume / 100);
      }
      playerRef.current?.setMuted(nextMuted);
      return nextMuted;
    });
  }, [playerRef, volume]);

  const handleMuteAction = useCallback(() => {
    setShowVolumeSlider(true);
    resetControlsIdleTimer();
    toggleMute();
  }, [resetControlsIdleTimer, toggleMute]);

  const handleToggleVolumeSlider = useCallback(() => {
    setShowAudioTracks(false);
    setShowSubtitleTracks(false);
    setShowVolumeSlider((prev) => !prev);
    resetControlsIdleTimer();
  }, [resetControlsIdleTimer]);

  useEffect(() => {
    if (!showControls) {
      setShowVolumeSlider(false);
    }
  }, [showControls]);

  const toggleDay = (dateKey: string) => {
    setOpenDays(prev =>
      prev.includes(dateKey)
        ? prev.filter(d => d !== dateKey)
        : [...prev, dateKey]
    );
  };

  const switchToLive = useCallback(() => {
    const source = buildLiveSessionSource({
      channel,
      sourceUrl: xtreamCodesService.getLiveStreamUrl(channel.streamId),
    });

    playerRef.current?.stop();
    commands.setSource(source, 0);
    commands.play();
  }, [channel, commands, playerRef]);

  const switchToCatchUpProgram = useCallback(async (
    program: Program,
    preferredPositionSeconds = 0,
    options: CatchUpSwitchOptions = {},
  ): Promise<number | null> => {
    const startTimestamp = Math.floor(program.startTime.getTime() / 1000);
    const fullDuration = Math.floor(
      (program.endTime.getTime() - program.startTime.getTime()) / 1000
    );
    const availableDuration = Math.floor(resolveLiveTimeshiftAvailableDurationSeconds(program));
    const duration = Math.max(
      1,
      Math.min(fullDuration, availableDuration > 0 ? availableDuration : fullDuration)
    );
    const mediaOffsetSeconds = Math.max(0, Math.floor(options.mediaOffsetSeconds ?? 0));
    const timelineDurationSeconds = Math.max(
      duration,
      Math.floor(options.timelineDurationSeconds ?? duration),
    );
    const playbackDuration = Math.max(1, duration - mediaOffsetSeconds);
    const playbackProgram = mediaOffsetSeconds > 0
      ? {
        ...program,
        startTime: new Date(program.startTime.getTime() + mediaOffsetSeconds * 1000),
        endTime: new Date(program.startTime.getTime() + (mediaOffsetSeconds + playbackDuration) * 1000),
      }
      : program;
    try {
      const resolved = await resolveCatchUpPlaybackSource({
        channel,
        program: playbackProgram,
        urlBuilder: xtreamCodesService,
        fallbackStreamIds: catchUpFallbackStreamIds,
        durationSeconds: playbackDuration,
        preferredPositionSeconds,
        initialPositionGuardSeconds: options.initialPositionGuardSeconds ?? 0,
      });
      const catchUpFallbackUrls = resolved.transportPlan.fallbackAttempts.map((attempt) => attempt.url);
      const pendingTimelineSeekSeconds = typeof options.pendingTimelineSeekSeconds === 'number' &&
        Number.isFinite(options.pendingTimelineSeekSeconds)
        ? Math.max(0, options.pendingTimelineSeekSeconds)
        : 0;
      const pendingTimelineSeekMs = pendingTimelineSeekSeconds > 0
        ? Math.floor(pendingTimelineSeekSeconds * 1000)
        : null;
      const pendingMediaSeekSeconds = pendingTimelineSeekSeconds > 0
        ? Math.max(0, pendingTimelineSeekSeconds - mediaOffsetSeconds)
        : null;
      const initialTimelinePositionSeconds = mediaOffsetSeconds + resolved.initialPositionSeconds;
      const source = mediaOffsetSeconds > 0 || timelineDurationSeconds !== duration || pendingTimelineSeekMs !== null
        ? {
          ...resolved.source,
          metadata: {
            ...(resolved.source.metadata ?? {}),
            durationSeconds: timelineDurationSeconds,
            catchUpMediaOffsetSeconds: mediaOffsetSeconds,
            ...(pendingTimelineSeekMs !== null
              ? {
                catchUpPendingTimelineSeekMs: pendingTimelineSeekMs,
                catchUpPendingMediaSeekSeconds: pendingMediaSeekSeconds,
              }
              : {}),
          },
        }
        : resolved.source;
      emitWebObservabilityEvent({
        name: 'catchup.requested',
        severity: 'info',
        metadata: {
          channelId: channel.id,
          streamId: channel.streamId,
          programId: program.id,
          start: startTimestamp,
          duration,
          attempt: 1,
          status: 'requested',
          finalHost: null,
          errorCode: null,
          fullDurationSeconds: timelineDurationSeconds,
          mediaOffsetSeconds,
          initialStrategy: resolved.transportPlan.initialAttempt.strategy,
          initialStartTs: resolved.transportPlan.initialAttempt.startTimestamp,
          fallbackStreamIds: catchUpFallbackStreamIds,
          fallbackCount: catchUpFallbackUrls.length,
          initialPositionSeconds: resolved.initialPositionSeconds,
          transportMode: resolved.gateway?.transportMode ?? 'provider-direct',
          assetKey: resolved.gateway?.assetKey ?? null,
          hotStart: resolved.gateway?.hotStart ?? false,
          fallbackReason: resolved.gateway?.fallbackReason ?? null,
          pendingTimelineSeekMs,
          pendingMediaSeekSeconds,
        },
      });

      playerRef.current?.stop();
      commands.setSource(source, Math.floor(initialTimelinePositionSeconds * 1000));
      commands.play();
      return initialTimelinePositionSeconds;
    } catch (error) {
      emitWebObservabilityEvent({
        name: 'playback.error',
        severity: 'error',
        metadata: {
          channelId: channel.id,
          streamId: channel.streamId,
          programId: program.id,
          status: 'catchup_resolve_failed',
          errorCode: error instanceof Error ? error.message : 'unknown_error',
        },
      });
      return null;
    }
  }, [catchUpFallbackStreamIds, channel, commands, playerRef]);

  const updateCatchUpPosition = useCallback((
    positionSeconds: number,
  ) => {
    if (!catchUpProgram) {
      return;
    }

    const clampedPositionSeconds = Math.max(0, Math.min(catchUpDuration, positionSeconds));
    const seekDeltaSeconds = Math.abs(clampedPositionSeconds - effectiveCatchUpPosition);
    if (seekDeltaSeconds >= CATCH_UP_WINDOWED_SEEK_THRESHOLD_SECONDS) {
      const mediaOffsetSeconds = Math.max(
        0,
        Math.floor(clampedPositionSeconds - CATCH_UP_INITIAL_POSITION_GUARD_SECONDS),
      );
      void switchToCatchUpProgram(catchUpProgram, CATCH_UP_INITIAL_POSITION_GUARD_SECONDS, {
        mediaOffsetSeconds,
        timelineDurationSeconds: catchUpDuration,
        pendingTimelineSeekSeconds: clampedPositionSeconds,
        initialPositionGuardSeconds: CATCH_UP_INITIAL_POSITION_GUARD_SECONDS,
      });
      return;
    }

    playerRef.current?.seek(clampedPositionSeconds);
    commands.seek(Math.floor(clampedPositionSeconds * 1000));
  }, [
    catchUpDuration,
    catchUpProgram,
    commands,
    effectiveCatchUpPosition,
    playerRef,
    switchToCatchUpProgram,
  ]);

  const togglePlay = useCallback(() => {
    if (isPlaying) {
      playerRef.current?.pause();
      commands.pause();
      return;
    }

    playerRef.current?.play();
    commands.play();
  }, [commands, isPlaying, playerRef]);

  const handleSelectProgram = (program: Program) => {
    void switchToCatchUpProgram(program);
    setShowCatchUp(false);
  };

  const startLiveTimeshiftAtRatio = useCallback((ratio: number) => {
    if (!canTimeshiftFromLiveBar || !currentProgram) {
      return;
    }

    void switchToCatchUpProgram(currentProgram, resolveLiveTimeshiftPositionSeconds(currentProgram, ratio));
  }, [canTimeshiftFromLiveBar, currentProgram, switchToCatchUpProgram]);

  const handleLiveProgressClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (!canTimeshiftFromLiveBar) {
      return;
    }

    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) {
      startLiveTimeshiftAtRatio(progress / 100);
      return;
    }

    const clickRatio = (event.clientX - rect.left) / rect.width;
    startLiveTimeshiftAtRatio(clickRatio);
  }, [canTimeshiftFromLiveBar, progress, startLiveTimeshiftAtRatio]);

  const handleLiveProgressKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!canTimeshiftFromLiveBar || !isLiveTimeshiftActivationKey(event.key)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    startLiveTimeshiftAtRatio(progress / 100);
  }, [canTimeshiftFromLiveBar, progress, startLiveTimeshiftAtRatio]);

  const goToLive = () => {
    switchToLive();
  };

  const handleCatchUpAction = useCallback(() => {
    setShowAudioTracks(false);
    setShowSubtitleTracks(false);
    setShowVolumeSlider(false);
    setShowControls(true);
    setShowCatchUp(true);
  }, []);

  const handleSeek = (e: React.MouseEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>) => {
    if (!catchUpProgram) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0]?.clientX : e.clientX;
    const newPosition = resolveTimelineSeekPositionSeconds({
      clientX,
      timelineLeft: rect.left,
      timelineWidth: rect.width,
      durationSeconds: catchUpDuration,
      fallbackPositionSeconds: effectiveCatchUpPosition,
    });

    updateCatchUpPosition(newPosition);
  };

  const handleProgressHover = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!catchUpProgram) return;

    const rect = e.currentTarget.getBoundingClientRect();
    setHoverPosition(resolveTimelineSeekPositionSeconds({
      clientX: e.clientX,
      timelineLeft: rect.left,
      timelineWidth: rect.width,
      durationSeconds: catchUpDuration,
      fallbackPositionSeconds: effectiveCatchUpPosition,
    }));
  };

  const applySeekStep = useCallback((direction: SeekDirection, seconds: number) => {
    const delta = direction === 'forward' ? seconds : -seconds;
    const nextPosition = Math.max(
      0,
      Math.min(catchUpDuration, effectiveCatchUpPosition + delta)
    );
    updateCatchUpPosition(nextPosition);
  }, [catchUpDuration, effectiveCatchUpPosition, updateCatchUpPosition]);

  const clearSeekHoldTimeout = useCallback(() => {
    if (seekHoldTimeoutRef.current) {
      clearTimeout(seekHoldTimeoutRef.current);
      seekHoldTimeoutRef.current = null;
    }
  }, []);

  const finishPendingSeekInteraction = useCallback((applyTapStep: boolean) => {
    const pendingInteraction = pendingSeekInteractionRef.current;
    pendingSeekInteractionRef.current = null;
    clearSeekHoldTimeout();

    const seekEngine = seekEngineRef.current;
    if (seekHoldActiveRef.current && seekEngine) {
      const finalPosition = seekEngine.stop();
      seekHoldActiveRef.current = false;
      updateCatchUpPosition(finalPosition);
      return;
    }

    setIsSeeking(false);
    setSeekPreviewPosition(null);

    if (!applyTapStep || !pendingInteraction) {
      return;
    }

    applySeekStep(pendingInteraction.direction, pendingInteraction.tapStepSeconds);
  }, [applySeekStep, clearSeekHoldTimeout, updateCatchUpPosition]);

  const startPendingSeekInteraction = useCallback(
    (direction: SeekDirection, tapStepSeconds: number) => {
      if (!catchUpProgram || catchUpDuration <= 0) {
        return;
      }

      pendingSeekInteractionRef.current = { direction, tapStepSeconds };
      clearSeekHoldTimeout();

      seekHoldTimeoutRef.current = setTimeout(() => {
        if (!pendingSeekInteractionRef.current) {
          return;
        }

        const seekEngine = seekEngineRef.current;
        if (!seekEngine) {
          return;
        }

        seekHoldActiveRef.current = true;
        setIsSeeking(true);
        seekEngine.start(direction, effectiveCatchUpPosition, catchUpDuration);
      }, LONG_PRESS_THRESHOLD_MS);
    },
    [catchUpDuration, catchUpProgram, clearSeekHoldTimeout, effectiveCatchUpPosition]
  );

  useEffect(() => {
    if (catchUpProgram) {
      return;
    }

    finishPendingSeekInteraction(false);
  }, [catchUpProgram, finishPendingSeekInteraction]);

  const handleSeekButtonPointerDown = useCallback((
    event: React.PointerEvent<HTMLButtonElement>,
    direction: SeekDirection,
    tapStepSeconds: number
  ) => {
    event.preventDefault();
    event.stopPropagation();
    startPendingSeekInteraction(direction, tapStepSeconds);
  }, [startPendingSeekInteraction]);

  const handleSeekButtonPointerUp = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    finishPendingSeekInteraction(true);
  }, [finishPendingSeekInteraction]);

  const handleSeekButtonPointerCancel = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    finishPendingSeekInteraction(false);
  }, [finishPendingSeekInteraction]);

  const preventSeekContextMenu = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
  }, []);

  const handleSelectAudioTrack = useCallback((trackId: string) => {
    const applied = playerRef.current?.setAudioTrack(trackId) ?? false;
    if (!applied) {
      return;
    }

    setSelectedAudioTrackId(trackId);
    setShowAudioTracks(false);
  }, [playerRef]);

  const handleSelectSubtitleTrack = useCallback((trackId: string | null) => {
    const applied = playerRef.current?.setSubtitleTrack(trackId) ?? false;
    if (!applied) {
      return;
    }

    setSelectedSubtitleTrackId(trackId);
    setShowSubtitleTracks(false);
  }, [playerRef]);

  const handleTogglePictureInPicture = useCallback(() => {
    if (!isPictureInPictureSupported) {
      return;
    }

    void playerRef.current?.togglePictureInPicture();
  }, [isPictureInPictureSupported, playerRef]);

  const audioTrackPanel = hasMultipleAudioTracks && showAudioTracks ? (
    <div
      className="absolute bottom-16 right-3 z-30 w-64 rounded-lg border border-border/80 bg-background/95 p-2 shadow-2xl backdrop-blur-md sm:bottom-20 sm:right-4"
      onClick={(event) => event.stopPropagation()}
    >
      <p className="px-2 pb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Audio trake
      </p>
      <div className="max-h-56 space-y-1 overflow-y-auto">
        {audioTracks.map((track) => (
          <button
            key={track.id}
            className={`w-full rounded-md px-2 py-2 text-left text-sm transition-colors ${
              selectedAudioTrackId === track.id
                ? 'bg-primary/20 text-primary'
                : 'hover:bg-secondary/60'
            }`}
            onClick={() => handleSelectAudioTrack(track.id)}
          >
            <span className="block truncate font-medium">{track.label}</span>
            <span className="block text-xs text-muted-foreground">
              {track.language || 'Nepoznat jezik'}
              {track.isDefault ? ' • podrazumevano' : ''}
            </span>
          </button>
        ))}
      </div>
    </div>
  ) : null;

  const subtitleTrackPanel = hasSubtitleTracks && showSubtitleTracks ? (
    <div
      className="absolute bottom-16 right-3 z-30 w-64 rounded-lg border border-border/80 bg-background/95 p-2 shadow-2xl backdrop-blur-md sm:bottom-20 sm:right-4"
      onClick={(event) => event.stopPropagation()}
    >
      <p className="px-2 pb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Titlovi
      </p>
      <div className="max-h-56 space-y-1 overflow-y-auto">
        <button
          className={`w-full rounded-md px-2 py-2 text-left text-sm transition-colors ${
            selectedSubtitleTrackId === null
              ? 'bg-primary/20 text-primary'
              : 'hover:bg-secondary/60'
          }`}
          onClick={() => handleSelectSubtitleTrack(null)}
        >
          <span className="block truncate font-medium">Isključeno</span>
          <span className="block text-xs text-muted-foreground">Isključi titlove</span>
        </button>
        {subtitleTracks.map((track) => (
          <button
            key={track.id}
            className={`w-full rounded-md px-2 py-2 text-left text-sm transition-colors ${
              selectedSubtitleTrackId === track.id
                ? 'bg-primary/20 text-primary'
                : 'hover:bg-secondary/60'
            }`}
            onClick={() => handleSelectSubtitleTrack(track.id)}
          >
            <span className="block truncate font-medium">{track.label}</span>
            <span className="block text-xs text-muted-foreground">
              {track.language || 'Nepoznat jezik'}
              {track.isDefault ? ' • podrazumevano' : ''}
            </span>
          </button>
        ))}
      </div>
    </div>
  ) : null;

  if (!isFullscreen) {
    return (
      <>
        {audioTrackPanel}
        {subtitleTrackPanel}
        {showCatchUp && (
          <div
            className="fixed inset-0 z-50 w-full bg-background/95 backdrop-blur-md sm:absolute sm:inset-auto sm:bottom-0 sm:right-0 sm:top-0 sm:z-40 sm:w-96 sm:border-l sm:border-border/50"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex h-full flex-col">
              <div className="flex items-center justify-between border-b border-border/50 p-4">
                <div className="flex items-center gap-2">
                  <RotateCcw className="h-5 w-5 text-primary" />
                  <h3 className="text-lg font-semibold">Gledanje unazad</h3>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  aria-label="Zatvori TV unazad"
                  onClick={() => setShowCatchUp(false)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>

              {catchUpProgram && (
                <div className="border-b border-border/50 p-3">
                  <Button
                    className="w-full gap-2"
                    variant="default"
                    onClick={goToLive}
                  >
                    <Radio className="h-4 w-4" />
                    Vrati se na UŽIVO
                  </Button>
                </div>
              )}

              <ScrollArea className="flex-1">
                <div className="space-y-2 p-3">
                  {sortedDates.length === 0 ? (
                    <div className="py-8 text-center text-muted-foreground">
                      <Clock className="mx-auto mb-2 h-12 w-12 opacity-50" />
                      <p className="font-medium">{catchUpEmptyStateReason.title}</p>
                      <p className="mt-1 text-xs text-muted-foreground/90">
                        {catchUpEmptyStateReason.description}
                      </p>
                    </div>
                  ) : (
                    sortedDates.map((dateKey) => {
                      const programs = catchUpByDate.get(dateKey) || [];
                      const isOpen = openDays.includes(dateKey);

                      return (
                        <Collapsible
                          key={dateKey}
                          open={isOpen}
                          onOpenChange={() => toggleDay(dateKey)}
                        >
                          <CollapsibleTrigger className="w-full">
                            <div className="flex items-center justify-between rounded-lg bg-secondary/50 p-3 transition-colors hover:bg-secondary">
                              <div className="flex items-center gap-2">
                                <Calendar className="h-4 w-4 text-muted-foreground" />
                                <span className="text-sm font-medium">
                                  {formatFullDate(new Date(dateKey))}
                                </span>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="text-xs text-muted-foreground">
                                  {programs.length} emisija
                                </span>
                                <ChevronDown className={`h-4 w-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                              </div>
                            </div>
                          </CollapsibleTrigger>
                          <CollapsibleContent>
                            <div className="mt-1 space-y-1">
                              {programs.map((program) => (
                                <button
                                  key={program.id}
                                  data-testid="catchup-program"
                                  onClick={() => handleSelectProgram(program)}
                                  className={`w-full rounded-lg p-3 text-left transition-colors ${
                                    catchUpProgram?.id === program.id
                                      ? 'border border-primary/50 bg-primary/20'
                                      : 'bg-secondary/30 hover:bg-secondary/60'
                                  }`}
                                >
                                  <div className="flex items-start gap-3">
                                    <div className="mt-0.5 text-xs tabular-nums text-muted-foreground">
                                      {formatTime(program.startTime)}
                                    </div>
                                    <div className="min-w-0 flex-1">
                                      <p className="truncate text-sm font-medium">{program.title}</p>
                                      {program.description && (
                                        <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                                          {program.description}
                                        </p>
                                      )}
                                    </div>
                                    <Play className="mt-0.5 h-4 w-4 flex-shrink-0 text-primary" />
                                  </div>
                                </button>
                              ))}
                            </div>
                          </CollapsibleContent>
                        </Collapsible>
                      );
                    })
                  )}
                </div>
              </ScrollArea>
            </div>
          </div>
        )}
        <div className={`absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/95 via-black/60 to-transparent p-2.5 sm:p-6 transition-all duration-300 ${showControls && !showCatchUp ? 'opacity-100 translate-y-0' : 'pointer-events-none opacity-0 translate-y-4'}`}>
        <div className="mb-2 flex items-center gap-2 sm:mb-4 sm:gap-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-background/10 backdrop-blur sm:h-16 sm:w-16 sm:rounded-2xl">
            <ChannelLogo logo={channel.logo} name={channel.name} size="lg" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="mb-1 flex items-center gap-2">
              <span className={`badge-live ${catchUpProgram ? 'bg-orange-500' : ''}`}>
                {catchUpProgram ? 'UNAZAD' : 'UŽIVO'}
              </span>
            </div>
            <h3 className="truncate text-sm font-semibold text-foreground sm:text-xl">{channel.name}</h3>
            {(catchUpProgram || currentProgram) && (
              <p className="truncate text-xs text-muted-foreground sm:text-sm">{catchUpProgram?.title || currentProgram?.title}</p>
            )}
          </div>
        </div>

        {catchUpProgram ? (
          <div className="mb-2 sm:mb-4">
            <div
              data-testid="catchup-timeline"
              className="h-1.5 bg-secondary/50 rounded-full overflow-hidden cursor-pointer"
              onClick={handleSeek}
            >
              <div
                className="h-full bg-primary rounded-full transition-all"
                style={{
                  width: `${catchUpProgressPercent}%`
                }}
              />
            </div>
            <div className="flex justify-between mt-1 text-xs text-muted-foreground">
              <span>{formatDuration(effectiveCatchUpPosition)}</span>
              <span>{formatDuration(catchUpDuration)}</span>
            </div>
          </div>
        ) : (
          <div
            className={`group/livebar relative mb-2 h-1 rounded-full bg-secondary/50 overflow-visible transition-all sm:mb-4 ${
              canTimeshiftFromLiveBar
                ? 'cursor-pointer hover:h-1.5 focus-visible:h-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70 focus-visible:ring-offset-2 focus-visible:ring-offset-black'
                : ''
            }`}
            onClick={handleLiveProgressClick}
            onKeyDown={handleLiveProgressKeyDown}
            onFocus={() => setIsLiveProgressFocused(true)}
            onBlur={() => setIsLiveProgressFocused(false)}
            role={canTimeshiftFromLiveBar ? 'button' : undefined}
            tabIndex={canTimeshiftFromLiveBar ? 0 : -1}
            aria-label={canTimeshiftFromLiveBar ? 'Pokreni TV unazad sa ove pozicije' : undefined}
          >
            <div className="h-full bg-primary rounded-full transition-all relative" style={{ width: `${progress}%` }}>
              <div
                className={`absolute right-0 top-1/2 h-3 w-3 -translate-y-1/2 rounded-full border border-primary/40 bg-primary shadow-[0_0_0_2px_rgba(0,0,0,0.35)] transition-transform ${
                  isLiveProgressFocused ? 'scale-125' : 'scale-100 group-hover/livebar:scale-125'
                }`}
                aria-hidden
              />
            </div>
          </div>
        )}

        <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
            <div className="flex items-center gap-0.5 rounded-lg border border-border/40 bg-background/20 p-0.5 backdrop-blur-sm sm:gap-1 sm:rounded-xl sm:p-1">
              {catchUpProgram ? (
                <>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 hover:bg-secondary/50 sm:h-9 sm:w-9"
                    data-testid="catchup-seek-backward-10"
                    onPointerDown={(event) => handleSeekButtonPointerDown(event, 'backward', 10)}
                    onPointerUp={handleSeekButtonPointerUp}
                    onPointerCancel={handleSeekButtonPointerCancel}
                    onPointerLeave={handleSeekButtonPointerCancel}
                    onContextMenu={preventSeekContextMenu}
                  >
                    <SkipBack className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 hover:bg-secondary/50 sm:h-9 sm:w-9"
                    data-testid="catchup-play-toggle"
                    onClick={togglePlay}
                  >
                    {isPlaying ? <Pause className="h-4 w-4 sm:h-5 sm:w-5" /> : <Play className="h-4 w-4 sm:h-5 sm:w-5" />}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 hover:bg-secondary/50 sm:h-9 sm:w-9"
                    data-testid="catchup-seek-forward-10"
                    onPointerDown={(event) => handleSeekButtonPointerDown(event, 'forward', 10)}
                    onPointerUp={handleSeekButtonPointerUp}
                    onPointerCancel={handleSeekButtonPointerCancel}
                    onPointerLeave={handleSeekButtonPointerCancel}
                    onContextMenu={preventSeekContextMenu}
                  >
                    <SkipForward className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="ml-1 h-8 gap-1 px-2 text-[11px] sm:h-9 sm:px-3 sm:text-xs"
                    data-testid="catchup-go-live"
                    onClick={goToLive}
                  >
                    <Radio className="h-3 w-3" />
                    UŽIVO
                  </Button>
                </>
              ) : (
                <>
                  <Button variant="ghost" size="icon" className="h-8 w-8 hover:bg-secondary/50 sm:h-9 sm:w-9" onClick={onPrevChannel}>
                    <ChevronLeft className="h-4 w-4 sm:h-5 sm:w-5" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8 hover:bg-secondary/50 sm:h-9 sm:w-9" onClick={togglePlay}>
                    {isPlaying ? <Pause className="h-4 w-4 sm:h-5 sm:w-5" /> : <Play className="h-4 w-4 sm:h-5 sm:w-5" />}
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8 hover:bg-secondary/50 sm:h-9 sm:w-9" onClick={onNextChannel}>
                    <ChevronRight className="h-4 w-4 sm:h-5 sm:w-5" />
                  </Button>
                </>
              )}
            </div>
            {currentProgram && !catchUpProgram && (
              <div className="hidden flex-wrap items-center gap-2 sm:flex">
                <span className="text-sm text-muted-foreground">
                  {formatTime(currentProgram.startTime)} - {formatTime(currentProgram.endTime)}
                </span>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-1.5 lg:justify-end">
            <div className="flex items-center gap-0.5 rounded-lg border border-border/40 bg-background/20 p-0.5 backdrop-blur-sm sm:gap-1 sm:rounded-xl sm:p-1">
              <Button variant="ghost" size="icon" className="h-8 w-8 hover:bg-secondary/50 sm:h-9 sm:w-9" onClick={handleMuteAction}>
                {isMuted || volume === 0 ? <VolumeX className="h-3.5 w-3.5 sm:h-4 sm:w-4" /> : <Volume2 className="h-3.5 w-3.5 sm:h-4 sm:w-4" />}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 hover:bg-secondary/50 sm:h-9 sm:w-9"
                aria-label="Prikaži kontrole zvuka"
                aria-expanded={showVolumeSlider}
                onClick={handleToggleVolumeSlider}
              >
                <ChevronDown className={`h-3.5 w-3.5 transition-transform sm:h-4 sm:w-4 ${showVolumeSlider ? 'rotate-180' : ''}`} />
              </Button>
              {showVolumeSlider && (
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={isMuted ? 0 : volume}
                  onChange={handleVolumeChange}
                  className="h-1 w-16 cursor-pointer appearance-none rounded-full bg-secondary/50 accent-primary sm:w-24"
                  aria-label="Volume"
                />
              )}
            </div>

            <div className="flex items-center gap-0.5 rounded-lg border border-border/40 bg-background/20 p-0.5 backdrop-blur-sm sm:gap-1 sm:rounded-xl sm:p-1">
              <Button variant="ghost" size="icon" className="h-8 w-8 hover:bg-secondary/50 sm:h-9 sm:w-9" onClick={onToggleFavorite}>
                <Heart className={`h-3.5 w-3.5 sm:h-4 sm:w-4 ${isFavorite ? 'fill-primary text-primary' : ''}`} />
              </Button>
              {channel.hasCatchUp && (
                <Button
                  variant="ghost"
                  size="icon"
                  className={`h-8 w-8 hover:bg-secondary/50 sm:h-9 sm:w-9 ${catchUpProgram ? 'text-primary' : ''}`}
                  aria-label="Otvori TV unazad"
                  data-testid="catchup-open"
                  onClick={handleCatchUpAction}
                >
                  <Clock className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                </Button>
              )}
              {hasMultipleAudioTracks && (
                <Button
                  variant="ghost"
                  size="icon"
                  className={`h-8 w-8 hover:bg-secondary/50 sm:h-9 sm:w-9 ${showAudioTracks ? 'text-primary' : ''}`}
                  onClick={() => {
                    setShowVolumeSlider(false);
                    setShowSubtitleTracks(false);
                    setShowAudioTracks((prev) => !prev);
                  }}
                >
                  <Languages className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                </Button>
              )}
              {hasSubtitleTracks && (
                <Button
                  variant="ghost"
                  size="icon"
                  className={`h-8 w-8 hover:bg-secondary/50 sm:h-9 sm:w-9 ${showSubtitleTracks ? 'text-primary' : ''}`}
                  title={`Titlovi: ${selectedSubtitleTrackLabel}`}
                  onClick={() => {
                    setShowVolumeSlider(false);
                    setShowAudioTracks(false);
                    setShowSubtitleTracks((prev) => !prev);
                  }}
                >
                  <Captions className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                </Button>
              )}
              {isPictureInPictureSupported && (
                <Button
                  variant="ghost"
                  size="icon"
                  className={`h-8 w-8 hover:bg-secondary/50 sm:h-9 sm:w-9 ${isPictureInPicture ? 'text-primary' : ''}`}
                  title="Slika u slici (P / plavo dugme)"
                  onClick={handleTogglePictureInPicture}
                >
                  <PictureInPicture2 className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                </Button>
              )}
              {castControl?.isAvailable && (
                <Button
                  variant="ghost"
                  size="icon"
                  className={`h-8 w-8 hover:bg-secondary/50 sm:h-9 sm:w-9 ${castControl.isConnected ? 'text-primary' : ''}`}
                  disabled={castControl.isConnecting || Boolean(castControl.disabledReason)}
                  title={castControl.disabledReason ?? (castControl.isConnected ? 'Prekini cast' : 'Poveži cast')}
                  onClick={() => {
                    castControl.onToggle();
                  }}
                >
                  <Cast className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                </Button>
              )}
              <Button variant="ghost" size="icon" className="h-8 w-8 hover:bg-secondary/50 sm:h-9 sm:w-9" onClick={onToggleFullscreen}>
                <Maximize className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              </Button>
            </div>
          </div>
        </div>
      </div>
      </>
    );
  }

  return (
    <div
      className="absolute inset-0 z-10"
      onMouseMove={handleMouseMove}
      onClick={handleClick}
    >
      {audioTrackPanel}
      {subtitleTrackPanel}
      {showCatchUp && (
        <div
          className="absolute right-0 top-0 bottom-0 w-full sm:w-96 z-30 bg-background/95 backdrop-blur-md border-l border-border/50"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex flex-col h-full">
            <div className="flex items-center justify-between p-4 border-b border-border/50">
              <div className="flex items-center gap-2">
                <RotateCcw className="w-5 h-5 text-primary" />
                <h3 className="text-lg font-semibold">Gledanje unazad</h3>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="w-8 h-8"
                aria-label="Zatvori TV unazad"
                onClick={() => setShowCatchUp(false)}
              >
                <X className="w-4 h-4" />
              </Button>
            </div>

            {catchUpProgram && (
              <div className="p-3 border-b border-border/50">
                <Button
                  className="w-full gap-2"
                  variant="default"
                  onClick={goToLive}
                >
                  <Radio className="w-4 h-4" />
                  Vrati se na UŽIVO
                </Button>
              </div>
            )}

            <ScrollArea className="flex-1">
              <div className="p-3 space-y-2">
                {sortedDates.length === 0 ? (
                  <div className="text-center text-muted-foreground py-8">
                    <Clock className="w-12 h-12 mx-auto mb-2 opacity-50" />
                    <p className="font-medium">{catchUpEmptyStateReason.title}</p>
                    <p className="mt-1 text-xs text-muted-foreground/90">
                      {catchUpEmptyStateReason.description}
                    </p>
                  </div>
                ) : (
                  sortedDates.map(dateKey => {
                    const programs = catchUpByDate.get(dateKey) || [];
                    const isOpen = openDays.includes(dateKey);

                    return (
                      <Collapsible
                        key={dateKey}
                        open={isOpen}
                        onOpenChange={() => toggleDay(dateKey)}
                      >
                        <CollapsibleTrigger className="w-full">
                          <div className="flex items-center justify-between p-3 rounded-lg bg-secondary/50 hover:bg-secondary transition-colors">
                            <div className="flex items-center gap-2">
                              <Calendar className="w-4 h-4 text-muted-foreground" />
                              <span className="font-medium text-sm">
                                {formatFullDate(new Date(dateKey))}
                              </span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-muted-foreground">
                                {programs.length} emisija
                              </span>
                              <ChevronDown className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                            </div>
                          </div>
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <div className="mt-1 space-y-1">
                            {programs.map(program => (
                              <button
                                key={program.id}
                                data-testid="catchup-program"
                                onClick={() => handleSelectProgram(program)}
                                className={`w-full text-left p-3 rounded-lg transition-colors ${catchUpProgram?.id === program.id
                                    ? 'bg-primary/20 border border-primary/50'
                                    : 'bg-secondary/30 hover:bg-secondary/60'
                                  }`}
                              >
                                <div className="flex items-start gap-3">
                                  <div className="text-xs text-muted-foreground tabular-nums mt-0.5">
                                    {formatTime(program.startTime)}
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <p className="font-medium text-sm truncate">{program.title}</p>
                                    {program.description && (
                                      <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">
                                        {program.description}
                                      </p>
                                    )}
                                  </div>
                                  <Play className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />
                                </div>
                              </button>
                            ))}
                          </div>
                        </CollapsibleContent>
                      </Collapsible>
                    );
                  })
                )}
              </div>
            </ScrollArea>
          </div>
        </div>
      )}

      <div
        className={`absolute top-0 left-0 right-0 bg-gradient-to-b from-black/90 via-black/50 to-transparent p-4 sm:p-6 transition-all duration-300 z-20 ${showControls && !showCatchUp ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-4 pointer-events-none'
          }`}
      >
        <div className="flex items-center justify-between max-w-screen-2xl mx-auto">
          <div className="flex items-center gap-3 sm:gap-4">
            <div className="w-10 h-10 sm:w-14 sm:h-14 rounded-xl bg-background/20 backdrop-blur-sm flex items-center justify-center">
              <ChannelLogo logo={channel.logo} name={channel.name} size="lg" />
            </div>
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className={`badge-live ${catchUpProgram ? 'bg-orange-500' : ''}`}>
                  {catchUpProgram ? 'UNAZAD' : 'UŽIVO'}
                </span>
              </div>
              <h2 className="text-base sm:text-xl font-semibold text-foreground">{channel.name}</h2>
            </div>
          </div>

          <Button
            variant="ghost"
            size="icon"
            className="w-10 h-10 rounded-full bg-background/20 backdrop-blur-sm hover:bg-background/40"
            onClick={(e) => {
              e.stopPropagation();
              onToggleFullscreen();
            }}
          >
            <X className="w-5 h-5" />
          </Button>
        </div>
      </div>

      <div
        className={`absolute inset-0 flex items-center justify-center gap-4 sm:gap-8 transition-all duration-300 ${showControls && !showCatchUp ? 'opacity-100' : 'opacity-0 pointer-events-none'
          }`}
      >
        {catchUpProgram ? (
          <>
            <Button
              variant="ghost"
              size="icon"
              className="w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-background/20 backdrop-blur-sm hover:bg-background/40 hover:scale-110 transition-transform flex flex-col items-center justify-center gap-0"
              data-testid="catchup-seek-backward-10"
              onPointerDown={(e) => handleSeekButtonPointerDown(e, 'backward', 10)}
              onPointerUp={handleSeekButtonPointerUp}
              onPointerCancel={handleSeekButtonPointerCancel}
              onPointerLeave={handleSeekButtonPointerCancel}
              onContextMenu={preventSeekContextMenu}
            >
              <SkipBack className="w-5 h-5 sm:w-6 sm:h-6" />
              <span className="text-[9px] sm:text-[10px] font-semibold leading-none mt-0.5">10s</span>
            </Button>

            <Button
              variant="ghost"
              size="icon"
              className="w-12 h-12 sm:w-20 sm:h-20 rounded-full bg-primary/90 hover:bg-primary hover:scale-110 transition-transform"
              data-testid="catchup-play-toggle"
              onClick={(e) => {
                e.stopPropagation();
                togglePlay();
              }}
            >
              {isPlaying ? (
                <Pause className="w-8 h-8 sm:w-10 sm:h-10 text-primary-foreground" />
              ) : (
                <Play className="w-8 h-8 sm:w-10 sm:h-10 text-primary-foreground ml-1" />
              )}
            </Button>

            <Button
              variant="ghost"
              size="icon"
              className="w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-background/20 backdrop-blur-sm hover:bg-background/40 hover:scale-110 transition-transform flex flex-col items-center justify-center gap-0"
              data-testid="catchup-seek-forward-10"
              onPointerDown={(e) => handleSeekButtonPointerDown(e, 'forward', 10)}
              onPointerUp={handleSeekButtonPointerUp}
              onPointerCancel={handleSeekButtonPointerCancel}
              onPointerLeave={handleSeekButtonPointerCancel}
              onContextMenu={preventSeekContextMenu}
            >
              <SkipForward className="w-5 h-5 sm:w-6 sm:h-6" />
              <span className="text-[9px] sm:text-[10px] font-semibold leading-none mt-0.5">10s</span>
            </Button>
          </>
        ) : (
          <>
            <Button
              variant="ghost"
              size="icon"
              className="w-12 h-12 sm:w-14 sm:h-14 rounded-full bg-background/20 backdrop-blur-sm hover:bg-background/40 hover:scale-110 transition-transform"
              onClick={(e) => {
                e.stopPropagation();
                onPrevChannel();
              }}
            >
              <ChevronLeft className="w-6 h-6 sm:w-8 sm:h-8" />
            </Button>

            <Button
              variant="ghost"
              size="icon"
              className="w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-primary/90 hover:bg-primary hover:scale-110 transition-transform"
              onClick={(e) => {
                e.stopPropagation();
                togglePlay();
              }}
            >
              {isPlaying ? (
                <Pause className="w-6 h-6 sm:w-10 sm:h-10 text-primary-foreground" />
              ) : (
                <Play className="w-6 h-6 sm:w-10 sm:h-10 text-primary-foreground ml-0.5 sm:ml-1" />
              )}
            </Button>

            <Button
              variant="ghost"
              size="icon"
              className="w-10 h-10 sm:w-14 sm:h-14 rounded-full bg-background/20 backdrop-blur-sm hover:bg-background/40 hover:scale-110 transition-transform"
              onClick={(e) => {
                e.stopPropagation();
                onNextChannel();
              }}
            >
              <ChevronRight className="w-5 h-5 sm:w-8 sm:h-8" />
            </Button>
          </>
        )}
      </div>

      <div
        className={`absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent p-2.5 sm:p-6 transition-all duration-300 z-20 ${showControls && !showCatchUp ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4 pointer-events-none'
          }`}
      >
        <div className="max-w-screen-2xl mx-auto space-y-2 sm:space-y-4">
          {(catchUpProgram || currentProgram) && (
            <div className="flex items-center justify-between">
              <div className="min-w-0 flex-1">
                <h3 className="text-xs sm:text-lg font-semibold text-foreground truncate">
                  {catchUpProgram?.title || currentProgram?.title}
                </h3>
              </div>
              {!catchUpProgram && currentProgram && (
                <div className="ml-2 hidden flex-col items-end gap-0.5 sm:flex">
                  <span className="text-xs sm:text-sm text-muted-foreground flex-shrink-0">
                    {formatTime(currentProgram.startTime)} - {formatTime(currentProgram.endTime)}
                  </span>
                </div>
              )}
            </div>
          )}

          {catchUpProgram ? (
            <div className="space-y-1">
              <div
                data-testid="catchup-timeline"
                className="group relative h-2 sm:h-3 bg-secondary/50 rounded-full overflow-visible cursor-pointer"
                onClick={(e) => {
                  e.stopPropagation();
                  handleSeek(e);
                }}
                onMouseMove={handleProgressHover}
                onMouseLeave={() => setHoverPosition(null)}
                onMouseDown={(e) => {
                  e.stopPropagation();
                  setIsSeeking(true);
                }}
                onMouseUp={() => setIsSeeking(false)}
                onTouchStart={(e) => {
                  e.stopPropagation();
                  setIsSeeking(true);
                }}
                onTouchMove={(e) => {
                  e.stopPropagation();
                  handleSeek(e);
                }}
                onTouchEnd={() => setIsSeeking(false)}
              >
                {hoverPosition !== null && (
                  <div
                    className="absolute top-0 h-full bg-foreground/20 rounded-full pointer-events-none"
                    style={{ width: `${(hoverPosition / catchUpDuration) * 100}%` }}
                  />
                )}

                <div
                  className="h-full bg-primary rounded-full transition-all relative"
                  style={{ width: `${catchUpProgressPercent}%` }}
                >
                  <div className="absolute right-0 top-1/2 -translate-y-1/2 w-4 h-4 sm:w-5 sm:h-5 bg-primary rounded-full shadow-lg transform scale-100 group-hover:scale-110 transition-transform" />
                </div>

                {hoverPosition !== null && (
                  <div
                    className="absolute -top-8 bg-background/90 backdrop-blur-sm px-2 py-1 rounded text-xs font-medium transform -translate-x-1/2 pointer-events-none"
                    style={{ left: `${(hoverPosition / catchUpDuration) * 100}%` }}
                  >
                    {formatDuration(hoverPosition)}
                  </div>
                )}
              </div>

              <div className="flex justify-between text-xs text-muted-foreground tabular-nums">
                <span>{formatDuration(effectiveCatchUpPosition)}</span>
                <span>{formatDuration(catchUpDuration)}</span>
              </div>
            </div>
          ) : (
            <div className="group/livebar relative">
              <div
                className={`rounded-full bg-secondary/50 overflow-visible transition-all ${
                  isLiveProgressFocused ? 'h-2' : 'h-1 group-hover/livebar:h-2'
                } ${
                  canTimeshiftFromLiveBar
                    ? 'cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70 focus-visible:ring-offset-2 focus-visible:ring-offset-black'
                    : ''
                }`}
                onClick={handleLiveProgressClick}
                onKeyDown={handleLiveProgressKeyDown}
                onFocus={() => setIsLiveProgressFocused(true)}
                onBlur={() => setIsLiveProgressFocused(false)}
                role={canTimeshiftFromLiveBar ? 'button' : undefined}
                tabIndex={canTimeshiftFromLiveBar ? 0 : -1}
                aria-label={canTimeshiftFromLiveBar ? 'Pokreni TV unazad sa ove pozicije' : undefined}
              >
                <div
                  className="h-full bg-primary rounded-full transition-all relative"
                  style={{ width: `${progress}%` }}
                >
                  <div
                    className={`absolute right-0 top-1/2 -translate-y-1/2 h-3 w-3 rounded-full border border-primary/40 bg-primary shadow-[0_0_0_2px_rgba(0,0,0,0.35)] transition-transform ${
                      isLiveProgressFocused ? 'scale-125' : 'scale-100 group-hover/livebar:scale-125'
                    }`}
                    aria-hidden
                  />
                </div>
              </div>
            </div>
          )}

          <div className="flex items-center justify-between gap-1.5">
            <div className="flex min-w-0 items-center gap-0.5 sm:gap-2">
              <Button
                variant="ghost"
                size="icon"
                className="w-8 h-8 sm:w-10 sm:h-10 hover:bg-secondary/50"
                data-testid="catchup-play-toggle"
                onClick={(e) => {
                  e.stopPropagation();
                  togglePlay();
                }}
              >
                {isPlaying ? <Pause className="w-3.5 h-3.5 sm:w-5 sm:h-5" /> : <Play className="w-3.5 h-3.5 sm:w-5 sm:h-5" />}
              </Button>

              {catchUpProgram && (
                <>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="w-8 h-8 sm:w-10 sm:h-10 hover:bg-secondary/50 flex flex-col items-center justify-center gap-0"
                    data-testid="catchup-seek-backward-30"
                    onPointerDown={(e) => handleSeekButtonPointerDown(e, 'backward', 30)}
                    onPointerUp={handleSeekButtonPointerUp}
                    onPointerCancel={handleSeekButtonPointerCancel}
                    onPointerLeave={handleSeekButtonPointerCancel}
                    onContextMenu={preventSeekContextMenu}
                  >
                    <SkipBack className="w-3 h-3 sm:w-4 sm:h-4" />
                    <span className="text-[7px] sm:text-[8px] font-semibold leading-none">30s</span>
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="w-8 h-8 sm:w-10 sm:h-10 hover:bg-secondary/50 flex flex-col items-center justify-center gap-0"
                    data-testid="catchup-seek-forward-30"
                    onPointerDown={(e) => handleSeekButtonPointerDown(e, 'forward', 30)}
                    onPointerUp={handleSeekButtonPointerUp}
                    onPointerCancel={handleSeekButtonPointerCancel}
                    onPointerLeave={handleSeekButtonPointerCancel}
                    onContextMenu={preventSeekContextMenu}
                  >
                    <SkipForward className="w-3 h-3 sm:w-4 sm:h-4" />
                    <span className="text-[7px] sm:text-[8px] font-semibold leading-none">30s</span>
                  </Button>
                </>
              )}

              <div className="relative flex items-center gap-0.5 rounded-lg border border-border/40 bg-background/20 p-0.5 backdrop-blur-sm sm:gap-1 sm:rounded-xl sm:p-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="w-8 h-8 sm:w-10 sm:h-10 hover:bg-secondary/50"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleMuteAction();
                  }}
                >
                  {isMuted || volume === 0 ? (
                    <VolumeX className="w-3.5 h-3.5 sm:w-5 sm:h-5" />
                  ) : (
                    <Volume2 className="w-3.5 h-3.5 sm:w-5 sm:h-5" />
                  )}
                </Button>

                <Button
                  variant="ghost"
                  size="icon"
                  className="w-8 h-8 sm:w-10 sm:h-10 hover:bg-secondary/50"
                  aria-label="Prikaži kontrole zvuka"
                  aria-expanded={showVolumeSlider}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleToggleVolumeSlider();
                  }}
                >
                  <ChevronDown className={`w-3.5 h-3.5 sm:w-5 sm:h-5 transition-transform ${showVolumeSlider ? 'rotate-180' : ''}`} />
                </Button>

                {showVolumeSlider && (
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={isMuted ? 0 : volume}
                    onChange={handleVolumeChange}
                    onClick={(e) => e.stopPropagation()}
                    className="h-1 w-16 cursor-pointer appearance-none rounded-full bg-secondary/50 accent-primary sm:w-24"
                    aria-label="Volume"
                  />
                )}
              </div>

              {catchUpProgram && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="hidden sm:flex gap-1 h-8 px-3 hover:bg-secondary/50"
                  data-testid="catchup-go-live"
                  onClick={(e) => {
                    e.stopPropagation();
                    goToLive();
                  }}
                >
                  <Radio className="w-3 h-3" />
                  <span className="text-xs">UŽIVO</span>
                </Button>
              )}

              {currentProgram && !catchUpProgram && (
                <div className="hidden sm:flex items-center gap-2 ml-2">
                  <span className="text-xs sm:text-sm text-muted-foreground">
                    {formatTime(currentProgram.startTime)} - {formatTime(currentProgram.endTime)}
                  </span>
                </div>
              )}
            </div>

              <div className="flex shrink-0 items-center gap-0 sm:gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="w-8 h-8 sm:w-10 sm:h-10 hover:bg-secondary/50"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleFavorite();
                }}
              >
                <Heart className={`w-3.5 h-3.5 sm:w-5 sm:h-5 ${isFavorite ? 'fill-primary text-primary' : ''}`} />
              </Button>
              {channel.hasCatchUp && (
                <Button
                  variant="ghost"
                  size="icon"
                  className={`w-8 h-8 sm:w-10 sm:h-10 hover:bg-secondary/50 ${catchUpProgram ? 'text-primary' : ''}`}
                  aria-label="Otvori TV unazad"
                  data-testid="catchup-open"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleCatchUpAction();
                  }}
                >
                  <Clock className="w-3.5 h-3.5 sm:w-5 sm:h-5" />
                </Button>
              )}
              {hasMultipleAudioTracks && (
                <Button
                  variant="ghost"
                  size="icon"
                  className={`w-8 h-8 sm:w-10 sm:h-10 hover:bg-secondary/50 ${showAudioTracks ? 'text-primary' : ''}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowVolumeSlider(false);
                    setShowSubtitleTracks(false);
                    setShowAudioTracks((prev) => !prev);
                  }}
                >
                  <Languages className="w-3.5 h-3.5 sm:w-5 sm:h-5" />
                </Button>
              )}
              {hasSubtitleTracks && (
                <Button
                  variant="ghost"
                  size="icon"
                  className={`w-8 h-8 sm:w-10 sm:h-10 hover:bg-secondary/50 ${showSubtitleTracks ? 'text-primary' : ''}`}
                  title={`Titlovi: ${selectedSubtitleTrackLabel}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowVolumeSlider(false);
                    setShowAudioTracks(false);
                    setShowSubtitleTracks((prev) => !prev);
                  }}
                >
                  <Captions className="w-3.5 h-3.5 sm:w-5 sm:h-5" />
                </Button>
              )}
              {isPictureInPictureSupported && (
                <Button
                  variant="ghost"
                  size="icon"
                  className={`w-8 h-8 sm:w-10 sm:h-10 hover:bg-secondary/50 ${isPictureInPicture ? 'text-primary' : ''}`}
                  title="Slika u slici (P / plavo dugme)"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleTogglePictureInPicture();
                  }}
                >
                  <PictureInPicture2 className="w-3.5 h-3.5 sm:w-5 sm:h-5" />
                </Button>
              )}
              {castControl?.isAvailable && (
                <Button
                  variant="ghost"
                  size="icon"
                  className={`w-8 h-8 sm:w-10 sm:h-10 hover:bg-secondary/50 ${castControl.isConnected ? 'text-primary' : ''}`}
                  disabled={castControl.isConnecting || Boolean(castControl.disabledReason)}
                  title={castControl.disabledReason ?? (castControl.isConnected ? 'Prekini cast' : 'Poveži cast')}
                  onClick={(e) => {
                    e.stopPropagation();
                    castControl.onToggle();
                  }}
                >
                  <Cast className="w-3.5 h-3.5 sm:w-5 sm:h-5" />
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon"
                className="w-8 h-8 sm:w-10 sm:h-10 hover:bg-secondary/50"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleFullscreen();
                }}
              >
                {isFullscreen ? <Minimize className="w-3.5 h-3.5 sm:w-5 sm:h-5" /> : <Maximize className="w-3.5 h-3.5 sm:w-5 sm:h-5" />}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PlayerControls;
