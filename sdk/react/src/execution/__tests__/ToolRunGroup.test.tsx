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

  it("treats an interrupted call as terminal: the chip settles instead of pinning to pending", () => {
    // A platform-settled INTERRUPTED call (issue #207) inside a folded run.
    // Before the fix an unknown status kept allTerminal=false forever, pinning
    // the whole chip to a live-looking pending state with a spinner-adjacent
    // dot; a settled run must render settled.
    const { container } = render(
      <ToolRunGroup
        category="read"
        toolCalls={[
          makeRead("r1", "/a.ts", ToolCallStatus.TOOL_CALL_COMPLETED),
          makeRead("r2", "/b.ts", ToolCallStatus.TOOL_CALL_INTERRUPTED),
        ]}
      />,
    );
    expect(container.querySelector(".stg\\:animate-spin")).toBeNull();
    expect(chipExpanded(container)).toBe(false);
    // The aggregate resolves to the terminal branch — which is silent
    // (completed renders NO status icon, stigmer#274) — not the non-terminal
    // pending fallback, which renders its muted dot as a third header svg
    // beside the category icon and chevron.
    const headerSvgs = container.querySelectorAll("button svg");
    expect(headerSvgs.length).toBe(2);
    expect(screen.getByText("Read 2 files")).toBeTruthy();
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
      errorsByToolCallId: new Map(),
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

  it("is a quiet unboxed line whose expanded children sit under a left rail as divider rows", () => {
    const { container } = render(
      <ToolRunGroup
        category="read"
        toolCalls={[makeRead("r1", "/a.ts"), makeRead("r2", "/b.ts")]}
      />,
    );

    // Quiet chrome (stigmer#274): the fold is metadata-only by construction,
    // so the chip must never render as a bordered card shouting over the
    // conversation. Class presence only — actual rendering is guarded by the
    // layer-invariant + e2e computed-style tests (happy-dom does not resolve
    // `@layer`).
    const chip = container.querySelector('[data-cursor-target="tool-run-group"]')!;
    expect(chip.className).not.toContain("stg:rounded-lg");
    expect(chip.className).not.toContain("stg:border-border-prominent");

    fireEvent.click(screen.getByText("Read 2 files"));

    // With no card frame, the rail container owns the boundary; child rows
    // are dividers, never nested cards.
    expect(container.querySelector(".stg\\:border-l-2")).not.toBeNull();
    const rows = container.querySelectorAll('[data-cursor-target="tool-call-row"]');
    expect(rows.length).toBe(2);
    for (const row of rows) {
      expect(row.className).not.toContain("stg:rounded-lg");
      expect(row.className).toContain("stg:border-b");
    }
  });

  it("renders no status icon once the run settles successfully — success is silent", () => {
    const { container } = render(
      <ToolRunGroup
        category="read"
        toolCalls={[makeRead("r1", "/a.ts"), makeRead("r2", "/b.ts")]}
      />,
    );
    // Header svgs: the category icon and the chevron — no green check.
    expect(container.querySelectorAll("button svg").length).toBe(2);
  });

  it("keeps the failed icon when a folded call failed — failure shouts", () => {
    const { container } = render(
      <ToolRunGroup
        category="read"
        toolCalls={[
          makeRead("r1", "/a.ts"),
          makeRead("r2", "/b.ts", ToolCallStatus.TOOL_CALL_FAILED),
        ]}
      />,
    );
    expect(container.querySelector(".stg\\:text-destructive")).not.toBeNull();
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
