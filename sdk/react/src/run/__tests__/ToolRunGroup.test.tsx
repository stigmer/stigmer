// Pins ToolRunGroup, the folded step of consecutive same-category tool
// uses: its category-aware label, disclosure (closed when settled, open
// while a folded call runs or waits for a person), its aggregate mark read
// from each `ToolUse.state` (the tick once settled, a stopped call settling
// it), the step's layout with its calls on a rail and no hairline between
// them, the host's label formatter, and the memo comparator that compares
// the folded tool uses one by one.
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import type { ToolUse, ToolUseState } from "@stigmer/client";
import { ToolRunGroup, toolRunGroupPropsEqual } from "../ToolRunGroup";
import { ApprovalContext, type ApprovalContextValue } from "../ApprovalContext";
import { toolUse } from "./__fixtures__/fold-values";

afterEach(cleanup);

function makeRead(id: string, path: string, state: ToolUseState = "completed"): ToolUse {
  return toolUse({ id, name: "Read", input: { path }, state });
}

function toggle(container: HTMLElement): HTMLElement {
  return container.querySelector<HTMLElement>("[aria-expanded]")!;
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
        toolUses={[
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
    const { container } = render(
      <ToolRunGroup
        category="read"
        toolUses={[makeRead("r1", "/a.ts"), makeRead("r2", "/b.ts")]}
      />,
    );

    fireEvent.click(toggle(container));
    // Read rows render filename-first (the leading "/" is a dimmed-or-hidden dir).
    expect(screen.getByText("a.ts")).toBeTruthy();
    expect(screen.getByText("b.ts")).toBeTruthy();
  });

  it("settles closed when the run has completed", () => {
    const { container } = render(
      <ToolRunGroup
        category="read"
        toolUses={[makeRead("r1", "/a.ts"), makeRead("r2", "/b.ts")]}
      />,
    );
    expect(chipExpanded(container)).toBe(false);
  });

  it("treats a stopped call as settled: the chip settles instead of looking live", () => {
    // A call its turn stopped before it returned (issue #207) inside a folded
    // run: a settled run must render settled.
    const { container } = render(
      <ToolRunGroup
        category="read"
        toolUses={[
          makeRead("r1", "/a.ts", "completed"),
          makeRead("r2", "/b.ts", "stopped"),
        ]}
      />,
    );
    expect(container.querySelector(".stg\\:animate-spin")).toBeNull();
    expect(chipExpanded(container)).toBe(false);
    // The aggregate resolves to the settled branch: the green tick (the
    // owner's ruling of 2026-11-14).
    expect(container.querySelector(".stg\\:bg-status-ready")).not.toBeNull();
    expect(screen.getByText("Read 2 files")).toBeTruthy();
  });

  it("auto-opens when a folded call waits for a person, so the gate is reachable", () => {
    const gated = toolUse({ id: "r2", name: "Read", input: { path: "/b.ts" }, ask: { argsPreview: '{"path":"/b.ts"}' } });
    const ctx: ApprovalContextValue = {
      onAnswer: () => {},
      submittingIds: new Set(),
      errorsByToolUseId: new Map(),
    };

    const { container } = render(
      <ApprovalContext.Provider value={ctx}>
        <ToolRunGroup category="read" toolUses={[makeRead("r1", "/a.ts"), gated]} />
      </ApprovalContext.Provider>,
    );

    expect(chipExpanded(container)).toBe(true);
    // The gate renders inline on its row inside the opened fold, whose own
    // mark is the running spinner (a waiting call is drawn running).
    expect(screen.getByLabelText("Allow")).toBeTruthy();
    expect(container.querySelector(".stg\\:text-status-running")).not.toBeNull();
  });

  it("stays open with a spinner while a folded call runs", () => {
    const { container } = render(
      <ToolRunGroup
        category="read"
        toolUses={[makeRead("r1", "/a.ts"), makeRead("r2", "/b.ts", "running")]}
      />,
    );
    expect(chipExpanded(container)).toBe(true);
    // At work, it reads bright on the running band, as the drawing's live
    // step does; the sweep is the quiet lines', not a step's.
    expect(container.querySelector(".stgm-shimmer-label")).toBeNull();
    expect(screen.getByText("Read 2 files").className).toContain("stg:text-foreground");
    expect(container.querySelector(".stg\\:bg-status-running-band")).not.toBeNull();
  });

  it("is a quiet unboxed step whose opened calls sit on a rail under its words, undivided", () => {
    const { container } = render(
      <ToolRunGroup
        category="read"
        toolUses={[makeRead("r1", "/a.ts"), makeRead("r2", "/b.ts")]}
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
    // The line reads at body size, like every step's line.
    expect(toggle(container).parentElement!.className).toContain("stg:text-sm");

    fireEvent.click(toggle(container));

    // The calls hang on a rail under the fold's words (the step's body),
    // never nested cards, with no hairline between them.
    const body = container.querySelector("[data-step-body]")!;
    expect(body.querySelector(".stg\\:border-l-2")).not.toBeNull();
    const rows = container.querySelectorAll('[data-cursor-target="tool-call-row"]');
    expect(rows.length).toBe(2);
    for (const row of rows) {
      expect(row.className).not.toContain("stg:rounded-lg");
      expect(row.className).not.toContain("stg:border-b");
    }
  });

  it("shows the green tick once the run settles successfully, its words quiet", () => {
    const { container } = render(
      <ToolRunGroup
        category="read"
        toolUses={[makeRead("r1", "/a.ts"), makeRead("r2", "/b.ts")]}
      />,
    );
    expect(container.querySelector(".stg\\:bg-status-ready")).not.toBeNull();
    expect(screen.getByText("Read 2 files").className).toContain("stg:text-muted-foreground");
  });

  it("keeps the failed icon when a folded call failed — failure shouts", () => {
    const { container } = render(
      <ToolRunGroup
        category="read"
        toolUses={[
          makeRead("r1", "/a.ts"),
          makeRead("r2", "/b.ts", "failed"),
        ]}
      />,
    );
    expect(container.querySelector(".stg\\:text-status-failed")).not.toBeNull();
  });

  it("honours a custom label formatter", () => {
    render(
      <ToolRunGroup
        category="read"
        toolUses={[makeRead("r1", "/a.ts"), makeRead("r2", "/b.ts")]}
        formatLabel={(calls) => `Inspected ${calls.length} sources`}
      />,
    );
    expect(screen.getByText("Inspected 2 sources")).toBeTruthy();
  });

  it("re-renders only when a folded tool use, the category, the formatter or the class changes", () => {
    const a = makeRead("r1", "/a.ts");
    const b = makeRead("r2", "/b.ts");
    const base = { category: "read" as const, toolUses: [a, b] };
    expect(toolRunGroupPropsEqual(base, { ...base, toolUses: [a, b] })).toBe(true);
    expect(toolRunGroupPropsEqual(base, { ...base, toolUses: [a, makeRead("r2", "/b.ts", "failed")] })).toBe(false);
    expect(toolRunGroupPropsEqual(base, { ...base, toolUses: [a] })).toBe(false);
    expect(toolRunGroupPropsEqual(base, { ...base, category: "list" })).toBe(false);
    expect(toolRunGroupPropsEqual(base, { ...base, className: "x" })).toBe(false);
  });
});
