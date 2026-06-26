import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { create, type JsonObject } from "@bufbuild/protobuf";
import {
  ToolCallSchema,
  type ToolCall,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import {
  PendingApprovalSchema,
  type PendingApproval,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/approval_pb";
import { ToolCallStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { ToolRunGroup } from "../ToolRunGroup";
import { ApprovalContext, type ApprovalContextValue } from "../ApprovalContext";

afterEach(cleanup);

function makeRead(id: string, path: string, status?: ToolCallStatus): ToolCall {
  return create(ToolCallSchema, {
    id,
    name: "Read",
    args: { path } as JsonObject,
    status: status ?? ToolCallStatus.TOOL_CALL_COMPLETED,
  });
}

function chipExpanded(container: HTMLElement): boolean {
  return (
    container.querySelector("[aria-expanded]")?.getAttribute("aria-expanded") ===
    "true"
  );
}

describe("ToolRunGroup", () => {
  it("renders a category-aware collapsed label and hides the rows", () => {
    const { container } = render(
      <ToolRunGroup
        category="read"
        toolCalls={[
          makeRead("r1", "/a.ts"),
          makeRead("r2", "/b.ts"),
          makeRead("r3", "/c.ts"),
        ]}
      />,
    );

    expect(screen.getByText("Read 3 files")).toBeTruthy();
    expect(chipExpanded(container)).toBe(false);
    // Rows are not rendered while folded.
    expect(screen.queryByText("/a.ts")).toBeNull();
  });

  it("reveals the folded rows on expand", () => {
    render(
      <ToolRunGroup
        category="read"
        toolCalls={[makeRead("r1", "/a.ts"), makeRead("r2", "/b.ts")]}
      />,
    );

    fireEvent.click(screen.getByText("Read 2 files"));
    // Read rows render filename-first (the leading "/" is a dimmed-or-hidden dir).
    expect(screen.getByText("a.ts")).toBeTruthy();
    expect(screen.getByText("b.ts")).toBeTruthy();
  });

  it("settles closed when the run has completed", () => {
    const { container } = render(
      <ToolRunGroup
        category="read"
        toolCalls={[makeRead("r1", "/a.ts"), makeRead("r2", "/b.ts")]}
      />,
    );
    expect(chipExpanded(container)).toBe(false);
  });

  it("auto-opens when a folded call is awaiting approval, so the gate is reachable", () => {
    const gated = makeRead("r2", "/b.ts", ToolCallStatus.TOOL_CALL_WAITING_APPROVAL);
    const approval: PendingApproval = create(PendingApprovalSchema, {
      toolCallId: "r2",
      toolName: "Read",
      argsPreview: '{"path":"/b.ts"}',
    });
    const ctx: ApprovalContextValue = {
      approvalsByToolCallId: new Map([["r2", approval]]),
      onSubmit: () => {},
      submittingIds: new Set(),
    };

    const { container } = render(
      <ApprovalContext.Provider value={ctx}>
        <ToolRunGroup category="read" toolCalls={[makeRead("r1", "/a.ts"), gated]} />
      </ApprovalContext.Provider>,
    );

    expect(chipExpanded(container)).toBe(true);
    // The gate renders inline on its row inside the opened chip.
    expect(screen.getByLabelText("Approve")).toBeTruthy();
  });

  it("is a bordered card whose expanded children are borderless divider rows", () => {
    const { container } = render(
      <ToolRunGroup
        category="read"
        toolCalls={[makeRead("r1", "/a.ts"), makeRead("r2", "/b.ts")]}
      />,
    );

    const chip = container.querySelector('[data-cursor-target="tool-run-group"]')!;
    expect(chip.className).toContain("rounded-lg");
    expect(chip.className).toContain("border-border-prominent");

    fireEvent.click(screen.getByText("Read 2 files"));

    // The chip is the card; its child rows are dividers, never nested cards.
    const rows = container.querySelectorAll('[data-cursor-target="tool-call-row"]');
    expect(rows.length).toBe(2);
    for (const row of rows) {
      expect(row.className).not.toContain("rounded-lg");
      expect(row.className).toContain("border-b");
    }
  });

  it("honours a custom label formatter", () => {
    render(
      <ToolRunGroup
        category="read"
        toolCalls={[makeRead("r1", "/a.ts"), makeRead("r2", "/b.ts")]}
        formatLabel={(calls) => `Inspected ${calls.length} sources`}
      />,
    );
    expect(screen.getByText("Inspected 2 sources")).toBeTruthy();
  });
});
