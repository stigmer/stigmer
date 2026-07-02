import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { create, type JsonObject } from "@bufbuild/protobuf";
import {
  ToolCallSchema,
  type ToolCall,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import { ToolCallStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { ToolCallGroup } from "../ToolCallGroup";

afterEach(cleanup);

function makeToolCall(name: string, id: string, args: Record<string, unknown>, result = ""): ToolCall {
  return create(ToolCallSchema, {
    id,
    name,
    args: args as JsonObject,
    result,
    status: ToolCallStatus.TOOL_CALL_COMPLETED,
  });
}

describe("ToolCallGroup timeline", () => {
  it("keeps a completed turn's high-signal rows visible (no per-turn collapse)", () => {
    render(
      <ToolCallGroup
        toolCalls={[
          makeToolCall("Shell", "s1", { command: "echo hi" }, "hi"),
          makeToolCall("StrReplace", "e1", { path: "/a.ts", old_string: "a", new_string: "b" }),
        ]}
      />,
    );

    // Both rows persist after the turn settles — nothing hidden behind a pill.
    expect(screen.getByText("echo hi")).toBeTruthy();
    // The edit row shows its file (filename-first) in the row header and its
    // bounded diff preview below.
    expect(screen.getAllByText("a.ts").length).toBeGreaterThanOrEqual(1);
    // There is no aggregate "Ran N tools" trigger any more.
    expect(screen.queryByText(/Ran \d+ tool/)).toBeNull();
  });

  it("folds a run of consecutive reads into one chip while leaving other rows", () => {
    render(
      <ToolCallGroup
        toolCalls={[
          makeToolCall("Shell", "s1", { command: "echo hi" }, "hi"),
          makeToolCall("Read", "r1", { path: "/a.ts" }),
          makeToolCall("Read", "r2", { path: "/b.ts" }),
          makeToolCall("Read", "r3", { path: "/c.ts" }),
        ]}
      />,
    );

    // The shell stays a row; the three reads collapse into a single chip.
    expect(screen.getByText("echo hi")).toBeTruthy();
    expect(screen.getByText("Read 3 files")).toBeTruthy();
    // Folded read paths are hidden until the chip is expanded.
    expect(screen.queryByText("/a.ts")).toBeNull();
  });

  it("renders a lone read as its own row, not a chip", () => {
    render(
      <ToolCallGroup toolCalls={[makeToolCall("Read", "r1", { path: "/only.ts" })]} />,
    );

    expect(screen.getByText("only.ts")).toBeTruthy();
    expect(screen.queryByText(/Read \d+ files/)).toBeNull();
  });

  it("hides a runner-collapsed duplicate twin (blanked SKIPPED) so one resource renders one card", () => {
    // The runner overlays the first same-resource denial as the gate and collapses
    // the redundant twin in place to a content-less SKIPPED row (it cannot drop the
    // committed id). That blanked twin must not render a second card.
    const gate = makeToolCall("edit", "stream-1", { path: "/notes.md", old_string: "a", new_string: "b" });
    gate.status = ToolCallStatus.TOOL_CALL_WAITING_APPROVAL;
    gate.requiresApproval = true;

    const collapsedTwin = create(ToolCallSchema, {
      id: "stream-2",
      name: "edit",
      // Blanked exactly as collapseDenialTwin leaves it: SKIPPED, no approval, no
      // result/error/argsPreview/file_changes.
      status: ToolCallStatus.TOOL_CALL_SKIPPED,
      requiresApproval: false,
    });

    const { container } = render(<ToolCallGroup toolCalls={[gate, collapsedTwin]} />);

    // Exactly one row — the gate; the collapsed twin is not drawn.
    const rows = container.querySelectorAll('[data-cursor-target="tool-call-row"]');
    expect(rows.length).toBe(1);
    expect(container.querySelector('[data-cursor-target="tool-call-group"]')).toBeTruthy();
  });

  it("renders nothing when every tool call in the group is a collapsed twin", () => {
    const collapsedTwin = create(ToolCallSchema, {
      id: "stream-2",
      name: "edit",
      status: ToolCallStatus.TOOL_CALL_SKIPPED,
      requiresApproval: false,
    });

    const { container } = render(<ToolCallGroup toolCalls={[collapsedTwin]} />);
    expect(container.querySelector('[data-cursor-target="tool-call-group"]')).toBeNull();
  });

  it("stacks each tool call as its own bordered card with gaps (no left rail)", () => {
    const { container } = render(
      <ToolCallGroup
        toolCalls={[
          makeToolCall("Shell", "s1", { command: "echo hi" }, "hi"),
          makeToolCall("StrReplace", "e1", { path: "/a.ts", old_string: "a", new_string: "b" }),
        ]}
      />,
    );

    const group = container.querySelector('[data-cursor-target="tool-call-group"]')!;
    // Cards stacked with a gap — the old left rail is gone.
    expect(group.className).toContain("gap-2");
    expect(group.className).not.toContain("border-l-2");

    const rows = container.querySelectorAll('[data-cursor-target="tool-call-row"]');
    expect(rows.length).toBe(2);
    for (const row of rows) {
      expect(row.className).toContain("rounded-lg");
      // Class presence only — actual rendering is guarded by the layer-invariant
      // + e2e computed-style tests (happy-dom does not resolve `@layer`).
      expect(row.className).toContain("border-border-prominent");
    }
  });
});
