// The terminal recordings the docs play (../recordings.ts): SessionView drawn
// over a story of the scenario catalogue one event at a time, colour forced
// on, each frame stamped from its event's time, held in
// `__recordings__/<name>.json` like the goldens (`npx vitest run -u`
// rewrites them; CI never writes one, so a missing or changed file fails).
//
// One view stays up through the story, as the CLI keeps one up through a
// turn: Ink's `render` in debug mode on a fake terminal of the recording's
// width, which writes the whole screen, history included, on every render.
// Each event updates the conversation and draws the view again at the clock
// of its own time, so the working line counts the turn as it went; Ink's
// animation timer is held, so every spinner stays on its first frame. The
// view's effects run, so what the host writes in the thread when the turn
// ends reaches the frames: a recording's `afterTurn` notes are written
// through the view's own `onTurnEnd`, each in a frame of its own.
//
// The first frame is the command typed at the prompt. A long gap between
// two events is shortened, and the frame that waits for the person holds
// before their approval is drawn. Every frame keeps to INK-15's rule: no
// colour but the status hues.
import { vi } from "vitest";

vi.hoisted(() => {
  process.env.FORCE_COLOR = "3";
});

import React from "react";
import { readdirSync } from "node:fs";
import { stripVTControlCharacters } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { render } from "ink";
import type { UseSessionConversationReturn, UseSessionUsageReturn } from "@stigmer/react-core";
import { conversationOf, ledgerStory, scenarios, scriptedStory, upTo, usageOf, type Scenario } from "@stigmer/react-sdk/test";
import { SessionView, type TurnEndContext } from "../app/SessionView.js";
import { RECORDINGS, type RecordedSession, type Recording, type RecordingFrame } from "../recordings.js";
import { FakeStdin, FakeStdout } from "./fake-terminal.js";

/** How long the typed command shows before the turn starts. */
const COMMAND_MS = 1_200;
/** The longest a frame waits for the next event: a pause in the story plays as this, at most. */
const GAP_CAP_MS = 1_500;
/** How long the frame that waits for the person holds before their approval is drawn. */
const ASK_HOLD_MS = 2_500;
/** How long the last frame shows before a replay may start. */
const END_HOLD_MS = 3_000;
/** How long each note the host writes after the turn waits before it is drawn. */
const NOTE_MS = 700;

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
  // The clock is each event's; Ink's animation timer never fires, as renderToString's never started.
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
});

afterAll(() => {
  vi.useRealTimers();
});

/** The stories a recording can draw, by name. */
const STORIES: Readonly<Record<Recording["story"], () => Scenario>> = {
  "scripted-turn": () => scriptedStory(),
  "ledger-turn": () => ledgerStory(),
};

/** When an event was appended, in milliseconds since the epoch. */
function timeOf(scenario: Scenario, index: number): number {
  const value = scenario.events[index]!.event.value as { processedAt?: string } | undefined;
  return Date.parse(value?.processedAt ?? "");
}

/** Lets React run the view's effects and the renders they ask for (its scheduler keeps the real timers). */
function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/** One live view of `columns`: drawn again on each event and after each note the host writes, each time giving back the screen. */
interface LiveView {
  draw(scenario: Scenario, now: number): Promise<string>;
  /** Writes `text` in the thread through the view's own note, as the host does after a turn; refuses before a turn has ended. */
  note(text: string): Promise<string>;
  close(): void;
}

/**
 * A fake terminal that keeps each screen Ink draws apart from the other
 * bytes it writes (the composer's bracketed-paste switches): in debug mode a
 * screen is the one write that follows each `onRender`.
 */
class ScreenStdout extends FakeStdout {
  readonly screens: string[] = [];
  private next = false;

  /** Ink is about to write a screen. */
  readonly rendered = (): void => {
    this.next = true;
  };

  override write = (chunk: string): boolean => {
    this.chunks.push(chunk);
    if (this.next) this.screens.push(chunk);
    this.next = false;
    return true;
  };
}

function liveView(columns: number): LiveView {
  const stdout = new ScreenStdout(columns, 200);
  let note: TurnEndContext["note"] | undefined;
  // The host hears each turn end the view sees; the turns the load found ended are not its to answer.
  const onTurnEnd = (_turn: unknown, context: TurnEndContext) => {
    if (!context.atLoad) note = context.note;
  };
  const view = () => <SessionView sessionId="ses_1" org="demo" canAnswer onTurnEnd={onTurnEnd} />;
  let instance: ReturnType<typeof render> | undefined;
  /** The screen once the view has settled: debug mode writes it whole on every render. */
  const settled = async (): Promise<string> => {
    let written = -1;
    while (written !== stdout.chunks.length) {
      written = stdout.chunks.length;
      await flush();
    }
    return stdout.screens.at(-1)!;
  };
  return {
    async draw(scenario, now) {
      vi.setSystemTime(new Date(now));
      conversation = conversationOf(scenario);
      usage = usageOf(scenario);
      if (instance === undefined) {
        instance = render(view(), {
          stdout: stdout as unknown as NodeJS.WriteStream,
          stderr: new FakeStdout(columns, 200) as unknown as NodeJS.WriteStream,
          stdin: new FakeStdin() as unknown as NodeJS.ReadStream,
          debug: true,
          onRender: stdout.rendered,
          exitOnCtrlC: false,
          patchConsole: false,
        });
      } else instance.rerender(view());
      return settled();
    },
    async note(text) {
      if (note === undefined) throw new Error("no turn has ended for the host to write a note after");
      note(text);
      // The note is the view's own state; drawing the view again renders it, as the next event would.
      instance!.rerender(view());
      return settled();
    },
    close() {
      instance?.unmount();
    },
  };
}

/** Every frame of `recording`: the command typed, then the view after each event, then each note the host writes; a frame that draws nothing new is left out. */
async function record(recording: Recording): Promise<RecordedSession> {
  const story = STORIES[recording.story]();
  const frames: RecordingFrame[] = [{ at: 0, text: `$ ${recording.command}` }];
  const add = (at: number, text: string) => {
    if (text !== frames.at(-1)!.text) frames.push({ at, text });
  };
  const view = liveView(recording.columns);
  try {
    let at = COMMAND_MS;
    for (let n = 1; n <= story.events.length; n += 1) {
      if (n > 1) {
        const answer = story.events[n - 1]!.event.case === "userToolConfirmation";
        at += answer ? ASK_HOLD_MS : Math.min(timeOf(story, n - 1) - timeOf(story, n - 2), GAP_CAP_MS);
      }
      add(at, await view.draw(upTo(story, n), timeOf(story, n - 1)));
    }
    for (const text of recording.afterTurn?.notes ?? []) {
      at += NOTE_MS;
      add(at, await view.note(text));
    }
    frames.push({ at: at + END_HOLD_MS, text: frames.at(-1)!.text });
  } finally {
    view.close();
  }
  return { ...recording, frames };
}

/** Each recording drawn once, shared by the tests that read it. */
const drawn = new Map<string, Promise<RecordedSession>>();
function recorded(recording: Recording): Promise<RecordedSession> {
  let held = drawn.get(recording.name);
  if (held === undefined) {
    held = record(recording);
    drawn.set(recording.name, held);
  }
  return held;
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
    const held = await recorded(recording);
    await expect(`${JSON.stringify(held, null, 2)}\n`).toMatchFileSnapshot(`__recordings__/${recording.name}.json`);
  });

  it.each(RECORDINGS)("plays $name forward in time, holds at any ask, and ends on what the list says", async (recording) => {
    const { frames } = await recorded(recording);
    expect(frames.every((frame, i) => i === 0 || frame.at > frames[i - 1]!.at)).toBe(true);
    const plain = frames.map((frame) => stripVTControlCharacters(frame.text));
    const ask = plain.map((text) => text.includes("[y] Approve")).lastIndexOf(true);
    if (recording.asks) {
      expect(ask, "a frame waits for the person's answer").toBeGreaterThan(0);
      expect(frames[ask + 1]!.at - frames[ask]!.at).toBe(ASK_HOLD_MS);
    } else {
      expect(ask, "no frame waits for the person").toBe(-1);
    }
    expect(plain.at(-1)).toContain(recording.endsWith);
    expect(plain.at(-1)).not.toContain("[y] Approve");
  });

  it.each(RECORDINGS.filter((recording) => recording.afterTurn !== undefined))(
    "draws each note $name's host writes after the turn, in order, each in a frame of its own",
    async (recording) => {
      const plain = (await recorded(recording)).frames.map((frame) => stripVTControlCharacters(frame.text));
      const notes = recording.afterTurn!.notes;
      const firsts = notes.map((note) => plain.findIndex((text) => text.includes(note)));
      expect(firsts.every((first, i) => first > 0 && (i === 0 || first === firsts[i - 1]! + 1))).toBe(true);
      expect(plain.at(-1)).toContain(notes.at(-1)!);
    },
  );

  it.each(RECORDINGS)("draws $name with no colour but the status hues", async (recording) => {
    const { frames } = await recorded(recording);
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
