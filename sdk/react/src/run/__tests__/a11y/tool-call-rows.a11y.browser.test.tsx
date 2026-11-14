// Tool-call rows under axe in a real Chromium, light and dark, plus the
// stacking facts their headers rest on.
//
// A row that opens is one toggle button laid over its header, and the
// header's own controls (a running read's file, a background command's Stop)
// are lifted above it as siblings. Before that, the header was a
// `div[role=button]` wrapping those controls, which axe fails as
// `nested-interactive`: a screen reader announced one button and could not
// reach the file or Stop inside it. The audit pins every row shape that
// carries a header control or a toggle (a running read, a failed read, a
// delete, a running background command with Stop, a search whose pattern is
// cut off, a completed read, an edit).
//
// Which element takes a click is a painting-order fact, so only a browser can
// pin it: `elementFromPoint` at the step's words lands on the toggle, at the
// file control and at Stop on those controls. A command cut off beside the
// line shows in full on the toggle's hover, since the toggle covers it.

import { describe, it, expect, vi, afterEach } from "vitest";
import { screen, within } from "@testing-library/react";
import { userEvent } from "@vitest/browser/context";
import type { ReactElement } from "react";
import { auditA11y, COLOR_MODES, renderAudited, resetAudit } from "../../../__tests__/helpers/a11y-audit";
import { ToolCallItem } from "../../ToolCallItem";
import { BackgroundCommandContext, type BackgroundCommandContextValue } from "../../BackgroundCommandContext";
import { toolUse } from "../__fixtures__/fold-values";

afterEach(resetAudit);

const FILE = "/workspace/statements/july-statement.csv";
const LONG_QUERY = "invoices from the July statement run across every vendor and every currency we hold";
const LONG_COMMAND = "npm test -- billing/invoice billing/credit-note billing/statement --reporter=verbose";

const stopping: BackgroundCommandContextValue = {
  onStop: () => undefined,
  stoppingIds: new Set(),
  errorsByToolUseId: new Map(),
};

const ROWS: ReadonlyArray<readonly [string, () => ReactElement]> = [
  ["a running read", () => <ToolCallItem toolUse={toolUse({ name: "Read", input: { path: FILE }, state: "running" })} />],
  [
    "a failed read",
    () => (
      <ToolCallItem
        toolUse={toolUse({ name: "Read", input: { path: FILE }, isError: true, result: '{"status":"error","message":"permission denied"}' })}
      />
    ),
  ],
  ["a delete", () => <ToolCallItem toolUse={toolUse({ name: "delete_file", input: { path: FILE } })} />],
  [
    "a running background command with Stop",
    () => (
      <BackgroundCommandContext.Provider value={stopping}>
        <ToolCallItem toolUse={backgroundStart()} />
      </BackgroundCommandContext.Provider>
    ),
  ],
  ["a search cut off", () => <ToolCallItem toolUse={toolUse({ name: "Grep", input: { pattern: LONG_QUERY }, result: "a.ts:1: x" })} />],
  ["a completed read", () => <ToolCallItem toolUse={toolUse({ name: "Read", input: { path: FILE }, result: "a,b\n1,2" })} />],
  [
    "a preview edit",
    () => <ToolCallItem toolUse={toolUse({ name: "Edit", input: { file_path: FILE, old_string: "a", new_string: "b" } })} />,
  ],
];

function backgroundStart() {
  return toolUse({
    name: "execute",
    id: "run_1.bg-1",
    input: { command: "npm run dev", background: true },
    result: "Started in the background (id bg-1).",
    background: {},
  });
}

function toggleOf(container: HTMLElement): HTMLElement {
  const toggle = container.querySelector<HTMLElement>('[data-cursor-target="thread-card-toggle"]');
  if (toggle === null) throw new Error("the row has no toggle");
  return toggle;
}

// The hit tests' rows fit the browser runner's viewport (414 px wide by
// default): `elementFromPoint` answers null for a point outside it.
const HIT_BOX = { width: 400, height: 320 } as const;

/** The topmost element at an element's centre: what a click there reaches. */
function hitAtCentre(element: Element): Element | null {
  const box = element.getBoundingClientRect();
  return document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
}

describe.each(COLOR_MODES)("tool-call rows (%s)", (mode) => {
  it.each(ROWS)("%s passes axe", async (label, row) => {
    const container = renderAudited(row(), mode, { width: 640, height: 320 });
    await screen.findAllByText(/./);
    await auditA11y(container, `${label} (${mode})`);
  });
});

describe("a tool-call row's header in the browser", () => {
  it("sends a click on the title to the toggle, and one on the file control to the file", () => {
    const container = renderAudited(
      <ToolCallItem toolUse={toolUse({ name: "Read", input: { path: FILE }, result: "a,b\n1,2" })} />,
      "light",
      HIT_BOX,
    );
    const toggle = toggleOf(container);
    const header = toggle.parentElement!;
    // The step's words ("Read"), left of the file control the line names.
    // The innermost span with the words: the second line's wrapper holds them too.
    const line = within(header).getAllByText((_, element) => element?.textContent === "Read july-statement.csv" && element.tagName === "SPAN").at(-1)!;
    const box = line.getBoundingClientRect();
    expect(document.elementFromPoint(box.left + 6, box.top + box.height / 2)).toBe(toggle);
    const file = within(header).getByRole("button", { name: new RegExp(`: ${FILE}$`) });
    expect(file.contains(hitAtCentre(file)), "the file control is lifted above the toggle").toBe(true);
  });

  it("sends a click on an open row's chevron and a running row's spinner to the toggle", () => {
    // Both draw with a transform (the chevron's rotation, the spinner's
    // animation), which gives each its own stacking context: a toggle left at
    // z-index auto would paint under them and their clicks would reach nothing.
    const container = renderAudited(
      <ToolCallItem toolUse={toolUse({ name: "execute", input: { command: "npm test" }, state: "running", liveOutput: "PASS parser\n" })} />,
      "light",
      HIT_BOX,
    );
    const toggle = toggleOf(container);
    expect(toggle.getAttribute("aria-expanded"), "a running command opens on its own once it prints").toBe("true");
    const header = toggle.parentElement!;
    const chevron = header.querySelector('[class~="stg:rotate-90"]');
    const spinner = header.querySelector('[class~="stg:animate-spin"]');
    expect(chevron, "the open row's rotated chevron").not.toBeNull();
    expect(spinner, "the running row's spinner").not.toBeNull();
    expect(hitAtCentre(chevron!)).toBe(toggle);
    expect(hitAtCentre(spinner!)).toBe(toggle);
  });

  it("sends a click on Stop to Stop", () => {
    const container = renderAudited(
      <BackgroundCommandContext.Provider value={stopping}>
        <ToolCallItem toolUse={backgroundStart()} />
      </BackgroundCommandContext.Provider>,
      "light",
      HIT_BOX,
    );
    const toggle = toggleOf(container);
    const stop = within(toggle.parentElement!).getByRole("button", { name: "Stop" });
    expect(stop.contains(hitAtCentre(stop)), "Stop is lifted above the toggle").toBe(true);
  });

  it("shows a cut-off command in full on the toggle's hover, which the detail under it no longer can", async () => {
    const container = renderAudited(
      <ToolCallItem toolUse={toolUse({ name: "execute", input: { command: LONG_COMMAND }, result: "Tests: 3 passed" })} />,
      "light",
      { width: 320, height: 320 },
    );
    const toggle = toggleOf(container);
    const detail = within(toggle.parentElement!).getByText(LONG_COMMAND);
    expect(detail.scrollWidth, "the command is cut off at this width").toBeGreaterThan(detail.clientWidth);
    expect(hitAtCentre(detail), "the toggle covers the detail").toBe(toggle);

    await userEvent.hover(toggle);
    await vi.waitFor(() => expect(screen.getAllByText(LONG_COMMAND)).toHaveLength(2), { timeout: 3000, interval: 50 });
    await userEvent.unhover(toggle);
  });
});
