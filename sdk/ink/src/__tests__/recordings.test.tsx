// The terminal recordings the docs play (../recordings.ts): SessionView drawn
// over a story of the scenario catalogue one event at a time, as the frame
// goldens draw a state (`renderToString`, colour forced on), each frame
// stamped from its event's time, held in `__recordings__/<name>.json` like
// the goldens (`npx vitest run -u` rewrites them; CI never writes one, so a
// missing or changed file fails).
//
// The first frame is the command typed at the prompt. Each event then draws
// the view at the clock of its own time, so the working line counts the
// turn as it went; a long gap between two events is shortened, and the
// frame that waits for the person holds before their approval is drawn.
// Every frame keeps to INK-15's rule: no colour but the status hues.
import { vi } from "vitest";

vi.hoisted(() => {
  process.env.FORCE_COLOR = "3";
});

import React from "react";
import { readdirSync } from "node:fs";
import { stripVTControlCharacters } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { renderToString } from "ink";
import type { UseSessionConversationReturn, UseSessionUsageReturn } from "@stigmer/react-core";
import { conversationOf, scenarios, scriptedStory, upTo, usageOf, type Scenario } from "@stigmer/react-sdk/test";
import { SessionView } from "../app/SessionView.js";
import { RECORDINGS, type RecordedSession, type Recording, type RecordingFrame } from "../recordings.js";

/** How long the typed command shows before the turn starts. */
const COMMAND_MS = 1_200;
/** The longest a frame waits for the next event: a pause in the story plays as this, at most. */
const GAP_CAP_MS = 1_500;
/** How long the frame that waits for the person holds before their approval is drawn. */
const ASK_HOLD_MS = 2_500;
/** How long the last frame shows before a replay may start. */
const END_HOLD_MS = 3_000;

let conversation: UseSessionConversationReturn = conversationOf(scenarios.empty);
let usage: UseSessionUsageReturn = usageOf(scenarios.empty);

vi.mock("@stigmer/react-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@stigmer/react-core")>();
  return {
    ...actual,
    useSessionConversation: () => conversation,
    useStigmer: () => ({ baseUrl: "http://localhost:7234" }) as ReturnType<typeof actual.useStigmer>,
    useSessionUsage: () => usage,
  };
});

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
});

afterAll(() => {
  vi.useRealTimers();
});

/** The stories a recording can draw, by name. */
const STORIES: Readonly<Record<Recording["story"], () => Scenario>> = {
  "scripted-turn": () => scriptedStory(),
};

/** When an event was appended, in milliseconds since the epoch. */
function timeOf(scenario: Scenario, index: number): number {
  const value = scenario.events[index]!.event.value as { processedAt?: string } | undefined;
  return Date.parse(value?.processedAt ?? "");
}

/** The view over `scenario` at `columns`, at the clock `now`, escape codes and all. */
function drawn(scenario: Scenario, columns: number, now: number): string {
  vi.setSystemTime(new Date(now));
  conversation = conversationOf(scenario);
  usage = usageOf(scenario);
  return renderToString(<SessionView sessionId="ses_1" org="demo" canAnswer />, { columns });
}

/** Every frame of `recording`: the command typed, then the view after each event; a frame that draws nothing new is left out. */
function record(recording: Recording): RecordedSession {
  const story = STORIES[recording.story]();
  const frames: RecordingFrame[] = [{ at: 0, text: `$ ${recording.command}` }];
  let at = COMMAND_MS;
  for (let n = 1; n <= story.events.length; n += 1) {
    if (n > 1) {
      const answer = story.events[n - 1]!.event.case === "userToolConfirmation";
      at += answer ? ASK_HOLD_MS : Math.min(timeOf(story, n - 1) - timeOf(story, n - 2), GAP_CAP_MS);
    }
    const text = drawn(upTo(story, n), recording.columns, timeOf(story, n - 1));
    if (text !== frames.at(-1)!.text) frames.push({ at, text });
  }
  frames.push({ at: at + END_HOLD_MS, text: frames.at(-1)!.text });
  return { ...recording, frames };
}

/** The status hues' foreground codes: red, green, yellow, and the default. */
const STATUS_HUES: ReadonlySet<number> = new Set([31, 32, 33, 39]);

/** Each colour a frame's escape codes set that is not a status hue. */
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

describe("INK-18 the docs' terminal recordings are the terminal kit's own frames", () => {
  it.each(RECORDINGS)("records $name as SessionView draws its story, event by event", async (recording) => {
    const recorded = record(recording);
    await expect(`${JSON.stringify(recorded, null, 2)}\n`).toMatchFileSnapshot(`__recordings__/${recording.name}.json`);
  });

  it.each(RECORDINGS)("plays $name forward in time, waits at the ask, and ends on the answer", (recording) => {
    const { frames } = record(recording);
    expect(frames.every((frame, i) => i === 0 || frame.at > frames[i - 1]!.at)).toBe(true);
    const plain = frames.map((frame) => stripVTControlCharacters(frame.text));
    const ask = plain.length - 1 - [...plain].reverse().findIndex((text) => text.includes("[y] Approve"));
    expect(ask, "a frame waits for the person's answer").toBeLessThan(plain.length);
    expect(ask).toBeGreaterThan(0);
    expect(frames[ask + 1]!.at - frames[ask]!.at).toBe(ASK_HOLD_MS);
    expect(plain.at(-1)).toContain("Two changes this week");
    expect(plain.at(-1)).not.toContain("[y] Approve");
  });

  it.each(RECORDINGS)("draws $name with no colour but the status hues", (recording) => {
    const { frames } = record(recording);
    expect(frames.some((frame) => frame.text.includes("\u001b["))).toBe(true);
    expect(frames.flatMap((frame) => huesBeyondStatus(frame.text))).toEqual([]);
  });

  it("holds exactly the recordings the list names, so a removed one leaves no file behind", () => {
    const held = readdirSync(new URL("./__recordings__/", import.meta.url)).sort();
    expect(held).toEqual(RECORDINGS.map((recording) => `${recording.name}.json`).sort());
  });

  it("names each recording once, in kebab case", () => {
    const names = RECORDINGS.map((recording) => recording.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names.filter((name) => !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name))).toEqual([]);
  });
});
