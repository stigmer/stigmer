/**
 * The Claude harness's capability flags — the facts about Anthropic's Claude
 * Agent SDK engine the turn runtime branches on, declared once
 * (`harness/capabilities.ts` has the matrix and the meaning of each flag).
 *
 *  - `interrupt`: the engine stops at a gated call itself (`defer` from a
 *    `PreToolUse` callback) and, resumed, runs exactly that call. Until the
 *    pause lands, a call that would wait for a person is refused instead
 *    (`gate.ts`): no turn of this harness ends `awaiting_approval` yet.
 *  - `deterministic`: the engine's session id is derived from the thread id
 *    the runtime mints (`engine-session-id.ts`), so nothing is bound.
 *  - Sub-agents as `agents` definitions; a turn whose agent has them is
 *    refused until the harness passes them (`turn.ts`).
 *  - No hooks: the agent's hooks run through the gate once it pauses, so an
 *    agent with hooks is refused up front by the runtime, never run without
 *    them (`harness/turn-context.ts`).
 *  - The host bridge lists every server's tools itself and reads each
 *    tool's destructive mark there (`mcp-bridge.ts`), as the native engine
 *    does.
 *  - The native engine's vision profile: the same Anthropic Messages API
 *    reads the same images.
 *  - File review under the `claude` harness id with nothing excluded: the
 *    engine's configuration and transcripts live in the session's directory,
 *    outside the workspace (`engine-env.ts`).
 *  - Sub-agents stream: their text and calls reach the parent's stream as
 *    they happen (`forwardSubagentText`).
 *  - A continued turn resumes from the engine's own transcript, which holds
 *    every step (`session-store.ts`).
 *  - A message sent while the turn works reaches the engine before its next
 *    model call: it is pushed into the open prompt stream (`turn.ts`).
 *  - The engine compacts its own context and says where (`compact_boundary`).
 */

import { Harness } from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";

import type { HarnessCapabilities } from "../../harness/capabilities.js";
import { DEEP_AGENT_VISION_PROFILE } from "../../shared/attachment-vision.js";

/** The harness id stamped on the Claude harness's file-review ledger events. */
export const CLAUDE_HARNESS_ID = "claude";

export const CLAUDE_CAPABILITIES: HarnessCapabilities = {
  harness: Harness.CLAUDE,
  pausePrimitive: "interrupt",
  stateIdSource: "deterministic",
  subAgents: true,
  runsHooks: false,
  readsToolMarks: true,
  visionProfile: DEEP_AGENT_VISION_PROFILE,
  fileReview: { harnessId: CLAUDE_HARNESS_ID, excludePaths: [] },
  subAgentProgress: "streamed",
  continuation: "checkpoint",
  midTurnInput: "next-step",
  contextCompaction: "engine-cli",
};
