/**
 * What the server writes when a person answers a call that asked, as both
 * test kits model it (the harness-contract `ExecutionDriver.decide` and the
 * hermetic `ExecutionRecord.decideWaitingToolCalls`): the answer's session
 * events, and the stamp on the row, in one act, as the server's answer core
 * commits them in one transaction.
 *
 *  - a `user.tool_confirmation` naming the call's tool use id
 *    (`harness/events/ids.ts` `toolUseEventId`): `allow` for APPROVE and
 *    APPROVE_ALL, `deny` for REJECT and SKIP (a person's skip and reject
 *    are one deny; a reason, when given, is its `deny_message`);
 *  - for APPROVE_ALL, a `stigmer.permission.grant` on that call after it;
 *  - the row's `approval_action`: APPROVE_ALL, APPROVE, or REJECT for any
 *    deny, which is what the server stamps (a SKIP is never stamped any more).
 *
 * The ids follow the server's rule for an answer (`sevt_` and a hash of the
 * tool use id), so a resent answer names the same event.
 *
 * The runtime reads the answers back through its one door
 * (`harness/approval-answers.ts`), so a kit that answered only the row, or
 * only the log, would fail its goldens.
 */
import { createHash } from "node:crypto";

import { create } from "@bufbuild/protobuf";
import { ApprovalAction } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import type { ToolCall } from "@stigmer/protos/ai/stigmer/agentic/run/v1/message_pb";
import { SessionEventSchema, type SessionEvent } from "@stigmer/protos/ai/stigmer/agentic/session/v1/event_pb";

import { toolUseEventId } from "../harness/events/ids.js";
import { deriveLeaseScope } from "../shared/approval-policy.js";

function hashed(prefix: string, toolUseId: string): string {
  return `${prefix}${createHash("sha256").update(toolUseId).digest("hex").slice(0, 40)}`;
}

/** The action the server stamps on the row for an answer given as `action`. */
export function stampedActionOf(action: ApprovalAction): ApprovalAction {
  return action === ApprovalAction.SKIP ? ApprovalAction.REJECT : action;
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
