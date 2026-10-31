// Pins how `stigmer run` and `stigmer resume` hand the session to the
// terminal kit (ink.tsx): the view gets the CLI's composer (its commands, `@`
// over the session's folders, a history per directory) and the words for
// coming back, and Ink neither exits on Ctrl+C (the view's key) nor goes
// without the kitty keyboard where the terminal offers it. Ink's `render` is
// replaced, so nothing draws.
import type React from "react";
import { describe, expect, it, vi } from "vitest";
import type { Stigmer } from "@stigmer/client";

const rendered = vi.hoisted(() => ({ element: undefined as unknown, options: undefined as unknown }));

vi.mock("ink", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ink")>();
  return {
    ...actual,
    render: (element: unknown, options: unknown) => {
      rendered.element = element;
      rendered.options = options;
      return { waitUntilExit: async () => {}, unmount: () => {} };
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
