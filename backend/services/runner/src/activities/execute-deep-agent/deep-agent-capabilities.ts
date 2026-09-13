/**
 * The native deep-agent harness's capability flags — the facts about the
 * LangGraph engine the turn runtime branches on, declared once
 * (`harness/capabilities.ts` has the matrix and the meaning of each flag).
 *
 *  - `interrupt`: the approval gate (`middleware/approval-gate.ts`) calls
 *    LangGraph's `interrupt()` at a gated tool; the graph checkpoints and
 *    stops, and the adapter resumes it with a `Command(resume)` carrying
 *    the decisions (`hitl.ts`). No engine re-run, no exact-apply.
 *  - `deterministic`: the thread id is the runtime's, minted from the
 *    session before the first turn (`ensure-thread.ts`), so the adapter
 *    never binds a state id and the runtime's reinvocation fact is the
 *    persisted transcript.
 *  - A system prompt: instructions, skills, input files and standing context
 *    ride `createDeepAgent`'s `systemPrompt` (`prompt-builder.ts`).
 *  - Sub-agents as compiled sub-graphs (`subagent-transformer.ts`), each
 *    with its own mounted skills from the runtime (`TurnSkills.bySubAgent`).
 *  - Tool restriction by tool list: an MCP server's `enabled_tools` is
 *    honoured at connect time, so the engine never sees a disabled tool.
 *  - PNG, JPEG, WebP and GIF inline (`shared/attachment-vision.ts`).
 *  - File review under the `deep-agent` harness id with nothing excluded:
 *    this harness writes no transient file into the repo (the `.stigmer`
 *    link is the runtime's, created before its baseline pin and git-excluded
 *    at provision). The capture is the runtime's (`harness/capture.ts`, S3
 *    M4); this harness binds its `CasCaptureObserver`'s snapshot as the
 *    runtime's CAS observations (`turn.ts`).
 */

import type { HarnessCapabilities } from "../../harness/capabilities.js";
import { DEEP_AGENT_VISION_PROFILE } from "../../shared/attachment-vision.js";

/** The harness id stamped on the deep-agent's file-review ledger events. */
export const DEEP_AGENT_HARNESS_ID = "deep-agent";

export const DEEP_AGENT_CAPABILITIES: HarnessCapabilities = {
  pausePrimitive: "interrupt",
  stateIdSource: "deterministic",
  systemPrompt: true,
  subAgents: true,
  toolRestriction: true,
  visionProfile: DEEP_AGENT_VISION_PROFILE,
  fileReview: { harnessId: DEEP_AGENT_HARNESS_ID, excludePaths: [] },
};
