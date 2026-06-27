import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { create, type JsonObject } from "@bufbuild/protobuf";
import {
  ToolCallSchema,
  type ToolCall,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import {
  ApprovalPolicySource,
  ToolKind,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { ToolCallDetail } from "../ToolCallDetail";

afterEach(cleanup);

function makeToolCall(opts: {
  name: string;
  toolKind?: ToolKind;
  args?: Record<string, unknown>;
  result?: string;
  approvalPolicySource?: ApprovalPolicySource;
  startedAt?: string;
  completedAt?: string;
}): ToolCall {
  return create(ToolCallSchema, {
    id: opts.name,
    name: opts.name,
    toolKind: opts.toolKind ?? ToolKind.UNSPECIFIED,
    args: (opts.args ?? {}) as JsonObject,
    result: opts.result ?? "",
    approvalPolicySource:
      opts.approvalPolicySource ?? ApprovalPolicySource.UNSPECIFIED,
    startedAt: opts.startedAt ?? "",
    completedAt: opts.completedAt ?? "",
  });
}

describe("ToolCallDetail — metadata invariant (header owns it, body shows content)", () => {
  it("does not render the duration in the body (the owning row header shows it)", () => {
    // A 5s run would format as "5.0s" if the body still printed duration.
    const { container } = render(
      <ToolCallDetail
        toolCall={makeToolCall({
          name: "delete_file",
          toolKind: ToolKind.FILE_DELETE,
          args: { path: "/tmp/x.ts" },
          startedAt: "2026-01-01T00:00:00.000Z",
          completedAt: "2026-01-01T00:00:05.000Z",
        })}
      />,
    );
    expect(container.textContent).not.toContain("5.0s");
  });

  it("suppresses the everyday default provenance (built-in tool policy is noise)", () => {
    const { queryByText } = render(
      <ToolCallDetail
        toolCall={makeToolCall({
          name: "delete_file",
          toolKind: ToolKind.FILE_DELETE,
          args: { path: "/tmp/x.ts" },
          approvalPolicySource: ApprovalPolicySource.BUILTIN_CATEGORY,
        })}
      />,
    );
    expect(queryByText(/required by/)).toBeNull();
  });

  it("suppresses provenance entirely for a legacy/ungated UNSPECIFIED call", () => {
    const { queryByText } = render(
      <ToolCallDetail
        toolCall={makeToolCall({
          name: "delete_file",
          toolKind: ToolKind.FILE_DELETE,
          args: { path: "/tmp/x.ts" },
          approvalPolicySource: ApprovalPolicySource.UNSPECIFIED,
        })}
      />,
    );
    expect(queryByText(/required by/)).toBeNull();
    expect(queryByText(/auto-approved/)).toBeNull();
  });

  it("surfaces a genuinely informative provenance (a run lease that cleared the call)", () => {
    const { getByText } = render(
      <ToolCallDetail
        toolCall={makeToolCall({
          name: "delete_file",
          toolKind: ToolKind.FILE_DELETE,
          args: { path: "/tmp/x.ts" },
          approvalPolicySource: ApprovalPolicySource.APPROVAL_LEASE,
        })}
      />,
    );
    expect(getByText("auto-approved by a run lease")).toBeTruthy();
  });
});

describe("ToolCallDetail — edit body has no duplicate stats", () => {
  it("renders the edit diff as a table without restating the +N -M counts", () => {
    const { container } = render(
      <ToolCallDetail
        toolCall={makeToolCall({
          name: "str_replace",
          toolKind: ToolKind.FILE_EDIT,
          args: { path: "src/x.ts" },
          result:
            '{"status":"success","value":{"linesAdded":1,"linesRemoved":0,"diffString":"@@ -0,0 +1,1 @@\\n+new line"}}',
        })}
      />,
    );
    // The diff content renders through the table...
    expect(container.querySelector("table")).not.toBeNull();
    expect(container.textContent).toContain("new line");
    // ...but the body does not repeat the +N -M the row header already shows.
    expect(container.textContent).not.toContain("+1");
  });
});
