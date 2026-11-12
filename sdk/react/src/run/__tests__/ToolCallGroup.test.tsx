// Pins ToolCallGroup over the session fold's tool uses: a turn's calls stay
// visible as persistent one-line steps, consecutive reads fold into one
// line, a lone read stays a step, the steps are divider rows inside one card
// (none when a container already frames them, `framed={false}`), an empty
// group renders nothing, and a call that started a subagent is titled from
// its `task` description beside its siblings.
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
    // The edit row names its file in its line.
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

  it("frames the steps as one card of divider rows, or none inside a frame", () => {
    const uses = [
      call("Bash", "s1", { command: "echo hi" }, "hi"),
      call("Edit", "e1", { file_path: "/a.ts", old_string: "a", new_string: "b" }),
      call("Read", "r1", { path: "/a.ts" }),
      call("Read", "r2", { path: "/b.ts" }),
    ];
    const { container, rerender } = render(<ToolCallGroup toolUses={uses} />);

    const group = container.querySelector('[data-cursor-target="tool-call-group"]')!;
    // One card around the whole run — class presence only; actual rendering
    // is guarded by the layer-invariant + e2e computed-style tests
    // (happy-dom does not resolve `@layer`).
    expect(group.className).toContain("stg:rounded-lg");
    expect(group.className).toContain("stg:border");
    expect(group.getAttribute("aria-label")).toBe("4 tool calls");

    // Each step is a divider row inside it, never a card in a card.
    const rows = container.querySelectorAll('[data-cursor-target="tool-call-row"]');
    expect(rows.length).toBe(2);
    for (const row of rows) {
      expect(row.className).not.toContain("stg:rounded-lg");
      expect(row.className).toContain("stg:border-b");
    }
    // The folded reads are a divider row too.
    expect(container.querySelector('[data-cursor-target="tool-run-group"]')?.className).toContain("stg:border-b");

    rerender(<ToolCallGroup toolUses={uses} framed={false} />);
    const bare = container.querySelector('[data-cursor-target="tool-call-group"]')!;
    expect(bare.className).not.toContain("stg:rounded-lg");
    expect(bare.className).not.toContain("stg:border");
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
