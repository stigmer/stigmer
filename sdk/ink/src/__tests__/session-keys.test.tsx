// Pins the session view's own keys, through Ink's input parser over the
// scenario catalogue's conversations:
//   - INK-07: Esc stops a working turn, a waiting one included, and a second
//     Esc asks again while it winds down (the core then terminates it); the
//     composer and its draft stay; a surface that holds the keyboard (the deny
//     reason) keeps its Esc; Shift+Tab and Ctrl+T switch the mode.
//   - INK-17: Ctrl+C on an empty composer says the agent keeps working and how
//     to come back, a second press within the window leaves, and a draft is
//     cleared first; a host command's context sends, stops, notes and leaves.
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, cleanup } from "ink-testing-library";
import { stripVTControlCharacters } from "node:util";
import type { Instance } from "ink";
import type { UseSessionConversationReturn } from "@stigmer/react-core";
import { conversationOf, scenarios } from "@stigmer/react-sdk/test";
import { LEAVE_WINDOW_MS, SessionView, leaveLine } from "../app/SessionView.js";
import { SessionApp } from "../app/SessionApp.js";
import type { SlashCommand } from "../input/extensions.js";
import { renderOnTerminal } from "./fake-terminal.js";

let conversation: UseSessionConversationReturn;

vi.mock("@stigmer/react-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@stigmer/react-core")>();
  return {
    ...actual,
    useSessionConversation: () => conversation,
    useStigmer: () => ({ baseUrl: "http://localhost:7234" }) as ReturnType<typeof actual.useStigmer>,
    useSessionUsage: () => ({ hasUsage: false }) as unknown as ReturnType<typeof actual.useSessionUsage>,
  };
});

let mounted: Instance | undefined;

afterEach(() => {
  cleanup();
  mounted?.unmount();
  mounted = undefined;
});

const settle = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms));

async function type(stdin: { write: (data: string) => void }, ...chunks: string[]) {
  for (const chunk of chunks) {
    stdin.write(chunk);
    await settle();
  }
}

const ESC = "\u001b";
const CTRL_C = "\u0003";

/** A scenario's conversation, with a stop that records each ask. */
function working(name: "busy" | "approval" | "completed", overrides: Partial<UseSessionConversationReturn> = {}) {
  const stop = vi.fn(async () => {});
  conversation = { ...conversationOf(scenarios[name]), stop, ...overrides };
  return stop;
}

describe("INK-07 Esc stops a running turn and leaves the session usable", () => {
  it("stops the working turn, asks again on a second Esc, and keeps the composer and its draft", async () => {
    const stop = working("busy");
    const { stdin, lastFrame } = render(<SessionView sessionId="ses_1" org="demo" canAnswer />);
    expect(lastFrame()).toMatch(/Running a command · [\dhms ]+ · Esc to stop/);
    await type(stdin, "only the tests", ESC);
    expect(stop).toHaveBeenCalledTimes(1);
    await type(stdin, ESC);
    expect(stop).toHaveBeenCalledTimes(2);
    expect(lastFrame()).toContain("❯ only the tests");
  });

  it("says why a stop failed, and keeps the session", () => {
    working("busy", { stopError: new Error("the session is not reachable") });
    const frame = render(<SessionView sessionId="ses_1" org="demo" canAnswer />).lastFrame() ?? "";
    expect(frame).toContain("Stop error: the session is not reachable");
    expect(frame).toContain("Esc to stop");
  });

  it("says a second Esc ends it now while the turn winds down", () => {
    working("busy", { isStopping: true });
    expect(render(<SessionView sessionId="ses_1" org="demo" canAnswer />).lastFrame()).toMatch(/Stopping… · [\dhms ]+ · Esc again to end it now/);
  });

  it("stops a turn that waits on an approval, and leaves the reason being typed its own Esc", async () => {
    const stop = working("approval");
    const { stdin, lastFrame } = render(<SessionView sessionId="ses_1" org="demo" canAnswer />);
    await type(stdin, "n");
    expect(lastFrame()).toContain("Deny — reason (optional):");
    await type(stdin, ESC);
    expect(stop).not.toHaveBeenCalled();
    expect(lastFrame()).toContain("[y] Approve");
    await type(stdin, ESC);
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("stops nothing when no turn works, and reads no key off a terminal", async () => {
    const stop = working("completed", { isStoppable: false });
    const { stdin } = render(<SessionView sessionId="ses_1" org="demo" canAnswer />);
    await type(stdin, ESC);
    expect(stop).not.toHaveBeenCalled();
    cleanup();
    const offStop = working("busy");
    const off = render(<SessionView sessionId="ses_1" org="demo" canAnswer={false} />);
    await type(off.stdin, ESC);
    expect(offStop).not.toHaveBeenCalled();
    expect(off.lastFrame()).not.toContain("Esc to stop");
  });

  it("switches plan and agent mode on Shift+Tab and Ctrl+T, and sends in the mode in effect", async () => {
    const sendFollowUp = vi.fn(async () => {});
    working("completed", { sendFollowUp, isStoppable: false });
    const { stdin, lastFrame } = render(<SessionView sessionId="ses_1" org="demo" canAnswer />);
    await type(stdin, "\u001b[Z");
    expect(lastFrame()).toContain("Plan mode");
    expect(lastFrame()).toContain("Shift+Tab agent mode");
    await type(stdin, "look only", "\r");
    expect(sendFollowUp).toHaveBeenCalledWith("look only", { interactionMode: "plan" });
    await type(stdin, "\u0014");
    expect(lastFrame()).toContain("Agent mode");
  });
});

describe("INK-17 leaving a session says the agent keeps working and how to come back", () => {
  it("words the leave line by the turn's phase, with the host's way back", () => {
    expect(leaveLine("running", "Come back with `stigmer resume ses_1`")).toBe("Press Ctrl+C again to leave. The agent keeps working. Come back with `stigmer resume ses_1`");
    expect(leaveLine(null)).toBe("Press Ctrl+C again to leave.");
    // A turn blocked on a person is not working.
    expect(leaveLine("waiting")).toBe("Press Ctrl+C again to leave. The agent waits for an answer.");
    expect(leaveLine("paused")).toBe("Press Ctrl+C again to leave. The turn stays paused.");
    expect(leaveLine("pending")).toBe("Press Ctrl+C again to leave. The agent keeps working.");
  });

  it("asks once, then leaves on a second Ctrl+C within the window", async () => {
    working("busy");
    const { instance, stdin, stdout } = renderOnTerminal(<SessionView sessionId="ses_1" org="demo" canAnswer leaveHint="Come back with `stigmer resume ses_1`" />, 100, 40);
    mounted = instance;
    let exited = false;
    void instance.waitUntilExit().then(() => {
      exited = true;
    });
    await settle(80);
    stdin.write(CTRL_C);
    await settle(80);
    expect(stripVTControlCharacters(stdout.output())).toContain("Press Ctrl+C again to leave. The agent keeps working. Come back with `stigmer resume ses_1`");
    expect(exited).toBe(false);
    stdin.write(CTRL_C);
    await settle(80);
    expect(exited).toBe(true);
  });

  it("takes any other key as not leaving: the next Ctrl+C asks again", async () => {
    working("busy");
    const { instance, stdin } = renderOnTerminal(<SessionView sessionId="ses_1" org="demo" canAnswer />, 100, 40);
    mounted = instance;
    let exited = false;
    void instance.waitUntilExit().then(() => {
      exited = true;
    });
    await settle(80);
    stdin.write(CTRL_C);
    await settle(80);
    stdin.write("\u000f");
    await settle(80);
    stdin.write(CTRL_C);
    await settle(80);
    expect(exited).toBe(false);
    stdin.write(CTRL_C);
    await settle(80);
    expect(exited).toBe(true);
  });

  it("clears a draft first, and asks again once the window passed", async () => {
    working("busy");
    const { instance, stdin, stdout } = renderOnTerminal(<SessionView sessionId="ses_1" org="demo" canAnswer />, 100, 40);
    mounted = instance;
    let exited = false;
    void instance.waitUntilExit().then(() => {
      exited = true;
    });
    await settle(80);
    stdin.write("draft");
    await settle(80);
    stdin.write(CTRL_C);
    await settle(80);
    expect(stripVTControlCharacters(stdout.output())).not.toContain("Press Ctrl+C again");
    stdin.write(CTRL_C);
    await settle(LEAVE_WINDOW_MS + 150);
    stdin.write(CTRL_C);
    await settle(80);
    expect(exited).toBe(false);
    stdin.write(CTRL_C);
    await settle(80);
    expect(exited).toBe(true);
  }, 10_000);

  it("gives a host command the session: it sends, stops, notes, switches the mode and leaves", async () => {
    const sendFollowUp = vi.fn(async () => {});
    const stop = working("busy", { sendFollowUp });
    const commands: SlashCommand[] = [
      { name: "say", description: "", run: (args, context) => context.send(`${args} (${context.mode})`) },
      { name: "halt", description: "", run: (_args, context) => context.stop() },
      { name: "hello", description: "", run: (args, context) => context.note(`Hello, ${args}.`) },
      { name: "plan", description: "", run: (_args, context) => context.setMode("plan") },
      { name: "bye", description: "", run: (_args, context) => context.leave() },
    ];
    const { instance, stdin, stdout } = renderOnTerminal(<SessionView sessionId="ses_1" org="demo" canAnswer composer={{ commands }} />, 100, 40);
    mounted = instance;
    let exited = false;
    void instance.waitUntilExit().then(() => {
      exited = true;
    });
    await settle(80);
    for (const line of ["/say hi", "/halt", "/hello there", "/plan"]) {
      stdin.write(line);
      await settle(60);
      stdin.write("\r");
      await settle(60);
    }
    expect(sendFollowUp).toHaveBeenCalledWith("hi (agent)", { interactionMode: "agent" });
    expect(stop).toHaveBeenCalledTimes(1);
    const text = stripVTControlCharacters(stdout.output());
    expect(text.split("Hello, there.")).toHaveLength(2);
    expect(text).toContain("Plan mode");
    stdin.write("/bye");
    await settle(60);
    stdin.write("\r");
    await settle(80);
    expect(exited).toBe(true);
  });
});

describe("INK-09 a host's commands and way back reach the view through SessionApp", () => {
  it("passes the composer and the leave hint down", async () => {
    working("busy");
    const commands: SlashCommand[] = [{ name: "deploy", description: "Ship it", run: () => {} }];
    const { stdin, lastFrame } = render(
      <SessionApp sessionId="ses_1" org="demo" baseUrl="http://localhost:7234" apiKey="k" composer={{ commands }} leaveHint="Come back later." />,
    );
    await type(stdin, "?");
    expect(lastFrame()).toMatch(/\/deploy\s+Ship it/);
    await type(stdin, "\u0015", CTRL_C);
    expect(lastFrame()).toContain("Come back later.");
  });
});
