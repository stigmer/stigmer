"use client";

import { type RefObject, useCallback, useEffect, useRef, useState } from "react";
import type { NarrationManifest } from "./narration";

interface UseNarrationPlaybackOptions {
  /** Narration manifest mapping step indices to audio clips. */
  manifest: NarrationManifest | undefined;
  /** Current active step index in the scenario timeline. */
  stepIndex: number;
  /** Whether the scenario player is currently auto-advancing. */
  playing: boolean;
  /** Initial muted state (default true). Set false for video export. */
  initialMuted?: boolean;
  /**
   * Playback speed multiplier (default 1). Applied to the audio
   * element's native playbackRate so narration stays in sync with
   * the accelerated step timers.
   */
  playbackRate?: number;
  /**
   * Fired when the current narration clip finishes playing (via the
   * HTMLMediaElement `ended` event). ScenarioPlayer uses this to drive
   * step advancement instead of a duration-based timeout.
   */
  onClipEnded?: () => void;
}

interface UseNarrationPlaybackResult {
  /** Whether narration audio is muted (true by default). */
  muted: boolean;
  /** Toggle mute state. When unmuting, plays the current step's audio. */
  toggleMute: () => void;
  /** Ref to attach to a hidden <audio> element rendered by ScenarioPlayer. */
  audioRef: RefObject<HTMLAudioElement | null>;
}

/**
 * Play the audio element, catching rejected promises from browser
 * autoplay policies without disrupting the visual demo.
 */
function safePlay(audio: HTMLAudioElement): void {
  const result = audio.play();
  if (result !== undefined) {
    result.catch(() => {
      // Browser blocked playback (autoplay policy). The visual demo
      // continues unbroken — audio is a progressive enhancement.
    });
  }
}

/**
 * Load and play a narration clip on the given audio element.
 * Sets the source, loads the resource, applies the playback rate,
 * and initiates playback. The rate must be set after load() because
 * load() resets playbackRate to defaultPlaybackRate per the HTML spec.
 */
function playClip(audio: HTMLAudioElement, src: string, rate = 1): void {
  audio.src = src;
  audio.defaultPlaybackRate = rate;
  audio.load();
  audio.playbackRate = rate;
  safePlay(audio);
}

/**
 * Stop any in-progress playback and clear the audio source so the
 * browser can release the network/decode resources.
 */
function stopAudio(audio: HTMLAudioElement): void {
  audio.pause();
  audio.removeAttribute("src");
  audio.load();
}

/**
 * Warm the browser HTTP cache by fetching every narration clip URL in
 * the manifest. Subsequent `audio.load()` calls resolve from disk
 * cache, eliminating network latency at step transitions.
 */
function prefetchManifestClips(manifest: NarrationManifest): void {
  for (const entry of manifest.steps) {
    if (entry?.src) {
      fetch(entry.src).catch(() => {});
    }
  }
}

/**
 * Manages narration audio playback synced to scenario step progression.
 *
 * Encapsulates all audio state so ScenarioPlayer stays focused on step
 * orchestration. The hook manages a single reusable `<audio>` element
 * via ref — the consumer renders `<audio ref={audioRef} />` and this
 * hook drives it.
 *
 * In video-style mode, audio starts unmuted. The poster overlay's play
 * button is the user gesture that satisfies browser autoplay policy.
 * Audio only plays when the `playing` flag is true, so it stays silent
 * during the idle/poster state even when unmuted.
 *
 * When no manifest is provided, the hook is inert — all returned values
 * are stable no-ops so the component tree doesn't re-render.
 */
export function useNarrationPlayback({
  manifest,
  stepIndex,
  playing,
  initialMuted = true,
  playbackRate = 1,
  onClipEnded,
}: UseNarrationPlaybackOptions): UseNarrationPlaybackResult {
  const [muted, setMuted] = useState(initialMuted);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const prefetchedRef = useRef(false);

  // Keep muted/playing state accessible in effects without re-triggering them.
  const mutedRef = useRef(muted);
  mutedRef.current = muted;
  const playingRef = useRef(playing);
  playingRef.current = playing;

  // Stable ref for the callback so the ended listener never goes stale.
  const onClipEndedRef = useRef(onClipEnded);
  onClipEndedRef.current = onClipEnded;

  // Keep playbackRate in a ref so playClip always applies the latest rate.
  const playbackRateRef = useRef(playbackRate);
  playbackRateRef.current = playbackRate;

  // Resolve the narration entry for the current step.
  const entry = manifest?.steps[stepIndex] ?? null;
  const entrySrc = entry?.src ?? null;

  // -----------------------------------------------------------------------
  // Pre-fetch all clips when starting unmuted.
  // Interactive unmute is handled inside toggleMute.
  // -----------------------------------------------------------------------
  useEffect(() => {
    if (!manifest || initialMuted || prefetchedRef.current) return;
    prefetchManifestClips(manifest);
    prefetchedRef.current = true;
  }, [manifest, initialMuted]);

  // -----------------------------------------------------------------------
  // Persistent ended handler — always attached while a manifest exists.
  // Separated from play/stop effects so the handler survives across
  // idle→playing transitions without re-attachment gaps.
  // -----------------------------------------------------------------------
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !manifest) return;

    const handleEnded = () => onClipEndedRef.current?.();
    audio.addEventListener("ended", handleEnded);
    return () => audio.removeEventListener("ended", handleEnded);
  }, [manifest]);

  // -----------------------------------------------------------------------
  // Step change → play the new step's clip (if unmuted, playing, and available)
  // -----------------------------------------------------------------------
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !manifest) return;

    if (mutedRef.current || !entrySrc || !playingRef.current) {
      stopAudio(audio);
      return;
    }

    playClip(audio, entrySrc, playbackRateRef.current);
  }, [stepIndex, entrySrc, manifest]);

  // -----------------------------------------------------------------------
  // Playing state change → pause/resume audio
  // -----------------------------------------------------------------------
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !manifest || mutedRef.current) return;

    if (!playing) {
      audio.pause();
    } else if (entrySrc) {
      // If the audio element still has a loaded source (paused mid-clip),
      // resume from the current position. If stopAudio cleared it (e.g.
      // transitioning out of idle), load the clip from scratch.
      if (audio.src) {
        safePlay(audio);
      } else {
        playClip(audio, entrySrc, playbackRateRef.current);
      }
    }
  }, [playing, entrySrc, manifest]);

  // -----------------------------------------------------------------------
  // Mute toggle
  // -----------------------------------------------------------------------
  const toggleMute = useCallback(() => {
    setMuted((prev) => {
      const next = !prev;
      const audio = audioRef.current;
      if (!audio) return next;

      if (next) {
        stopAudio(audio);
      } else {
        if (manifest && !prefetchedRef.current) {
          prefetchManifestClips(manifest);
          prefetchedRef.current = true;
        }
        if (entrySrc) {
          playClip(audio, entrySrc, playbackRateRef.current);
        }
      }

      return next;
    });
  }, [entrySrc, manifest]);

  // -----------------------------------------------------------------------
  // Sync audio playbackRate with the speed multiplier.
  //
  // `defaultPlaybackRate` controls the rate that `load()` resets to
  // (per the HTML spec, load() sets playbackRate = defaultPlaybackRate).
  // Without this, every `playClip` call resets the rate to 1x because
  // it calls audio.load() which clobbers playbackRate.
  // -----------------------------------------------------------------------
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.defaultPlaybackRate = playbackRate;
    audio.playbackRate = playbackRate;
  }, [playbackRate]);

  // -----------------------------------------------------------------------
  // Cleanup on unmount
  // -----------------------------------------------------------------------
  useEffect(() => {
    const audio = audioRef.current;
    return () => {
      if (audio) stopAudio(audio);
    };
  }, []);

  return { muted, toggleMute, audioRef };
}
