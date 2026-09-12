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
 *  - File review under the `cursor` harness id, with the transient
 *    `.cursor/hooks.json` the gate writes excluded from every diff
 *    (`capture-flow.ts`).
 */

import type { HarnessCapabilities } from "../../harness/capabilities.js";
import { CURSOR_VISION_PROFILE } from "../../shared/attachment-vision.js";
import { CURSOR_FILE_REVIEW_IDENTITY } from "./capture-flow.js";

export const CURSOR_CAPABILITIES: HarnessCapabilities = {
  pausePrimitive: "deny-and-retry",
  stateIdSource: "engine-minted",
  systemPrompt: false,
  subAgents: true,
  toolRestriction: false,
  visionProfile: CURSOR_VISION_PROFILE,
  fileReview: CURSOR_FILE_REVIEW_IDENTITY,
};
