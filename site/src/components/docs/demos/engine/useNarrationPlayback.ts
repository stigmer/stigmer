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
 * Sets the source, loads the resource, and initiates playback.
 */
function playClip(audio: HTMLAudioElement, src: string): void {
  audio.src = src;
  audio.load();
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
 * Manages narration audio playback synced to scenario step progression.
 *
 * Encapsulates all audio state so ScenarioPlayer stays focused on step
 * orchestration. The hook manages a single reusable `<audio>` element
 * via ref — the consumer renders `<audio ref={audioRef} />` and this
 * hook drives it.
 *
 * Defaults to muted. The unmute toggle click (a user gesture) is the
 * first moment `audio.play()` is called, satisfying browser autoplay
 * policies. Subsequent programmatic `play()` calls work because the
 * element was activated by a prior user gesture.
 *
 * When no manifest is provided, the hook is inert — all returned values
 * are stable no-ops so the component tree doesn't re-render.
 */
export function useNarrationPlayback({
  manifest,
  stepIndex,
  playing,
}: UseNarrationPlaybackOptions): UseNarrationPlaybackResult {
  const [muted, setMuted] = useState(true);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Keep muted state accessible in effects without re-triggering them.
  const mutedRef = useRef(muted);
  mutedRef.current = muted;

  // Resolve the narration entry for the current step.
  const entry = manifest?.steps[stepIndex] ?? null;
  const entrySrc = entry?.src ?? null;

  // -----------------------------------------------------------------------
  // Step change → play the new step's clip (if unmuted and available)
  // -----------------------------------------------------------------------
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !manifest) return;

    if (mutedRef.current || !entrySrc) {
      stopAudio(audio);
      return;
    }

    playClip(audio, entrySrc);
  }, [stepIndex, entrySrc, manifest]);

  // -----------------------------------------------------------------------
  // Playing state change → pause/resume audio
  // -----------------------------------------------------------------------
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !manifest || mutedRef.current) return;

    if (!playing) {
      audio.pause();
    } else if (entrySrc && audio.src && audio.paused) {
      safePlay(audio);
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
        // Muting → stop playback
        stopAudio(audio);
      } else if (entrySrc) {
        // Unmuting → play current step's clip (user gesture context)
        playClip(audio, entrySrc);
      }

      return next;
    });
  }, [entrySrc]);

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
