/**
 * The Cursor harness's capability flags — the facts about `@cursor/sdk` the
 * turn runtime branches on, declared once (`harness/capabilities.ts` has the
 * matrix and the meaning of each flag).
 *
 *  - `deny-and-retry`: an out-of-process hook denies a gated tool, the
 *    denial lands in the session ledger, the run is cancelled, and the next
 *    invocation re-runs with grants (`hook-script.ts`, `approval-state.ts`).
 *  - `engine-minted`: the agent id exists only once `Agent.create` returns;
 *    the adapter binds it through `TurnSink.bindHarnessState` before its
 *    first persist.
 *  - No system prompt: instructions ride the first user message
 *    (`prompt-builder.ts`).
 *  - Sub-agents through the SDK's `agents` option (`subagent-config.ts`).
 *  - Tool lists in two places: the SDK's `tools` / `disallowedTools` hide
 *    the main loop's excluded built-ins (`session-lifecycle.ts`), and the
 *    hook's scope arm refuses every out-of-scope call, sub-agents' and MCP
 *    tools' included (`hook-scope.ts`). The SDK options cannot narrow MCP
 *    below all-or-nothing nor reach a sub-agent, which is why the hook binds.
 *  - An agent's hooks, in either format, run inside the runner: the gate's
 *    script asks the turn's hook server for every call (`hook-server.ts`),
 *    and only the agent's own hooks run (`workspace-hook-files.ts`).
 *  - PNG and JPEG inline; the transport re-sniffs (`shared/attachment-vision.ts`).
 *  - File review under the `cursor` harness id, with the files the gate
 *    writes into the repo excluded from the mid-run progress diff
 *    ({@link CURSOR_RUNNER_OWNED_PATHS}). The capture itself is the runtime's
 *    (`harness/capture.ts`, since #1096); this adapter contributes only the hook
 *    sidecar it binds as the runtime's CAS observations (`turn-setup.ts`).
 *  - Its turn boundary rewrites rows the stream already settled (the denial
 *    overlay, the twin and one-gate collapses, the refusal stamps), so the
 *    session's events hold every row it may still rewrite until the turn's
 *    terminal write (`boundary-rows.ts` `boundaryMayStillRewrite`).
 *  - Sub-agents report at completion: the SDK returns a sub-agent's
 *    transcript only in its `task` call's completion and sends nothing while
 *    it runs (`sub-agent-steps.ts`, an upstream limit), so the open `task`
 *    call is the runtime's one sign the work is live.
 */

import { Harness } from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";

import type { FileReviewIdentity, HarnessCapabilities } from "../../harness/capabilities.js";
import { CURSOR_VISION_PROFILE } from "../../shared/attachment-vision.js";
import { boundaryMayStillRewrite } from "./boundary-rows.js";

/**
 * Workspace-relative paths the Cursor gate writes into the repo for the
 * turn's duration (`workspace-setup.ts`). Excluded from the runtime's capture
 * so a turn's diff never shows the gate's own machinery: at the boundary the
 * gate is already torn down (the adapter's `finally` restores both), so the
 * exclusion is load-bearing for the MID-RUN progress slice, which reads the
 * tree while the gate is installed. The workspace-scoped gate dir and the
 * SDK state live under `~/.stigmer` / the git-excluded `.stigmer`, so they
 * need no exclusion.
 */
const CURSOR_RUNNER_OWNED_PATHS: readonly string[] = [".cursor/hooks.json", ".cursor/rules/stigmer-tool-approval.mdc"];

/**
 * The `.claude` settings files whose `hooks` the gate sets aside for the turn
 * in a folder the runner owns (`workspace-hook-files.ts`), and restores
 * before the runtime's final capture: left out of the mid-run progress diff
 * only, so an agent's own edit to one is still reviewed at the turn's end.
 */
const CURSOR_TRANSIENT_PATHS: readonly string[] = [".claude/settings.json", ".claude/settings.local.json"];

/** The two facts the runtime's capture and reconcile read from this harness (`harness/capabilities.ts` `FileReviewIdentity`). */
export const CURSOR_FILE_REVIEW_IDENTITY: FileReviewIdentity = {
  harnessId: "cursor",
  excludePaths: CURSOR_RUNNER_OWNED_PATHS,
  transientPaths: CURSOR_TRANSIENT_PATHS,
};

export const CURSOR_CAPABILITIES: HarnessCapabilities = {
  harness: Harness.CURSOR,
  pausePrimitive: "deny-and-retry",
  stateIdSource: "engine-minted",
  subAgents: true,
  runsHooks: true,
  readsToolMarks: false,
  visionProfile: CURSOR_VISION_PROFILE,
  fileReview: CURSOR_FILE_REVIEW_IDENTITY,
  boundaryRewritesRow: boundaryMayStillRewrite,
  subAgentProgress: "at-completion",
  // A resumed agent holds its conversation, but a run its server ended has
  // no step to resume: the continuation is a prompt with the turn's digest.
  continuation: "digest",
  // A message is steered into the running run, or sent once it ends when
  // Cursor answers that it cannot take it now (turn-input.ts).
  midTurnInput: "next-step",
  // Cursor's server summarizes the conversation and bills it; the stream
  // says so with `summary-completed` (translator.ts).
  contextCompaction: "vendor-server",
};
