/**
 * Pins the class a grant allows (../answer.ts waitingInClass) for a call a
 * hook asked for: the lease is that hook's asks on that tool, so a hook's
 * grant allows only the waiting calls the same hook asked for on the same
 * tool and server, never a call the default asked for or another hook
 * asked for; a default grant never allows a call a hook asked for; and a
 * call whose ask is not open is never allowed. Driven over an in-memory
 * run, the function the answer core calls.
 */
import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import {
  RunSchema,
  type Run,
} from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import {
  ApprovalAction,
  ApprovalPolicySource,
  ToolCallStatus,
} from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";

import { deriveLeaseScope } from "../../../run/approval/lease-scope.js";
import { toolUseEventId } from "../../events/ids.js";
import { waitingInClass } from "../answer.js";

interface PendingCall {
  readonly id: string;
  readonly name: string;
  readonly server?: string;
  readonly hook?: string;
}

/** One pending call per entry; a `hook` (even empty) marks a hook's ask, its absence the default's. */
function executionWith(calls: readonly PendingCall[]): Run {
  return create(RunSchema, {
    metadata: { id: "run_1" },
    status: {
      messages: [
        {
          toolCalls: calls.map((call) => ({
            id: call.id,
            name: call.name,
            mcpServerSlug: call.server ?? "",
            status: ToolCallStatus.TOOL_CALL_WAITING_APPROVAL,
            requiresApproval: true,
            approvalPolicySource:
              call.hook === undefined
                ? call.server === undefined
                  ? ApprovalPolicySource.BUILTIN_CATEGORY
                  : ApprovalPolicySource.ANNOTATION_DESTRUCTIVE_TIGHTEN
                : ApprovalPolicySource.HOOK,
            approvalPolicyHook: call.hook ?? "",
          })),
        },
      ],
    },
  });
}

function approvedBy(execution: Run, clicked: string, closed: readonly string[] = []): string[] {
  const calls = execution.status!.messages[0]!.toolCalls;
  const lease = deriveLeaseScope(calls.find((tc) => tc.id === clicked)!)!;
  const open = new Set(
    calls.filter((tc) => !closed.includes(tc.id)).map((tc) => toolUseEventId("run_1", tc.id)),
  );
  return waitingInClass(execution, toolUseEventId("run_1", clicked), lease, open).map((row) => row.call.id);
}

describe("the class a grant allows, with a hook's lease", () => {
  it("approves only the same hook's asks on the same tool and server", () => {
    const execution = executionWith([
      { id: "clicked", name: "execute", hook: "safety" },
      { id: "same", name: "execute", hook: "safety" },
      { id: "other-tool", name: "write_file", hook: "safety" },
      { id: "other-hook", name: "execute", hook: "audit" },
      { id: "agent-block", name: "execute", hook: "" },
      { id: "by-default", name: "execute" },
      {
        id: "mcp-same-name",
        name: "execute",
        server: "github",
        hook: "safety",
      },
    ]);
    expect(approvedBy(execution, "clicked")).toEqual(["same"]);
  });

  it("keeps an MCP tool's server in the scope", () => {
    const execution = executionWith([
      { id: "clicked", name: "create_issue", server: "github", hook: "safety" },
      { id: "same", name: "create_issue", server: "github", hook: "safety" },
      {
        id: "other-server",
        name: "create_issue",
        server: "gitlab",
        hook: "safety",
      },
      { id: "server-default", name: "delete_repo", server: "github" },
    ]);
    expect(approvedBy(execution, "clicked")).toEqual(["same"]);
  });

  it("never lets a default grant allow a call a hook asked for", () => {
    const execution = executionWith([
      { id: "clicked", name: "execute" },
      { id: "same-default", name: "execute" },
      { id: "hooked", name: "execute", hook: "safety" },
    ]);
    expect(approvedBy(execution, "clicked")).toEqual(["same-default"]);
  });

  it("never allows a call of the class whose ask is closed or that was decided", () => {
    const execution = executionWith([
      { id: "clicked", name: "execute" },
      { id: "answered", name: "execute" },
      { id: "decided", name: "execute" },
      { id: "waiting", name: "execute" },
    ]);
    execution.status!.messages[0]!.toolCalls[2]!.approvalAction = ApprovalAction.REJECT;
    expect(approvedBy(execution, "clicked", ["answered"])).toEqual(["waiting"]);
  });
});
