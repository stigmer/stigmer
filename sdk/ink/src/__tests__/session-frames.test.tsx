// Frame goldens of the terminal session view: SessionView drawn over every
// state of the scenario catalogue (`@stigmer/react-sdk/test`), at 80 and 120
// columns, each frozen as plain text in `__goldens__`, so a change to the
// look is a diff a reviewer reads; `npx vitest run -u` rewrites them.
//
// Frames come from Ink's own `renderToString`, which draws one frame at a
// given width, synchronously, with the terminal hooks inert. The escape
// codes are stripped: colour is the subject of unit tests, not of goldens.
// Two inputs are pinned so a frame reads the same on every machine:
//   - `process.stdout.columns` is 80 before the first frame, because the
//     markdown renderer wraps at the process's width, not the frame's, and
//     keeps the first width it saw (markdown.ts). The 120-column frames
//     therefore show today's wrapping as it is.
//   - the clock, through a fake `Date` only (Ink's own timers keep running),
//     at the catalogue's SCENARIO_CLOCK: a finished subagent with no end time
//     counts its duration to now, and that row is frozen with it.
// Vitest reports no obsolete file snapshot, so a last case holds the folder
// to exactly the frames the scenarios draw.
import React from "react";
import { readdirSync } from "node:fs";
import { stripVTControlCharacters } from "node:util";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { renderToString } from "ink";
import { render, cleanup } from "ink-testing-library";
import type { UseSessionConversationReturn, UseSessionUsageReturn } from "@stigmer/react-sdk";
import {
  SCENARIO_CLOCK,
  SCENARIO_NAMES,
  conversationOf,
  scenarios,
  usageOf,
  type ScenarioName,
} from "@stigmer/react-sdk/test";
import { SessionView } from "../app/SessionView.js";

const WIDTHS = [80, 120] as const;
const GOLDENS = new URL("./__goldens__/", import.meta.url);

let conversation: UseSessionConversationReturn = conversationOf(scenarios.empty);
let usage: UseSessionUsageReturn = usageOf(scenarios.empty);

vi.mock("@stigmer/react-sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@stigmer/react-sdk")>();
  return {
    ...actual,
    useSessionConversation: () => conversation,
    useSessionUsage: () => usage,
  };
});

// The markdown renderer reads this once, at its first use.
const realColumns = Object.getOwnPropertyDescriptor(process.stdout, "columns");
Object.defineProperty(process.stdout, "columns", { value: 80, configurable: true });

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(SCENARIO_CLOCK));
});

afterAll(() => {
  vi.useRealTimers();
  if (realColumns) Object.defineProperty(process.stdout, "columns", realColumns);
});

/** The view over one scenario, at a width, as plain text. */
function frame(name: ScenarioName, columns: number): string {
  conversation = conversationOf(scenarios[name]);
  usage = usageOf(scenarios[name]);
  return stripVTControlCharacters(renderToString(<SessionView sessionId="ses_1" org="demo" />, { columns }));
}

const FRAMES = SCENARIO_NAMES.flatMap((name) => WIDTHS.map((columns) => ({ name, columns })));

describe("INK-01 every state a run passes through has its own frame", () => {
  it.each(FRAMES)("draws $name at $columns columns", async ({ name, columns }) => {
    await expect(frame(name, columns)).toMatchFileSnapshot(`__goldens__/session-${name}-${columns}.txt`);
  });

  it("draws no two states alike", () => {
    const drawn = SCENARIO_NAMES.map((name) => frame(name, 80));
    expect(new Set(drawn).size).toBe(SCENARIO_NAMES.length);
  });
});

describe("INK-13 long markdown (lists, code, tables) reads cleanly in the terminal", () => {
  // Inline code inside a list item still shows its backticks today; the
  // promise's open issue tracks it, and this case holds the rest.
  it("draws the heading, numbered and nested lists, code and table of a long reply without their markdown syntax", () => {
    const text = frame("markdown", 80);
    expect(text).toContain("What changed");
    expect(text).not.toContain("## What changed");
    expect(text).toMatch(/^\s+1\. .*keeps full precision\.$/m);
    expect(text).toMatch(/^\s+\* A credit note uses the same rule\.$/m);
    expect(text).toContain("export function invoiceTotal(lines: readonly Line[]): Cents {");
    expect(text).not.toContain("```");
    expect(text).toMatch(/Case\s+│\s+Before\s+│\s+After/);
    expect(text).not.toContain("| --- |");
  });
});

describe("INK-02 an approval prompt is unmissable, keyboard-driven, and never times out into approval", () => {
  afterEach(() => {
    cleanup();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(SCENARIO_CLOCK));
  });

  it("still waits, and has answered nothing, an hour later", () => {
    vi.useFakeTimers();
    const answerToolUse = vi.fn(async () => {});
    conversation = { ...conversationOf(scenarios.approval), answerToolUse };
    usage = usageOf(scenarios.approval);
    const { lastFrame } = render(<SessionView sessionId="ses_1" org="demo" />);
    expect(lastFrame()).toContain("[y] Approve");
    vi.advanceTimersByTime(60 * 60 * 1000);
    expect(lastFrame()).toContain("[y] Approve");
    expect(lastFrame()).toContain("[n] Deny");
    expect(answerToolUse).not.toHaveBeenCalled();
  });
});

describe("the frame goldens", () => {
  it("holds exactly the frames the scenarios draw, so a removed scenario leaves none behind", () => {
    const expected = FRAMES.map(({ name, columns }) => `session-${name}-${columns}.txt`).sort();
    expect(readdirSync(GOLDENS).sort()).toEqual(expected);
  });
});
