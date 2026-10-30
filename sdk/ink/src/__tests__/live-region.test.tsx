// Pins what a person's terminal receives while a long turn works, through
// Ink's real output on a fake terminal (fake-terminal.ts), not a debug frame:
//   - INK-16: a turn many screens long never makes Ink clear the terminal
//     (which erases the scrollback above the session) and writes each settled
//     item to the history once;
//   - INK-11: after a resize, what is being written is drawn at the new
//     width, and what was written is not written again.
import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { stripVTControlCharacters } from "node:util";
import type { Instance } from "ink";
import type { Turn } from "@stigmer/client";
import type { SessionEvent } from "@stigmer/apis/ai/stigmer/agentic/session/v1/event_pb";
import { samples } from "@stigmer/react-sdk/test";
import { MessageThread } from "../components/MessageThread.js";
import { CLEAR_TERMINAL, renderOnTerminal, settle } from "./fake-terminal.js";
import { RUN_ID, turnOf } from "./session-events.js";

let mounted: Instance | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

/** A working turn after `steps` steps, each a command that returned and a paragraph about it. */
function longTurn(steps: number, writing: string): Turn {
  const events: SessionEvent[] = [samples.userMessageEvent("Make the billing suite pass."), samples.runStatusEvent("running")];
  for (let step = 0; step < steps; step += 1) {
    const use = samples.toolUseEvent("execute", { command: `npm test -- part-${step}` }, { id: `${RUN_ID}.tc-${step}` });
    events.push(use, samples.toolResultEvent(use.event.value!.id, `part ${step} passes`));
    events.push(samples.agentMessageEvent(`Step ${step} done: part ${step} passes now.`, { id: `${RUN_ID}.root.m${step}` }));
  }
  const turn = turnOf(events);
  // The reply still being written: two paragraphs, the second unfinished.
  const reply = { kind: "message" as const, id: `${RUN_ID}.root.live`, text: writing, live: true, processedAt: "" };
  return { ...turn, items: [...turn.items, reply] };
}

const WRITING = "The suite passes. ".repeat(3) + "\n\nNow checking the credit notes, which round the same way as the invoices did before the fix";

describe("INK-16 a long turn never clears the terminal's scrollback or repeats what it already printed", () => {
  it("draws a turn of many screens with no clear, each settled step written once", async () => {
    const { instance, stdout } = renderOnTerminal(<MessageThread turns={[longTurn(0, WRITING)]} />, 80, 24);
    mounted = instance;
    for (let steps = 1; steps <= 30; steps += 1) {
      instance.rerender(<MessageThread turns={[longTurn(steps, WRITING)]} />);
      await settle(20);
    }
    await settle();
    const output = stdout.output();
    expect(output).not.toMatch(CLEAR_TERMINAL);
    const text = stripVTControlCharacters(output);
    for (const step of [0, 14, 29]) expect(text.split(`Step ${step} done: part ${step} passes now.`)).toHaveLength(2);
  });
});

describe("INK-11 what is being written follows a terminal resize; what was written is never repeated", () => {
  it("redraws the block being written at the new width and writes nothing settled again", async () => {
    const { instance, stdout } = renderOnTerminal(<MessageThread turns={[longTurn(3, WRITING)]} />, 120, 40);
    mounted = instance;
    await settle();
    const before = stdout.chunks.length;
    stdout.resize(50, 40);
    await settle();
    const after = stripVTControlCharacters(stdout.chunks.slice(before).join(""));
    const lines = after.split("\n").filter((line) => line.trim() !== "");
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(50);
    expect(after.replace(/\s+/g, " ")).toContain("Now checking the credit notes, which round the same way as the invoices did before the fix");
    expect(after).not.toContain("Step 0 done");
    expect(after).not.toContain("The suite passes.");
  });
});
