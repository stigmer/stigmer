"use client";

import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Pause, Play, Volume2, VolumeX } from "lucide-react";
import type { NarrationManifest } from "./narration";
import { useNarrationPlayback } from "./useNarrationPlayback";
import { useTimeSource } from "./TimeSource";
import { useVideoExport } from "./VideoExportContext";
import { computeStepTimeline } from "./timeline";

/**
 * A single step in a scenario timeline.
 *
 * @typeParam T - The data shape passed to the render function at this step.
 */
export interface ScenarioStep<T> {
  /** Milliseconds to wait before revealing this step. */
  delayMs: number;
  /** Data snapshot at this point in the timeline. */
  data: T;
  /** Short label shown below the demo content describing the current action. */
  caption?: string;
  /**
   * Narration script for TTS generation. Consumed by the build script
   * to produce audio files — not rendered at runtime.
   */
  narration?: string;
}

interface ScenarioPlayerProps<T> {
  /** Ordered steps in the playback timeline. */
  steps: ScenarioStep<T>[];
  /** Render function — receives current step data and step index. */
  children: (data: T, stepIndex: number) => ReactNode;
  /** @deprecated Kept for API compatibility. Auto-play on scroll has been removed. */
  autoPlay?: boolean;
  /** Additional CSS class names for the outer container. */
  className?: string;
  /** Fires when the active step changes (after the step is rendered). */
  onStepChange?: (data: T, index: number) => void;
  /**
   * Audio manifest produced by the narration build script. When
   * provided, enables audio playback and shows a mute/unmute toggle.
   */
  narrationManifest?: NarrationManifest;
  /**
   * Show a speed selector (1x / 1.5x / 2x) in the control bar.
   * Defaults to true — set to false to suppress on a specific demo.
   */
  showSpeedControl?: boolean;
}

type PlaybackState = "idle" | "playing" | "paused";

/**
 * Find the active step for a given playback time by scanning the
 * pre-computed step start times in reverse.
 */
function deriveStepFromTime(
  currentTimeMs: number,
  stepStartTimesMs: readonly number[],
  maxIndex: number,
): number {
  for (let i = stepStartTimesMs.length - 1; i >= 0; i--) {
    if (currentTimeMs >= stepStartTimesMs[i]) return Math.min(i, maxIndex);
  }
  return 0;
}

/** Delay before auto-hiding the control bar during playback. */
const CONTROLS_HIDE_DELAY_MS = 3_000;

/**
 * Video-style playback engine for timed scenario animations.
 *
 * Renders a poster overlay with a centered play button on initial load.
 * The user must click to start playback — no auto-play on scroll.
 * When playing, a YouTube-style progress bar glides smoothly at 60fps
 * with subtle chapter markers at step boundaries and a circular
 * playhead. Transport controls (play/pause, volume) auto-hide after
 * 3 seconds and reappear on mouse movement.
 *
 * Audio plays unmuted by default when the user clicks play — the
 * click gesture satisfies browser autoplay policy.
 *
 * Clicking the content area toggles play/pause (standard video behavior).
 *
 * Renders content via a children render prop — the engine knows nothing
 * about what is being displayed.
 *
 * Respects `prefers-reduced-motion` by skipping directly to the final step.
 */
const SPEED_OPTIONS = [0.5, 1, 1.5, 2] as const;
type SpeedOption = (typeof SPEED_OPTIONS)[number];

export function ScenarioPlayer<T>({
  steps,
  children,
  className,
  onStepChange,
  narrationManifest,
  showSpeedControl = true,
}: ScenarioPlayerProps<T>) {
  const prefersReducedMotion = useReducedMotion();
  const { isVideoExport, hideControls, initialMuted: videoExportMuted } = useVideoExport();
  const timeSource = useTimeSource();
  const lastIndex = steps.length - 1;

  const [timerStepIndex, setStepIndex] = useState(() =>
    prefersReducedMotion ? lastIndex : 0,
  );
  const [playbackState, setPlaybackState] = useState<PlaybackState>(
    isVideoExport ? "playing" : "idle",
  );
  const [playbackRate, setPlaybackRate] = useState(1);
  const playing = playbackState === "playing";
  const containerRef = useRef<HTMLDivElement>(null);

  const stepIndex = timeSource
    ? deriveStepFromTime(timeSource.currentTimeMs, timeSource.stepStartTimesMs, lastIndex)
    : timerStepIndex;

  const stepIndexRef = useRef(stepIndex);
  stepIndexRef.current = stepIndex;

  const playbackStateRef = useRef(playbackState);
  playbackStateRef.current = playbackState;

  const pendingAdvanceRef = useRef<(() => void) | null>(null);

  const handleClipEnded = useCallback(() => {
    pendingAdvanceRef.current?.();
  }, []);

  const effectiveInitialMuted = isVideoExport ? videoExportMuted : false;

  const { muted, toggleMute, audioRef } = useNarrationPlayback({
    manifest: timeSource ? undefined : narrationManifest,
    stepIndex,
    playing,
    initialMuted: effectiveInitialMuted,
    playbackRate,
    onClipEnded: handleClipEnded,
  });

  // Timeline for progress bar — recomputes when mute state changes
  // so the bar matches actual step durations.
  const stepTimeline = useMemo(
    () => computeStepTimeline(steps, muted ? null : narrationManifest),
    [steps, muted, narrationManifest],
  );

  // Keep timeline in a ref so the RAF tick always reads the latest.
  const stepTimelineRef = useRef(stepTimeline);
  stepTimelineRef.current = stepTimeline;

  // -----------------------------------------------------------------------
  // Step advancement — timer delays are divided by playbackRate so
  // steps advance proportionally faster. Audio playbackRate is handled
  // by useNarrationPlayback, so clip "ended" events also fire sooner.
  //
  // Rate is read from a ref (not the dependency array) so that changing
  // speed mid-step does NOT restart timers. The audio rate changes
  // immediately via useNarrationPlayback, and the next step's timer
  // will pick up the new rate when it schedules.
  // -----------------------------------------------------------------------
  const rateRef = useRef(Math.max(playbackRate, 0.25));
  rateRef.current = Math.max(playbackRate, 0.25);

  useEffect(() => {
    if (timeSource || !playing || prefersReducedMotion) return;

    const r = rateRef.current;

    if (stepIndex >= lastIndex) {
      const finalNarrationMs =
        !muted && narrationManifest
          ? (narrationManifest.steps[stepIndex]?.durationMs ?? 0)
          : 0;

      if (finalNarrationMs > 0) {
        pendingAdvanceRef.current = () => setPlaybackState("paused");
        const safety = setTimeout(() => {
          pendingAdvanceRef.current = null;
          setPlaybackState("paused");
        }, (finalNarrationMs + 2000) / r);
        return () => {
          clearTimeout(safety);
          pendingAdvanceRef.current = null;
        };
      }

      setPlaybackState("paused");
      return;
    }

    const nextIndex = stepIndex + 1;
    const baseDelay = steps[nextIndex].delayMs / r;
    const narrationDuration =
      !muted && narrationManifest
        ? (narrationManifest.steps[stepIndex]?.durationMs ?? 0)
        : 0;

    if (narrationDuration > 0) {
      let clipDone = false;
      let baseDelayDone = false;
      let fired = false;

      const advance = () => {
        if (fired) return;
        fired = true;
        pendingAdvanceRef.current = null;
        setStepIndex(nextIndex);
      };

      const tryAdvance = () => {
        if (clipDone && baseDelayDone) advance();
      };

      pendingAdvanceRef.current = () => {
        clipDone = true;
        tryAdvance();
      };

      const baseTimer = setTimeout(() => {
        baseDelayDone = true;
        tryAdvance();
      }, baseDelay);

      const safetyTimer = setTimeout(
        advance,
        (Math.max(steps[nextIndex].delayMs, narrationDuration) + 2000) / r,
      );

      return () => {
        clearTimeout(baseTimer);
        clearTimeout(safetyTimer);
        pendingAdvanceRef.current = null;
      };
    }

    const timer = setTimeout(() => setStepIndex(nextIndex), baseDelay);
    return () => clearTimeout(timer);
  }, [timeSource, playing, stepIndex, steps, lastIndex, prefersReducedMotion, muted, narrationManifest]);

  useEffect(() => {
    onStepChange?.(steps[stepIndex].data, stepIndex);
  }, [stepIndex, steps, onStepChange]);

  // -----------------------------------------------------------------------
  // Controls auto-hide
  // -----------------------------------------------------------------------
  const [controlsVisible, setControlsVisible] = useState(true);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const scheduleHide = useCallback(() => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(
      () => setControlsVisible(false),
      CONTROLS_HIDE_DELAY_MS,
    );
  }, []);

  const revealControls = useCallback(() => {
    setControlsVisible(true);
    if (playbackState === "playing") scheduleHide();
  }, [playbackState, scheduleHide]);

  useEffect(() => {
    if (playbackState !== "playing") {
      setControlsVisible(true);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    } else {
      scheduleHide();
    }
    return () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, [playbackState, scheduleHide]);

  // -----------------------------------------------------------------------
  // Navigation callbacks
  // -----------------------------------------------------------------------
  const goTo = useCallback(
    (index: number) => {
      setPlaybackState("paused");
      setStepIndex(Math.max(0, Math.min(index, lastIndex)));
    },
    [lastIndex],
  );

  const handlePlay = useCallback(() => {
    if (stepIndex >= lastIndex) setStepIndex(0);
    setPlaybackState("playing");
  }, [stepIndex, lastIndex]);

  const handlePause = useCallback(() => {
    setPlaybackState("paused");
  }, []);

  const togglePlay = useCallback(() => {
    if (playing) handlePause();
    else handlePlay();
  }, [playing, handlePlay, handlePause]);

  const handleContentClick = useCallback(() => {
    if (playbackState === "idle") return;
    togglePlay();
  }, [playbackState, togglePlay]);

  const [speedMenuOpen, setSpeedMenuOpen] = useState(false);
  const speedMenuRef = useRef<HTMLDivElement>(null);

  const selectSpeed = useCallback((speed: SpeedOption) => {
    setPlaybackRate(speed);
    setSpeedMenuOpen(false);
  }, []);

  // Close speed menu on outside click
  useEffect(() => {
    if (!speedMenuOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (speedMenuRef.current && !speedMenuRef.current.contains(e.target as Node)) {
        setSpeedMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [speedMenuOpen]);

  // -----------------------------------------------------------------------
  // Smooth progress bar (RAF-driven, 60fps direct DOM updates)
  // -----------------------------------------------------------------------
  const progressTrackRef = useRef<HTMLDivElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef(0);
  const stepElapsedRef = useRef(0);
  const lastTickRef = useRef(0);

  const setProgressDOM = useCallback((fraction: number) => {
    const pct = `${Math.max(0, Math.min(fraction, 1)) * 100}%`;
    if (progressTrackRef.current) progressTrackRef.current.style.width = pct;
    if (playheadRef.current) playheadRef.current.style.left = pct;
  }, []);

  // The tick function is stored in a ref so the recursive RAF chain
  // always invokes the latest closure (captures fresh refs).
  const tickFnRef = useRef<() => void>(undefined);
  tickFnRef.current = () => {
    const now = performance.now();
    stepElapsedRef.current += (now - lastTickRef.current) * rateRef.current;
    lastTickRef.current = now;

    const tl = stepTimelineRef.current;
    const idx = stepIndexRef.current;
    const stepStart = tl.stepStartTimesMs[idx];
    const stepEnd = idx < lastIndex
      ? tl.stepStartTimesMs[idx + 1]
      : tl.totalDurationMs;
    const stepDuration = Math.max(stepEnd - stepStart, 1);
    const inStepFrac = Math.min(stepElapsedRef.current / stepDuration, 1);
    const progress = (stepStart + inStepFrac * (stepEnd - stepStart)) / tl.totalDurationMs;

    setProgressDOM(progress);
    rafRef.current = requestAnimationFrame(() => tickFnRef.current?.());
  };

  // Start / stop the animation loop with playback state.
  useEffect(() => {
    if (playing) {
      lastTickRef.current = performance.now();
      rafRef.current = requestAnimationFrame(() => tickFnRef.current?.());
    } else {
      cancelAnimationFrame(rafRef.current);
    }
    return () => cancelAnimationFrame(rafRef.current);
  }, [playing]);

  // Reset the within-step timer when the step changes.
  useEffect(() => {
    stepElapsedRef.current = 0;
    lastTickRef.current = performance.now();
  }, [stepIndex]);

  // Update the progress bar for static states (idle, paused after seek).
  useEffect(() => {
    if (playbackState === "idle") {
      setProgressDOM(0);
      return;
    }
    if (playbackState === "paused") {
      const tl = stepTimelineRef.current;
      const idx = stepIndexRef.current;
      const stepStart = tl.stepStartTimesMs[idx];
      const stepEnd = idx < lastIndex
        ? tl.stepStartTimesMs[idx + 1]
        : tl.totalDurationMs;
      const stepDuration = Math.max(stepEnd - stepStart, 1);
      const inStepFrac = Math.min(stepElapsedRef.current / stepDuration, 1);
      const progress = (stepStart + inStepFrac * (stepEnd - stepStart)) / tl.totalDurationMs;
      setProgressDOM(progress);
    }
  }, [playbackState, stepIndex, lastIndex, setProgressDOM]);

  // -----------------------------------------------------------------------
  // Progress bar click-to-seek
  // -----------------------------------------------------------------------
  const handleProgressClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      e.stopPropagation();
      const rect = e.currentTarget.getBoundingClientRect();
      const fraction = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const clickTimeMs = fraction * stepTimelineRef.current.totalDurationMs;
      let target = 0;
      for (let i = stepTimelineRef.current.stepStartTimesMs.length - 1; i >= 0; i--) {
        if (clickTimeMs >= stepTimelineRef.current.stepStartTimesMs[i]) {
          target = i;
          break;
        }
      }
      goTo(target);
    },
    [goTo],
  );

  // Chapter markers (step boundaries) for the progress bar.
  const stepTicks = useMemo(
    () =>
      stepTimeline.stepStartTimesMs
        .slice(1)
        .map((ms) => (ms / stepTimeline.totalDurationMs) * 100),
    [stepTimeline],
  );

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------
  const caption = steps[stepIndex].caption;
  const showPoster = playbackState === "idle" && !isVideoExport && !prefersReducedMotion;
  const showControlBar = playbackState !== "idle" && !hideControls;

  return (
    <div
      ref={containerRef}
      className={className}
      onMouseMove={showControlBar ? revealControls : undefined}
    >
      {/* Content area — click toggles play/pause after poster is dismissed */}
      <div
        className="relative"
        onClick={handleContentClick}
        style={{ cursor: playbackState !== "idle" ? "pointer" : undefined }}
      >
        {children(steps[stepIndex].data, stepIndex)}

        {/* Poster overlay */}
        <AnimatePresence>
          {showPoster && (
            <motion.div
              className="absolute inset-0 z-10 flex cursor-pointer items-center justify-center rounded-lg bg-black/40 backdrop-blur-[2px]"
              initial={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
              onClick={(e) => {
                e.stopPropagation();
                handlePlay();
              }}
              role="button"
              aria-label="Play demo"
            >
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-white/90 shadow-lg transition-transform hover:scale-110">
                <Play size={28} className="ml-1 text-neutral-900" />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {narrationManifest && (
        <audio ref={audioRef} preload="none" hidden />
      )}

      {/* Caption */}
      <div className="mt-2 flex h-6 items-center justify-center">
        <AnimatePresence mode="wait">
          {caption && (
            <motion.p
              key={caption}
              className="text-sm font-medium text-foreground/70"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.2 }}
            >
              {caption}
            </motion.p>
          )}
        </AnimatePresence>
      </div>

      {/* Video-style control bar */}
      {showControlBar && (
        <AnimatePresence>
          {controlsVisible && (
            <motion.div
              className="mt-1 px-1"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              {/* Progress bar — YouTube-style with smooth playhead */}
              <div
                className="group relative mb-2 h-1 w-full cursor-pointer rounded-full bg-foreground/10 transition-[height] duration-150 hover:h-1.5"
                onClick={handleProgressClick}
                role="progressbar"
                aria-label="Playback progress"
                aria-valuenow={Math.round(
                  ((stepIndex < lastIndex
                    ? stepTimeline.stepStartTimesMs[stepIndex + 1]
                    : stepTimeline.totalDurationMs) /
                    stepTimeline.totalDurationMs) * 100,
                )}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                {/* Filled track — width driven by RAF at 60fps */}
                <div
                  ref={progressTrackRef}
                  className="absolute inset-y-0 left-0 rounded-full bg-foreground/50"
                />
                {/* Playhead circle — appears on hover, position driven by RAF */}
                <div
                  ref={playheadRef}
                  className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground/70 opacity-0 shadow-sm transition-opacity group-hover:opacity-100"
                />
                {/* Chapter markers at step boundaries */}
                {stepTicks.map((pct, i) => (
                  <div
                    key={i}
                    className="absolute top-0 h-full w-0.5 rounded-full bg-background"
                    style={{ left: `${pct}%` }}
                  />
                ))}
              </div>

              {/* Transport controls */}
              <div className="flex items-center gap-1.5">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    togglePlay();
                  }}
                  className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground"
                  aria-label={playing ? "Pause" : "Play"}
                >
                  {playing ? <Pause size={14} /> : <Play size={14} />}
                </button>

                {narrationManifest && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleMute();
                    }}
                    className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground"
                    aria-label={muted ? "Unmute narration" : "Mute narration"}
                  >
                    {muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
                  </button>
                )}

                {showSpeedControl && (
                  <div ref={speedMenuRef} className="relative">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setSpeedMenuOpen((prev) => !prev);
                      }}
                      className="flex h-6 min-w-[2rem] items-center justify-center rounded px-1 text-[11px] font-medium tabular-nums text-muted-foreground transition-colors hover:text-foreground"
                      aria-label={`Playback speed: ${playbackRate}x`}
                      aria-haspopup="true"
                      aria-expanded={speedMenuOpen}
                    >
                      {playbackRate}x
                    </button>

                    <AnimatePresence>
                      {speedMenuOpen && (
                        <motion.div
                          className="absolute bottom-full right-0 mb-1.5 rounded-md border border-border bg-card py-1 shadow-lg"
                          initial={{ opacity: 0, y: 4 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: 4 }}
                          transition={{ duration: 0.12, ease: "easeOut" }}
                          role="menu"
                          aria-label="Playback speed"
                        >
                          {SPEED_OPTIONS.map((speed) => (
                            <button
                              key={speed}
                              role="menuitem"
                              onClick={(e) => {
                                e.stopPropagation();
                                selectSpeed(speed);
                              }}
                              className={`flex w-full items-center justify-between gap-3 px-3 py-1 text-[11px] tabular-nums transition-colors hover:bg-accent ${
                                speed === playbackRate
                                  ? "font-semibold text-foreground"
                                  : "text-muted-foreground"
                              }`}
                            >
                              <span>{speed}x</span>
                              {speed === playbackRate && (
                                <span className="text-[10px] text-primary">●</span>
                              )}
                            </button>
                          ))}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      )}
    </div>
  );
}
