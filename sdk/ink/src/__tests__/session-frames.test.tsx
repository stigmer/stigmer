// Frame goldens of the terminal session view: SessionView drawn over every
// state of the scenario catalogue (`@stigmer/react-sdk/test`), at 80 and 120
// columns, each frozen as plain text in `__goldens__`, so a change to the
// look is a diff a reviewer reads; `npx vitest run -u` rewrites them.
//
// Frames come from Ink's own `renderToString`, which draws one frame at a
// given width, synchronously, with the terminal hooks inert. The escape
// codes are stripped: colour is the subject of the INK-15 case below, which
// reads the same frames raw, with colour forced on, and allows only the
// status hues. The clock is pinned, through a fake `Date` only (Ink's own
// timers keep running), at the catalogue's SCENARIO_CLOCK: a running
// subagent counts its duration to now, and the working line counts the
// turn's time, both frozen with it.
// Vitest reports no obsolete file snapshot, so a last case holds the folder
// to exactly the frames the scenarios draw.
import { vi } from "vitest";

vi.hoisted(() => {
  process.env.FORCE_COLOR = "3";
});

import React from "react";
import { readdirSync } from "node:fs";
import { stripVTControlCharacters } from "node:util";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { renderToString } from "ink";
import { render, cleanup } from "ink-testing-library";
import type { UseSessionConversationReturn, UseSessionUsageReturn } from "@stigmer/react-core";
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

vi.mock("@stigmer/react-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@stigmer/react-core")>();
  return {
    ...actual,
    useSessionConversation: () => conversation,
    // The view words a failure with the address the client was built with.
    useStigmer: () => ({ baseUrl: "http://localhost:7234" }) as ReturnType<typeof actual.useStigmer>,
    useSessionUsage: () => usage,
  };
});

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(SCENARIO_CLOCK));
});

afterAll(() => {
  vi.useRealTimers();
});

/** The view over one scenario, at a width, as a terminal a person answers on shows it, escape codes and all. */
function rawFrame(name: ScenarioName, columns: number): string {
  conversation = conversationOf(scenarios[name]);
  usage = usageOf(scenarios[name]);
  return renderToString(<SessionView sessionId="ses_1" org="demo" canAnswer />, { columns });
}

/** The view over one scenario, at a width, as plain text. */
function frame(name: ScenarioName, columns: number): string {
  return stripVTControlCharacters(rawFrame(name, columns));
}

/** The status hues' foreground codes: red, green, yellow, and the default. */
const STATUS_HUES: ReadonlySet<number> = new Set([31, 32, 33, 39]);

/** Each colour a frame's escape codes set that is not a status hue: another name, a background, a 256 or RGB colour. */
function huesBeyondStatus(raw: string): string[] {
  const found: string[] = [];
  for (const match of raw.matchAll(/\u001b\[([\d;]*)m/g)) {
    const params = match[1]!.split(";").map(Number);
    if (params.some((p) => p === 38 || p === 48 || (p >= 40 && p <= 49) || (p >= 90 && p <= 107) || (p >= 30 && p <= 39 && !STATUS_HUES.has(p)))) {
      found.push(JSON.stringify(match[0]));
    }
  }
  return found;
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
  it("draws the heading, numbered and nested lists, code and table of a long reply without their markdown syntax", () => {
    const text = frame("markdown", 80);
    expect(text).toContain("What changed");
    expect(text).not.toContain("## What changed");
    expect(text).toMatch(/^ 1\. lineTotal keeps full precision\.$/m);
    expect(text).toMatch(/^ {4}• A credit note uses the same rule\.$/m);
    expect(text).toContain("export function invoiceTotal(lines: readonly Line[]): Cents {");
    expect(text).not.toContain("```");
    expect(text).not.toContain("`");
    expect(text).toMatch(/^ Case\s+Before\s+After$/m);
    expect(text).toMatch(/^ 3 × 0\.335\s+1\.02\s+1\.01$/m);
    expect(text).not.toContain("| --- |");
  });
});

describe("INK-15 a host passes its own colours; by default only status colours carry a hue", () => {
  it.each(SCENARIO_NAMES)("draws %s with no colour but the status hues", (name) => {
    const raw = rawFrame(name, 80);
    expect(raw).toContain("\u001b[");
    expect(huesBeyondStatus(raw)).toEqual([]);
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
    const expected = [
      ...FRAMES.map(({ name, columns }) => `session-${name}-${columns}.txt`),
      // The view off a terminal, denying an ask by default (session-view.test.tsx).
      "session-off-terminal-denied.txt",
      // A two-hour subagent's rows (components.test.tsx, CLI-13).
      "subagent-two-hours.txt",
    ].sort();
    expect(readdirSync(GOLDENS).sort()).toEqual(expected);
  });
});
