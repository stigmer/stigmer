// Pins ToolCallGroup over the session fold's tool uses: a turn's calls stay
// visible as persistent rows, consecutive reads fold into one chip, a lone
// read stays a row, each call is its own bordered card, an empty group
// renders nothing, and a call that started a subagent is titled from its
// `task` description beside its siblings.
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { JsonObject } from "@bufbuild/protobuf";
import type { ToolUse } from "@stigmer/client";
import { ToolCallGroup } from "../ToolCallGroup";
import { thread, toolUse } from "./__fixtures__/fold-values";

afterEach(cleanup);

function call(name: string, id: string, input: JsonObject, result?: string): ToolUse {
  return toolUse({ name, id, input, ...(result === undefined ? {} : { result }) });
}

describe("ToolCallGroup timeline", () => {
  it("keeps a completed turn's high-signal rows visible (no per-turn collapse)", () => {
    render(
      <ToolCallGroup
        toolUses={[
          call("Bash", "s1", { command: "echo hi" }, "hi"),
          call("Edit", "e1", { file_path: "/a.ts", old_string: "a", new_string: "b" }),
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
        toolUses={[
          call("Bash", "s1", { command: "echo hi" }, "hi"),
          call("Read", "r1", { path: "/a.ts" }),
          call("Read", "r2", { path: "/b.ts" }),
          call("Read", "r3", { path: "/c.ts" }),
        ]}
      />,
    );

    // The shell stays a row; the three reads collapse into a single chip.
    expect(screen.getByText("echo hi")).toBeTruthy();
    expect(screen.getByText("Read 3 files")).toBeTruthy();
    // Folded read paths are hidden until the chip is expanded.
    expect(screen.queryByText("/a.ts")).toBeNull();
  });

  it("labels a folded chip with the host's formatter", () => {
    render(
      <ToolCallGroup
        toolUses={[call("Read", "r1", { path: "/a.ts" }), call("Read", "r2", { path: "/b.ts" })]}
        formatSummary={(uses) => `Looked at ${uses.length} files`}
      />,
    );
    expect(screen.getByText("Looked at 2 files")).toBeTruthy();
  });

  it("renders a lone read as its own row, not a chip", () => {
    render(<ToolCallGroup toolUses={[call("Read", "r1", { path: "/only.ts" })]} />);

    expect(screen.getByText("only.ts")).toBeTruthy();
    expect(screen.queryByText(/Read \d+ files/)).toBeNull();
  });

  it("renders nothing for an empty group", () => {
    const { container } = render(<ToolCallGroup toolUses={[]} />);
    expect(container.querySelector('[data-cursor-target="tool-call-group"]')).toBeNull();
  });

  it("stacks each tool call as its own bordered card with gaps (no left rail)", () => {
    const { container } = render(
      <ToolCallGroup
        toolUses={[
          call("Bash", "s1", { command: "echo hi" }, "hi"),
          call("Edit", "e1", { file_path: "/a.ts", old_string: "a", new_string: "b" }),
        ]}
      />,
    );

    const group = container.querySelector('[data-cursor-target="tool-call-group"]')!;
    // Cards stacked with a gap — the old left rail is gone.
    expect(group.className).toContain("stg:gap-2");
    expect(group.className).not.toContain("stg:border-l-2");
    expect(group.getAttribute("aria-label")).toBe("2 tool calls");

    const rows = container.querySelectorAll('[data-cursor-target="tool-call-row"]');
    expect(rows.length).toBe(2);
    for (const row of rows) {
      expect(row.className).toContain("stg:rounded-lg");
      // Class presence only — actual rendering is guarded by the layer-invariant
      // + e2e computed-style tests (happy-dom does not resolve `@layer`).
      expect(row.className).toContain("stg:border-border-prominent");
    }
  });
});

describe("ToolCallGroup subagent rows", () => {
  it("titles a call that started a subagent from its task description, and leaves the others alone", () => {
    render(
      <ToolCallGroup
        toolUses={[
          toolUse({
            name: "task",
            id: "sa-1",
            input: { description: "Research competitor pricing" },
            thread: thread({ agentName: "researcher", state: "completed" }),
            result: "done",
          }),
          call("Bash", "s1", { command: "echo hi" }, "hi"),
        ]}
      />,
    );

    expect(screen.getByText("Research competitor pricing")).toBeTruthy();
    expect(screen.getByText("echo hi")).toBeTruthy();
    expect(screen.getByRole("group").getAttribute("aria-label")).toBe("2 tool calls");
  });
});
