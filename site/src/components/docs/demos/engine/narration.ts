/**
 * Runtime narration audio data produced by the TTS build script.
 *
 * ScenarioPlayer consumes a {@link NarrationManifest} to play audio
 * clips synced to step progression. Step authors write narration text
 * on {@link ScenarioStep} — the build script reads that text, generates
 * audio files, and writes a manifest that maps step indices to audio
 * URLs and durations.
 */

/** A single audio clip for one scenario step. */
export interface NarrationEntry {
  /** URL of the audio file (e.g. "/demos/approval-flow/step-0.mp3"). */
  src: string;
  /** Duration of the audio clip in milliseconds. */
  durationMs: number;
}

/**
 * Per-scenario manifest mapping step indices to narration audio.
 *
 * Array position corresponds to the step index. Steps without
 * narration use `null`.
 */
export interface NarrationManifest {
  steps: (NarrationEntry | null)[];
}
