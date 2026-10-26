/**
 * The Claude harness's capability flags — the facts about Anthropic's Claude
 * Agent SDK engine the turn runtime branches on, declared once
 * (`harness/capabilities.ts` has the matrix and the meaning of each flag).
 *
 *  - `interrupt`: the engine stops at a gated call itself (`defer` from a
 *    `PreToolUse` callback, one call a turn) and, resumed, runs exactly
 *    that call, answered by its id and checked against the call the person
 *    saw (`gate.ts`, `turn.ts`). A sub-agent's call that would wait is
 *    refused: the engine loses a sub-agent's deferred call.
 *  - `deterministic`: the engine's session id is derived from the thread id
 *    the runtime mints (`engine-session-id.ts`), so nothing is bound.
 *  - Sub-agents as `agents` definitions, each run to its end before the
 *    main agent goes on, with its own tools, skills, servers and shell
 *    values (`agents.ts`); the agent's skills load through the engine's own
 *    Skill tool, from plugins the harness writes (`skill-plugins.ts`).
 *  - Hooks: the agent's `PreToolUse` and `PostToolUse` hooks, in both
 *    formats, run in the gate in the native engine's order, a sub-agent's
 *    own after the conversation's (`hooks.ts`, `hook-views.ts`).
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
 *  - A call's row reaches the session's log once it settles, or at the
 *    turn's terminal write (`boundaryRewritesRow`): the engine streams a
 *    call before the gate decides it, and a call the gate pauses must reach
 *    the log as an ask, its `stigmer.permission.asked` beside it, which a
 *    resumed turn is seeded from (`harness/transcript/resume-seed.ts`). A
 *    helper's start (`Agent`) is written as it streams, so the helper's own
 *    thread reaches the log as it works; its call never pauses (`gate.ts`).
 *  - A message sent while the turn works reaches the engine before its next
 *    model call: it is pushed into the open prompt stream (`mid-turn-input.ts`).
 *  - The engine compacts its own context and says where (`compact_boundary`).
 */

import { Harness } from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";

import type { HarnessCapabilities } from "../../harness/capabilities.js";
import { ToolCallStatus } from "../../gen/turn/ai/stigmer/runner/turn/v1/enum_pb.js";
import type { ToolCall } from "../../gen/turn/ai/stigmer/runner/turn/v1/rows_pb.js";
import { DEEP_AGENT_VISION_PROFILE } from "../../shared/attachment-vision.js";

/** The harness id stamped on the Claude harness's file-review ledger events. */
export const CLAUDE_HARNESS_ID = "claude";

/** The engine's tool that starts a helper, whose row is never held back (the header). */
const HELPER_START = "Agent";

/** Whether a call's row is held from the session's log: unsettled, and not a helper's start (the header). */
export function claudeRowAwaitsGate(row: ToolCall): boolean {
  const unsettled = row.status === ToolCallStatus.TOOL_CALL_PENDING || row.status === ToolCallStatus.TOOL_CALL_RUNNING;
  return unsettled && row.name !== HELPER_START;
}

export const CLAUDE_CAPABILITIES: HarnessCapabilities = {
  harness: Harness.CLAUDE,
  pausePrimitive: "interrupt",
  stateIdSource: "deterministic",
  subAgents: true,
  runsHooks: true,
  readsToolMarks: true,
  visionProfile: DEEP_AGENT_VISION_PROFILE,
  fileReview: { harnessId: CLAUDE_HARNESS_ID, excludePaths: [] },
  boundaryRewritesRow: claudeRowAwaitsGate,
  subAgentProgress: "streamed",
  continuation: "checkpoint",
  midTurnInput: "next-step",
  contextCompaction: "engine-cli",
};
