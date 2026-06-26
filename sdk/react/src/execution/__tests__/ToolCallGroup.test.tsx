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
      expect(row.className).toContain("border-border-prominent");
    }
  });
});
