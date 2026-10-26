/**
 * The Claude harness's settle: from an invocation's end to a `TurnOutcome`.
 *
 * In order: the gate's unattended skips folded onto their rows (the shared
 * fold, `shared/unattended-skips.ts`, the one row this settle AMENDS by
 * identity; its evidence, the gate's registry, exists only in the harness);
 * on a stop, every sub-agent still running marked cancelled through the
 * shared act and `interrupted`; the engine's structured output folded onto
 * the rows; then the outcome the engine's result names: `awaiting_approval`
 * when the engine stopped at a call the gate deferred, whose WAITING row the
 * turn already proposed (`turn.ts`).
 *
 * Failures, by who can fix them: the engine's own failed result is the
 * `engine` surface, its words the result's; a conversation the store lost
 * part of is `internal`, naming the lost history, because the next turn
 * would resume from a transcript with a hole; an engine that ended with no
 * result is `internal`, and so is one that could not resume an answered
 * call because its tool was gone (`tool_deferred_unavailable`). A refused turn (a feature this harness does not run
 * yet) never reaches here: `turn.ts` refuses it before the engine starts.
 *
 * What this never does: write a phase, a terminal copy or `completedAt`
 * (the runtime's), settle a SKIP or REJECT row (the runtime's), capture file
 * changes (the runtime's), or create a row (the builder's).
 */

import type { JsonObject } from "@bufbuild/protobuf";
import type { SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";

import type { TurnOutcome, TurnSink } from "../../harness/types.js";
import { cancelInProgressSubAgentProtos } from "../../shared/subagent-rows.js";
import { reconcileUnattendedSkips } from "../../shared/unattended-skips.js";

/** How an invocation's engine run ended, as the turn loop observed it. */
export interface InvocationEnd {
  /** The runtime stopped the turn, or it yielded at its boundary. */
  readonly stopped: boolean;
  /** The engine's last result; undefined when none arrived. */
  readonly result: SDKResultMessage | undefined;
  /** The store's report of a batch it could not keep; undefined when none was lost. */
  readonly mirrorError: string | undefined;
  /** The gate's unattended skips. */
  readonly unattendedSkips: ReadonlyMap<string, string | null>;
  /** Whether the turn asked for structured output. */
  readonly structuredOutput: boolean;
  /** Whether the engine stopped at a deferred call and the turn proposed its row. */
  readonly awaitingApproval: boolean;
}

/** What a result says when the engine could not resume an answered call. */
export const DEFERRED_UNAVAILABLE_MESSAGE = "The call waiting for approval could not resume: its tool is no longer available in this conversation.";

/** The outcome of an invocation (the header). */
export function settleClaudeTurn(sink: TurnSink, end: InvocationEnd): TurnOutcome {
  const { rows } = sink;
  reconcileUnattendedSkips(rows, end.unattendedSkips);

  if (end.mirrorError !== undefined) {
    return {
      kind: "failed",
      surface: "internal",
      message: `Claude's conversation could not be saved (${end.mirrorError}), so the next turn would resume without part of it.`,
    };
  }
  if (end.stopped) {
    cancelInProgressSubAgentProtos(rows.subAgentRuns);
    return { kind: "interrupted" };
  }
  const result = end.result;
  if (result === undefined) return { kind: "failed", surface: "internal", message: "The Claude engine ended without a result." };
  if (result.subtype !== "success") {
    const detail = result.errors.length > 0 ? result.errors.join("; ") : result.subtype;
    return { kind: "failed", surface: "engine", message: `Claude failed: ${detail}` };
  }
  if (result.terminal_reason === "tool_deferred_unavailable") return { kind: "failed", surface: "internal", message: DEFERRED_UNAVAILABLE_MESSAGE };
  if (result.is_error) return { kind: "failed", surface: "engine", message: result.result || "Claude failed." };
  if (end.awaitingApproval) return { kind: "awaiting_approval" };
  if (end.structuredOutput) foldStructuredOutput(sink, result);
  return { kind: "completed" };
}

/** The engine's structured output onto the rows, when it is an object. */
function foldStructuredOutput(sink: TurnSink, result: SDKResultMessage): void {
  const output = (result as { structured_output?: unknown }).structured_output;
  if (output !== null && typeof output === "object" && !Array.isArray(output)) {
    sink.rows.structuredOutput = output as JsonObject;
  } else if (output !== undefined) {
    console.warn(`[claude-settle] the engine's structured output is not an object: type=${typeof output}`);
  }
}
