/**
 * The AI judge's one reader of a run's transcript: the parts the judge is
 * shown (`SubjectParts`, @stigmer/eval-runtime), read from the graded run
 * and the turns before it in its session. The library's `renderSubject`
 * turns the parts into the document the judge grades, with its bounds, cut
 * markers and escaping; this module only reads storage. Beside `actionsOf`
 * (../checks/actions.ts), which reduces the same calls to hashes for the
 * free checks, this is the second function that is rewritten when the
 * transcript moves off the run's status onto a session event log; the
 * rubrics, the renderer, the verdict reader and the benchmark's example
 * conversations do not change.
 *
 * From the graded run: the request (`spec.message`); each top-level tool
 * call in order, its arguments as canonical JSON (already redacted of
 * secret-named values by the runner, message.proto), its status, error and
 * result, a result the runner spilled to storage marked cut since the run
 * keeps only its preview; and the final answer, the structured output
 * when the run delivered one, else the last assistant message. From each
 * earlier run of the session: its request and final answer only.
 *
 * `earlierRunsOf` reads those earlier runs with one indexed read: the run
 * list index's `session` key, strictly after the graded run's own position
 * in the index's newest-first order, at most EARLIER_TURNS_MAX rows. The
 * position is derived the way the index derives a row's (listIndexFactsOf),
 * so the cursor and the stored row agree byte for byte. The earlier turns
 * are the same conversation the graded run's viewers already see.
 *
 * Proven by __tests__/judge.test.ts.
 */
import { fromBinary } from "@bufbuild/protobuf";
import type { JsonValue } from "@bufbuild/protobuf";

import { EARLIER_TURNS_MAX } from "@stigmer/eval-runtime/judge";
import type { SubjectCall, SubjectCallStatus, SubjectParts } from "@stigmer/eval-runtime/judge";
import { RunSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import type { Run } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import {
  MessageType,
  ToolCallStatus,
} from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";

import { canonicalJson } from "../../../pipeline/steps/spec-hash.js";
import type { Store } from "../../../store/interface.js";
import { listIndexInstant } from "../../../store/list-index.js";
import { agentExecutionListIndex } from "../../run/list-index.js";
import { sessionIdOf } from "../../run/target.js";

/** The judge's view of `run`, after the `earlier` runs of its session, oldest first. */
export function subjectPartsOf(
  run: Run,
  earlier: ReadonlyArray<Run>,
): SubjectParts {
  return {
    earlierTurns: earlier.map((turn) => ({
      request: turn.spec?.message ?? "",
      answer: finalAnswerOf(turn),
    })),
    request: run.spec?.message ?? "",
    toolCalls: toolCallsOf(run),
    answer: finalAnswerOf(run),
  };
}

/**
 * The runs before `run` in its session, oldest first, at most
 * EARLIER_TURNS_MAX (the module header). A run with no session has none.
 */
export async function earlierRunsOf(store: Store, run: Run): Promise<Run[]> {
  const sessionId = sessionIdOf(run.spec);
  if (sessionId === "") {
    return [];
  }
  const rows = await store.queryResources(agentExecutionListIndex, {
    org: run.metadata?.org ?? "",
    anyKey: [{ name: "session", value: sessionId }],
    after: {
      createdAt: listIndexInstant(run.status?.audit?.specAudit?.createdAt),
      id: run.metadata?.id ?? "",
    },
    limit: EARLIER_TURNS_MAX,
  });
  return rows.map((row) => fromBinary(RunSchema, row.data)).reverse();
}

function toolCallsOf(run: Run): SubjectCall[] {
  const calls: SubjectCall[] = [];
  for (const message of run.status?.messages ?? []) {
    for (const call of message.toolCalls) {
      calls.push({
        name: call.name,
        args: call.args === undefined ? "" : canonicalJson(call.args),
        status: statusName(call.status),
        error: call.error,
        result: call.result,
        resultCut:
          call.outputRef !== undefined && call.outputRef.contentHash !== "",
      });
    }
  }
  return calls;
}

/** The run's answer: its structured output when delivered, else its last assistant message. */
function finalAnswerOf(run: Run): string {
  const structured = run.status?.structuredOutput;
  if (structured !== undefined) {
    return JSON.stringify(structured satisfies JsonValue);
  }
  const messages = run.status?.messages ?? [];
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message?.type === MessageType.MESSAGE_AI && message.content !== "") {
      return message.content;
    }
  }
  return "";
}

/**
 * Each tool-call status as the judge reads it. A table over every value, so
 * a status added to the contract does not compile until it is named here.
 */
const STATUS_NAMES: Readonly<Record<ToolCallStatus, SubjectCallStatus>> = {
  [ToolCallStatus.TOOL_CALL_STATUS_UNSPECIFIED]: "unknown",
  [ToolCallStatus.TOOL_CALL_PENDING]: "pending",
  [ToolCallStatus.TOOL_CALL_RUNNING]: "running",
  [ToolCallStatus.TOOL_CALL_COMPLETED]: "completed",
  [ToolCallStatus.TOOL_CALL_FAILED]: "failed",
  [ToolCallStatus.TOOL_CALL_WAITING_APPROVAL]: "waiting for approval",
  [ToolCallStatus.TOOL_CALL_SKIPPED]: "skipped",
  [ToolCallStatus.TOOL_CALL_INTERRUPTED]: "interrupted",
};

function statusName(status: ToolCallStatus): SubjectCallStatus {
  return STATUS_NAMES[status] ?? "unknown";
}
