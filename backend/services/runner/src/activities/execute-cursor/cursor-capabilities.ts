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
 *  - No tool restriction in the SDK config: the hook's "disabled" arm
 *    enforces `enabledTools` at call time (issue #350).
 *  - PNG and JPEG inline; the transport re-sniffs (`shared/attachment-vision.ts`).
 *  - File review under the `cursor` harness id, with the two files the gate
 *    writes into the repo excluded from the mid-run progress diff
 *    ({@link CURSOR_RUNNER_OWNED_PATHS}). The capture itself is the runtime's
 *    (`harness/capture.ts`, since #1096); this adapter contributes only the hook
 *    sidecar it binds as the runtime's CAS observations (`turn-setup.ts`).
 */

import type { FileReviewIdentity, HarnessCapabilities } from "../../harness/capabilities.js";
import { CURSOR_VISION_PROFILE } from "../../shared/attachment-vision.js";

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

/** The two facts the runtime's capture and reconcile read from this harness (`harness/capabilities.ts` `FileReviewIdentity`). */
export const CURSOR_FILE_REVIEW_IDENTITY: FileReviewIdentity = {
  harnessId: "cursor",
  excludePaths: CURSOR_RUNNER_OWNED_PATHS,
};

export const CURSOR_CAPABILITIES: HarnessCapabilities = {
  pausePrimitive: "deny-and-retry",
  stateIdSource: "engine-minted",
  systemPrompt: false,
  subAgents: true,
  toolRestriction: false,
  visionProfile: CURSOR_VISION_PROFILE,
  fileReview: CURSOR_FILE_REVIEW_IDENTITY,
};
