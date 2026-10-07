/**
 * Pins the gate-resolving half of APPROVE_ALL (submit-approval.ts
 * bulkApproveCoPendingToolCalls) for a call a hook asked for: the lease is
 * that hook's asks on that tool, so a hook's APPROVE_ALL approves only the
 * co-pending calls the same hook asked for on the same tool and server,
 * never a call the default asked for or another hook asked for; and a
 * default APPROVE_ALL never approves a call a hook asked for. Driven over
 * an in-memory execution, the function the submit chain calls.
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

import { bulkApproveCoPendingToolCalls } from "../submit-approval.js";

interface PendingCall {
  readonly id: string;
  readonly name: string;
  readonly server?: string;
  readonly hook?: string;
}

/** One pending call per entry; a `hook` (even empty) marks a hook's ask, its absence the default's. */
function executionWith(calls: readonly PendingCall[]): Run {
  return create(RunSchema, {
    status: {
      messages: [
        {
          toolCalls: calls.map((call) => ({
            id: call.id,
            name: call.name,
            mcpServerSlug: call.server ?? "",
            status: ToolCallStatus.TOOL_CALL_WAITING_APPROVAL,
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

function approvedBy(execution: Run, clicked: string): string[] {
  return bulkApproveCoPendingToolCalls(
    execution,
    clicked,
    "2026-10-05T00:00:00Z",
    "usr_1",
  ).map((tc) => tc.id);
}

describe("bulkApproveCoPendingToolCalls with a hook's lease", () => {
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

  it("never lets a default APPROVE_ALL approve a call a hook asked for", () => {
    const execution = executionWith([
      { id: "clicked", name: "execute" },
      { id: "same-default", name: "execute" },
      { id: "hooked", name: "execute", hook: "safety" },
    ]);
    expect(approvedBy(execution, "clicked")).toEqual(["same-default"]);
    const settled = execution.status!.messages[0]!.toolCalls;
    expect(settled.find((tc) => tc.id === "hooked")?.approvalAction).toBe(
      ApprovalAction.UNSPECIFIED,
    );
  });
});
