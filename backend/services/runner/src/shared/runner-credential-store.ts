/**
 * Custody point for the runner's own secrets — the VALUES companion to
 * runner-credential-keys.ts's names (issue #508).
 *
 * Why this exists: the Cursor SDK's local agent runtime ships inside
 * `@cursor/sdk` and runs IN-PROCESS in the runner. Its shell tool spawns
 * bash with `{...process.env, ...}` and its git layer does the same, so
 * anything living in the runner's `process.env` is readable by every shell
 * command the agent runs — and the SDK exposes no env option for local
 * agents to scrub at the spawn boundary. Denylists on runner-owned spawn
 * sites (shell-env.ts) cannot reach those vendor spawns. The only fix that
 * covers every spawn surface, present and future, is for secrets not to
 * LIVE in `process.env` at all: this module captures them at boot and is
 * the sole holder afterwards.
 *
 * Custody rules:
 *
 *  1. `captureRunnerSecrets()` runs at every boot door (both public runner
 *     factories, plus main() for symmetry) — it MOVES every
 *     {@link RUNNER_SECRET_ENV_KEYS} value out of `process.env` into a
 *     module-private map. Idempotent; first call wins.
 *  2. Reads go through {@link getRunnerSecret}: captured value first, live
 *     `process.env` as fallback. The fallback keeps the store honest rather
 *     than frozen — production sets these vars only at process start (the
 *     capture window), so the fallback is a dead path there, but tests and
 *     unusual embedders that plant a value later see it behave exactly like
 *     the env read it replaced.
 *  3. Rotation writes go through {@link setRunnerSecret} (the
 *     runner-manager/static-renewal token channel that previously wrote
 *     `process.env.STIGMER_TOKEN` in lockstep with its tokenRef).
 *  4. {@link runnerSecretsEnvView} adapts the store to the codebase's
 *     `env: NodeJS.ProcessEnv` injection seams (llm-backend,
 *     registry-endpoint). The view re-merges secrets over `process.env` —
 *     it exists for in-process CONFIG READS ONLY and must never be handed
 *     to a child process env or any spawn options.
 *
 * Embedder note: `@stigmer/runner` is a public library, and capture runs
 * inside the factories, so embedding the runner scrubs the HOST process's
 * env of runner secrets at boot. That is the point — agent shells run in
 * the embedder's process — and host code that still needs a value reads it
 * through this module.
 */

import { RUNNER_SECRET_ENV_KEYS } from "./runner-credential-keys.js";

const captured = new Map<string, string>();
let captureRan = false;

/**
 * Move every {@link RUNNER_SECRET_ENV_KEYS} value out of `process.env` into
 * the store. Idempotent — only the first call captures, so a late caller
 * cannot re-freeze values that rotation has since replaced.
 */
export function captureRunnerSecrets(): void {
  if (captureRan) return;
  captureRan = true;
  for (const name of RUNNER_SECRET_ENV_KEYS) {
    const value = process.env[name];
    if (value !== undefined) {
      captured.set(name, value);
      delete process.env[name];
    }
  }
}

/**
 * Read a runner secret: captured value first, live `process.env` fallback
 * (see custody rule 2). Returns `undefined` when the secret is absent —
 * callers own their missing-secret reaction, exactly as with the env reads
 * this replaces.
 */
export function getRunnerSecret(name: string): string | undefined {
  return captured.get(name) ?? process.env[name];
}

/**
 * Write (or with `null`, clear) a runner secret — the rotation channel.
 * Ensures capture has run first so a rotated value can never sit in
 * `process.env` because a writer beat the boot capture.
 */
export function setRunnerSecret(name: string, value: string | null): void {
  captureRunnerSecrets();
  if (value === null) {
    captured.delete(name);
  } else {
    captured.set(name, value);
  }
}

/**
 * `process.env` with the captured secrets merged back over it — an adapter
 * for the `env: NodeJS.ProcessEnv` injection seams so their defaults stay
 * secret-aware after the boot scrub.
 *
 * IN-PROCESS CONFIG READS ONLY: never pass this to a spawn/exec env, a
 * worker thread, or anything else that leaves the process — doing so would
 * reopen exactly the leak the store closes.
 */
export function runnerSecretsEnvView(): NodeJS.ProcessEnv {
  const view: NodeJS.ProcessEnv = { ...process.env };
  for (const [name, value] of captured) {
    view[name] = value;
  }
  return view;
}

/**
 * Test-only: forget everything captured and re-arm capture. Unit tests that
 * plant secret env vars and boot pieces of the runner need each test to see
 * its own values.
 */
export function resetRunnerSecretsForTests(): void {
  captured.clear();
  captureRan = false;
}
