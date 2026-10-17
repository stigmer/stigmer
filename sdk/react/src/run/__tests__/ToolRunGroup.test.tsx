// Pins ToolRunGroup, the folded chip of consecutive same-category tool
// uses: its category-aware label, disclosure (closed when settled, open
// while a folded call runs or waits for a person), its aggregate status read
// from each `ToolUse.state` (a stopped call settles the chip), quiet chrome
// with divider rows, the host's label formatter, and the memo comparator
// that compares the folded tool uses one by one.
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
    render(
      <ToolRunGroup
        category="read"
        toolUses={[makeRead("r1", "/a.ts"), makeRead("r2", "/b.ts")]}
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
    // The aggregate resolves to the settled branch — which is silent
    // (completed renders NO status icon, stigmer#274): only the category icon
    // and the chevron.
    const headerSvgs = container.querySelectorAll("button svg");
    expect(headerSvgs.length).toBe(2);
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
    // The gate renders inline on its row inside the opened chip, with the
    // waiting clock on the chip.
    expect(screen.getByLabelText("Approve")).toBeTruthy();
    expect(container.querySelector("button .stg\\:text-warning")).not.toBeNull();
  });

  it("stays open with a spinner while a folded call runs", () => {
    const { container } = render(
      <ToolRunGroup
        category="read"
        toolUses={[makeRead("r1", "/a.ts"), makeRead("r2", "/b.ts", "running")]}
      />,
    );
    expect(chipExpanded(container)).toBe(true);
    expect(container.querySelector(".stgm-shimmer-label")?.textContent).toBe("Read 2 files");
  });

  it("is a quiet unboxed line whose expanded children sit under a left rail as divider rows", () => {
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
        toolUses={[makeRead("r1", "/a.ts"), makeRead("r2", "/b.ts")]}
      />,
    );
    // Header svgs: the category icon and the chevron — no green check.
    expect(container.querySelectorAll("button svg").length).toBe(2);
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
    expect(container.querySelector(".stg\\:text-destructive")).not.toBeNull();
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
