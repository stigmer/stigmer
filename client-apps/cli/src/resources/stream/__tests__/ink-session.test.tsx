// Pins how `stigmer run` and `stigmer resume` hand the session to the
// terminal kit (ink.tsx): the view gets the CLI's composer (its commands, `@`
// over the session's folders, a history per directory) and the words for
// coming back, and Ink neither exits on Ctrl+C (the view's key) nor goes
// without the kitty keyboard where the terminal offers it. How it ends
// (CLI-11): under `until: "turn"` it returns once the watched run's turn ends
// and the host's action for that turn has finished; a turn's action writes
// its lines as notes in the thread while the view is up and to stderr after;
// a failed action says so; and control returns only once every action has
// finished. Ink's `render` is replaced, so nothing draws.
import type React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Stigmer, Turn } from "@stigmer/client";

const rendered = vi.hoisted(() => ({
  element: undefined as unknown,
  options: undefined as unknown,
  // When set, the view stays up until unmounted; else it leaves at once.
  stayUp: false,
  unmounted: 0,
}));

vi.mock("ink", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ink")>();
  return {
    ...actual,
    render: (element: unknown, options: unknown) => {
      rendered.element = element;
      rendered.options = options;
      let leave = (): void => undefined;
      const exited = rendered.stayUp ? new Promise<void>((resolve) => (leave = resolve)) : Promise.resolve();
      return {
        waitUntilExit: () => exited,
        unmount: () => {
          rendered.unmounted += 1;
          leave();
        },
      };
    },
  };
});

import { comeBackHint, runInkSession } from "../ink.js";

describe("the live session view", () => {
  it("gives the view the CLI's composer and its way back, and leaves Ctrl+C to the view", async () => {
    await runInkSession({ client: {} as Stigmer, sessionId: "ses_1", org: "acme", mode: "plan", workspaceRoots: [] });
    expect(rendered.options).toEqual({ exitOnCtrlC: false, kittyKeyboard: { mode: "auto" } });
    const provider = rendered.element as React.ReactElement<{ deploymentMode: string; children: React.ReactElement<Record<string, unknown>> }>;
    expect(provider.props.deploymentMode).toBe("cloud");
    const view = provider.props.children.props as { mode: string; leaveHint: string; composer: { commands: { name: string }[]; completions: unknown[] } };
    expect(view.mode).toBe("plan");
    expect(view.leaveHint).toBe("Come back with `stigmer resume ses_1`.");
    expect(view.composer.commands.map((command) => command.name)).toEqual(["help", "mode", "stop", "exit"]);
    expect(view.composer.completions).toEqual([]);
    expect(comeBackHint("ses_2")).toBe("Come back with `stigmer resume ses_2`.");
  });
});

/** The onTurnEnd the view was given. */
function viewOnTurnEnd(): (turn: Turn, context: { note: (text: string) => void; atLoad: boolean }) => void {
  const provider = rendered.element as React.ReactElement<{ children: React.ReactElement<Record<string, unknown>> }>;
  return provider.props.children.props.onTurnEnd as never;
}

const turn = (runId: string) => ({ runId }) as unknown as Turn;
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("CLI-11 the live session ends the way its mode promises", () => {
  afterEach(() => {
    rendered.stayUp = false;
    rendered.unmounted = 0;
    vi.restoreAllMocks();
  });

  it("returns under --until turn once the watched turn ends and its outputs are saved, telling the thread", async () => {
    rendered.stayUp = true;
    const notes: string[] = [];
    let release = (): void => undefined;
    const saving = new Promise<void>((resolve) => (release = resolve));
    const afterTurn = vi.fn(async (seen: Turn, _atLoad: boolean, say: (line: string) => void) => {
      await saving;
      if (seen.runId === "run_1") say("  Downloaded variance-report.md (4.2 KB)");
    });
    const done = runInkSession({ client: {} as Stigmer, sessionId: "ses_1", org: "acme", mode: "agent", until: "turn", watchRunId: "run_1", afterTurn });
    let returned = false;
    void done.then(() => (returned = true));

    viewOnTurnEnd()(turn("run_0"), { note: (text) => void notes.push(text), atLoad: true });
    viewOnTurnEnd()(turn("run_1"), { note: (text) => void notes.push(text), atLoad: false });
    await tick();
    expect(returned, "it waits for the turn's outputs").toBe(false);
    release();
    await done;
    expect(notes).toEqual(["Downloaded variance-report.md (4.2 KB)"]);
    expect(afterTurn.mock.calls.map(([seen, atLoad]) => [seen.runId, atLoad])).toEqual([
      ["run_0", true],
      ["run_1", false],
    ]);
    expect(rendered.unmounted).toBe(1);
  });

  it("stays a conversation by default, and waits for a turn's action after the person leaves, writing to stderr", async () => {
    rendered.stayUp = true;
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    let release = (): void => undefined;
    const saving = new Promise<void>((resolve) => (release = resolve));
    const afterTurn = async (_turn: Turn, _atLoad: boolean, say: (line: string) => void): Promise<void> => {
      await saving;
      say("  Downloaded q3.md (1 KB)");
    };
    const done = runInkSession({ client: {} as Stigmer, sessionId: "ses_1", org: "acme", mode: "agent", watchRunId: "run_1", afterTurn });
    viewOnTurnEnd()(turn("run_1"), { note: () => undefined, atLoad: false });
    await tick();
    expect(rendered.unmounted, "the turn's end does not leave").toBe(0);
    process.emit("SIGINT");
    release();
    await done;
    expect(stderr).toHaveBeenCalledWith("  Downloaded q3.md (1 KB)\n");
  });

  it("says when a turn's outputs could not be saved", async () => {
    rendered.stayUp = true;
    const notes: string[] = [];
    const done = runInkSession({
      client: {} as Stigmer,
      sessionId: "ses_1",
      org: "acme",
      mode: "agent",
      until: "turn",
      watchRunId: "run_1",
      afterTurn: async () => {
        throw new Error("disk full");
      },
    });
    viewOnTurnEnd()(turn("run_1"), { note: (text) => void notes.push(text), atLoad: false });
    await done;
    expect(notes).toEqual(["Could not save this turn's outputs: disk full"]);
  });
});
