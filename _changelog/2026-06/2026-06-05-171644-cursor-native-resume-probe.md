# Cursor native local-resume probe: validating durable conversation context across runner restarts

**Date**: June 5, 2026

## Summary

Validated, with a real integration test, that the Cursor SDK's **native local `Agent.resume()`
restores full conversation context across a runner (pod) restart** — provided the SDK's SQLite
state is present. This is the foundational finding for eventually retiring the hand-rolled
`SessionMemory` continuation "hack" in favor of native resume. Adds a default-off
`CURSOR_TRUST_NATIVE_RESUME` runner flag (the switch the future migration flips) and a gated
integration test that proves the behavior and its dependency on the local SQLite store.

## Problem Statement

Stigmer's Cursor harness runs **local** Cursor agents (cloud is disabled platform-wide). On every
subsequent turn, the runner does not trust `Agent.resume()` to restore context — it rebuilds a
continuation prompt from a bespoke `SessionMemory` proto (durable summary, recent turns, changed
files, tool observations, decisions) and re-injects it. The code says so plainly:

> Local mode: always use continuation prompt on subsequent executions because local SDK context
> loading is unreliable.

With the Kubernetes sandbox migration (persistent PVCs + CSI VolumeSnapshots), the question became:
can we drop the hack and let native resume carry context across pod restarts and snapshot restore?

### Pain Points

- `SessionMemory` is a non-native, hand-maintained approximation of conversation state — extra code,
  token budget juggling, and drift risk versus the SDK's own record of the conversation.
- It was never clear *why* local resume was "unreliable" — a stale conclusion from the old Daytona
  `process.cwd` keying bug, or a real SDK limitation? That ambiguity blocked any cleanup.

## Solution

Probe the SDK empirically before committing to a design. Two pieces:

1. A **default-off** `CURSOR_TRUST_NATIVE_RESUME` flag. When on, a successfully-resumed *local* agent
   receives the raw user message (the cloud path) instead of the `SessionMemory` continuation —
   letting a test observe pure native resume, and doubling as the eventual migration switch.
2. A **gated integration test** that runs a real turn, restarts the runner process (SDK SQLite
   intact), runs a follow-up, and asserts both that resume happened (`resumed_successfully`) and that
   the agent recalled a turn-1 nonce — plus a negative control proving the dependency on local SQLite.

## Implementation Details

**Flag (default off; all existing behavior unchanged when unset):**
- `config.ts`: `trustNativeResume` from `CURSOR_TRUST_NATIVE_RESUME`, threaded through the embedded
  runner option types and call sites (`runner.ts`, `runner-manager.ts`, `main.ts`).
- `activities/execute-cursor/index.ts`: `buildPrompt` returns the raw user message when
  `trustNativeResume` and `resolution.reason === "resumed_successfully"`. A fresh agent created after
  a resume failure still uses the continuation prompt (no native context to trust).

**Integration test + harness plumbing:**
- `test/integration/cursor_native_resume_restart_test.go`:
  `TestCursorNativeResume_SurvivesRestart` (positive) and `TestCursorNativeResume_FailsWithoutState`
  (negative control). Gated on `CURSOR_API_KEY`, matching the other provider tests.
- `test/integration/harness/unified_runner.go`: `UnifiedRunnerConfig.TrustNativeResume`
  (sets the env), plus `UnifiedRunnerStatic.Cfg()`/`TaskQueue()` so a test can take over the shared
  queue with a flagged runner and restore the suite's runner on cleanup.

**Tests:** runner Vitest for the flag + `buildPrompt` branch (21 pass); production `tsc` clean.

## Results

Both probes pass (user-level Cursor key; the team `cursor/prod.api-key` is rejected by Cursor's SDK):

- **`SurvivesRestart` (PASS):** turn 1 set nonce `ZEPHYR-…`; SDK SQLite confirmed at
  `~/.stigmer/cursor-sdk-state/{sessionId}`; runner restarted; turn 2 resolved `resumed_successfully`
  and replied the exact nonce — **native resume restored context with the hack disabled.**
- **`FailsWithoutState` (PASS):** deleting the SQLite store made resume fail
  (`created_after_resume_failure`, "Agent … not found") — confirming recall depends on the local
  store (rules out Cursor server-side state as the source).

**Key architecture finding:** the SDK persists local state under `$HOME` (pod-ephemeral `/root`),
while only the PVC at `/workspace` is persistent and snapshotted — so the durability gap is *where*
the SQLite lives, not the engine. SQLite is the right tool for this embedded single-writer workload.

## Benefits

- Turns a long-standing "unreliable, so we hacked around it" assumption into a measured fact, with a
  repeatable test guarding it.
- Unblocks a concrete cleanup path: relocate `stateRoot` onto the persistent volume → native resume
  survives restart and snapshot restore → demote `SessionMemory` to a fallback.
- The flag and test are inert by default — zero production behavior change in this changeset.

## Impact

- Runner (`@stigmer/runner`) gains an opt-in flag; default-off keeps the Cursor harness unchanged.
- Informs the kubernetes-sandbox-provisioner effort (stigmer-cloud) — see its
  `tasks/T09_0_cursor-native-resume-probe.md` for the GO decision and caveats (validate longer idle
  gaps where the server-side agent may expire; validate the real K8s restart/rollout/restore flows).

## Related Work

- kubernetes-sandbox-provisioner project (stigmer-cloud) — persistent PVCs + CSI snapshots that make
  native-resume durability worth pursuing.
- The original `SessionMemory` continuation mechanism this probe aims to eventually retire.

---

**Status**: 🧪 Experimental (probe + default-off flag; relocation/migration intentionally deferred)
**Timeline**: Single session (2026-06-05)
