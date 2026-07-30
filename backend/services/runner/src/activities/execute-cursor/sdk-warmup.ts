/**
 * Cursor SDK state-store warm-up for pool members.
 *
 * The first `Agent.create` in a pod pays the SDK's platform construction:
 * four SQLite-backed stores (run/checkpoint/event stores + notifier) whose
 * first use loads the sqlite native binding and compiles the schema
 * migrations. The 2026-07-30 instrumented baseline (issue #209) measured
 * this at ~1.2s of the ~2.4s `resolve_agent` segment, with a 624ms floor —
 * roughly half the cost is per-process warm-up, not per-session work.
 *
 * Pool members idle between boot and claim, so constructing one throwaway
 * platform there moves that per-process cost off the user-visible path.
 * This respects the pool's pre-warm boundary (warm-agent-surfaces DD-C:
 * image caches only, nothing per-agent): the throwaway store is
 * org-agnostic, credential-free, and keyed to a synthetic workspace ref.
 *
 * Deliberately NOT run on session-mode boots: those pods receive their
 * execution the moment the worker polls, so a concurrent warm-up would
 * compete with the real `Agent.create` for the same CPU instead of running
 * in idle time.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface SdkWarmupResult {
  readonly warmed: boolean;
  readonly durationMs: number;
  readonly error?: string;
}

/**
 * Construct (and abandon) one SDK agent platform on a throwaway temp-dir
 * state root, forcing the sqlite native binding + store schema work to
 * happen now instead of inside the first user-facing `Agent.create`.
 *
 * Total by construction — warm-up is an optimization and must never affect
 * the member's ability to serve. The throwaway state root is a few KB on
 * the pod's ephemeral disk and is intentionally NOT deleted: the SDK memoizes
 * the platform (with open SQLite handles) for the process lifetime, and
 * unlinking files under live handles buys nothing on a pod that vanishes
 * with its disk anyway.
 *
 * The `@cursor/sdk` import is dynamic so this module never adds the SDK
 * bundle to any boot path that doesn't already carry it — by the time the
 * warm-up runs (after the worker starts polling), the activities have
 * already loaded the SDK and the import resolves from the module cache.
 */
export async function warmCursorSdkStateStores(): Promise<SdkWarmupResult> {
  const startMs = performance.now();
  try {
    const stateRoot = mkdtempSync(join(tmpdir(), "cursor-sdk-warm-"));
    const { createAgentPlatform } = await import("@cursor/sdk");
    await createAgentPlatform({ workspaceRef: "stigmer-warm:boot", stateRoot });
    return { warmed: true, durationMs: elapsed(startMs) };
  } catch (err) {
    return {
      warmed: false,
      durationMs: elapsed(startMs),
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function elapsed(startMs: number): number {
  return Math.round((performance.now() - startMs) * 10) / 10;
}
