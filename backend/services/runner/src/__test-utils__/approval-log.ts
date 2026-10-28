/**
 * What the server writes when a person answers a call that asked, as both
 * test kits model it (the harness-contract `ExecutionDriver.decide` and the
 * hermetic `ExecutionRecord.decideWaitingToolCalls`): the answer's session
 * events, as the server's answer core commits them.
 *
 *  - a `user.tool_confirmation` naming the call's tool use id
 *    (`harness/events/ids.ts` `toolUseEventId`): `allow` for APPROVE and
 *    APPROVE_ALL, `deny` for REJECT and SKIP (a person's skip and reject
 *    are one deny; a reason, when given, is its `deny_message`);
 *  - for APPROVE_ALL, a `stigmer.permission.grant` on that call after it,
 *    naming the lease the server derives from the call.
 *
 * The kits write nothing on the row: the runtime reads the answers from the
 * log and its seed copies each onto its row's `approval_action` (APPROVE_ALL,
 * APPROVE, or REJECT for any deny, a SKIP included).
 *
 * The ids follow the server's rule for an answer (`sevt_` and a hash of the
 * tool use id), so a resent answer names the same event.
 *
 * The runtime reads the answers back through its one door
 * (`harness/approval-answers.ts`), so a kit's answer reaches a turn only
 * through the log, as a person's does. Beside them, the ask the runner's
 * emitter writes for a row ({@link askedEventFor}), and the unit tests'
 * shorthand for a transcript a person answered ({@link loggedApprovalsFor}).
 */
import { createHash } from "node:crypto";

import { create } from "@bufbuild/protobuf";
import { SessionEventSchema, type SessionEvent } from "@stigmer/apis/ai/stigmer/agentic/session/v1/event_pb";

import { approvalAnswersOf, type ApprovalAsk } from "../harness/approval-answers.js";
import { POLICY_SOURCE_WORDS } from "../harness/events/emitter.js";
import { permissionAskedEventId, toolUseEventId } from "../harness/events/ids.js";
import { deriveLeaseScope } from "../shared/approval-policy.js";
import type { AgentMessage, ToolCall } from "../gen/turn/ai/stigmer/runner/turn/v1/rows_pb.js";
import { ApprovalAction, ToolCallStatus } from "../gen/turn/ai/stigmer/runner/turn/v1/enum_pb.js";

function hashed(prefix: string, toolUseId: string): string {
  return `${prefix}${createHash("sha256").update(toolUseId).digest("hex").slice(0, 40)}`;
}

/**
 * The events the server appends when a person answers `row` of run `runId`
 * with `action` (and, for a deny, `denyMessage`), in order.
 */
export function answerEventsFor(
  args: { readonly sessionId: string; readonly runId: string },
  row: ToolCall,
  action: ApprovalAction,
  denyMessage = "",
): SessionEvent[] {
  const toolUseId = toolUseEventId(args.runId, row.id);
  const allow = action === ApprovalAction.APPROVE || action === ApprovalAction.APPROVE_ALL;
  const events: SessionEvent[] = [
    create(SessionEventSchema, {
      sessionId: args.sessionId,
      runId: args.runId,
      event: {
        case: "userToolConfirmation",
        value: {
          id: hashed("sevt_tc_", toolUseId),
          result: allow ? "allow" : "deny",
          toolUseId,
          denyMessage: allow ? "" : denyMessage,
        },
      },
    }),
  ];
  const lease = action === ApprovalAction.APPROVE_ALL ? deriveLeaseScope(row) : undefined;
  if (lease !== undefined) {
    events.push(
      create(SessionEventSchema, {
        sessionId: args.sessionId,
        runId: args.runId,
        event: {
          case: "stigmerPermissionGrant",
          value: {
            id: hashed("sevt_pg_", toolUseId),
            toolUseId,
            scope: "turn",
            lease:
              lease.kind === "hook"
                ? { category: "", server: lease.server, hook: lease.hook, tool: lease.tool }
                : lease.kind === "server"
                  ? { category: "", server: lease.server, tool: "" }
                  : { category: lease.category, server: "", tool: "" },
          },
        },
      }),
    );
  }
  return events;
}

/**
 * The `stigmer.permission.asked` the runner's emitter writes for a row that
 * asks (`harness/events/emitter.ts` `writeToolUse`): its policy source word
 * and its hook, as the row carried them at the ask.
 */
export function askedEventFor(args: { readonly sessionId: string; readonly runId: string }, row: ToolCall): SessionEvent {
  const toolUseId = toolUseEventId(args.runId, row.id);
  return create(SessionEventSchema, {
    sessionId: args.sessionId,
    runId: args.runId,
    event: {
      case: "stigmerPermissionAsked",
      value: {
        id: permissionAskedEventId(toolUseId),
        toolUseId,
        message: row.approvalMessage,
        argsPreview: row.argsPreview,
        policySource: POLICY_SOURCE_WORDS[row.approvalPolicySource],
        policyHook: row.approvalPolicyHook,
      },
    },
  });
}

/**
 * What the runtime's door reads for `messages` when every root WAITING row
 * whose `approvalAction` is set was asked as the emitter writes it and
 * answered with that action: the unit tests' shorthand for "a person
 * answered these rows", stated once. The rows' `approvalAction` stands for
 * the answer here only; the reader under test never sees it.
 */
export function loggedApprovalsFor(
  runId: string,
  messages: readonly AgentMessage[],
): { readonly runId: string; readonly decisions: ReadonlyMap<string, ApprovalAction>; readonly asks: ReadonlyMap<string, ApprovalAsk>; readonly denyMessages: ReadonlyMap<string, string> } {
  const ids = { sessionId: "ses_logged", runId };
  const log: SessionEvent[] = [];
  for (const message of messages) {
    for (const row of message.toolCalls) {
      if (row.status !== ToolCallStatus.TOOL_CALL_WAITING_APPROVAL || row.approvalAction === ApprovalAction.UNSPECIFIED) continue;
      log.push(askedEventFor(ids, row), ...answerEventsFor(ids, row, row.approvalAction));
    }
  }
  const answers = approvalAnswersOf(runId, { messages }, log);
  return { runId, decisions: answers.decisions, asks: answers.asks, denyMessages: answers.denyMessages };
}
