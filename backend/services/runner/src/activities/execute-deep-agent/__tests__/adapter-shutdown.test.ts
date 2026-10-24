/**
 * The native adapter's one reach across turns (`adapter.ts`): a host that
 * stops while a turn runs stops that turn's background commands. Each
 * `runTurn` hands its engine turn a registry of its own, and `shutdown`
 * stops every registry still live; a turn that has returned leaves none.
 * The engine turn is doubled, so this proves the adapter's wiring alone;
 * the engine's own stop at the invocation's end is the hermetic arms'
 * (`hermetic/background-shell.test.ts`).
 */

import { describe, expect, it, vi } from "vitest";

import type { Config } from "../../../config.js";
import { createDeepAgentAdapter } from "../adapter.js";
import type { BackgroundCommands } from "../../../shared/shell/background-commands.js";
import type { CommandResult } from "../../../shared/shell/run-command.js";

const { turns } = vi.hoisted(() => ({ turns: [] as Array<{ readonly commands: BackgroundCommands; readonly release: () => void }> }));
vi.mock("../deepagents-profiles.js", () => ({ registerStigmerDeepagentsProfiles: vi.fn() }));
vi.mock("../turn.js", () => ({
  runDeepAgentTurn: (_input: unknown, _sink: unknown, _config: unknown, commands: BackgroundCommands) =>
    new Promise((resolve) => {
      commands.start({
        id: "bg_1",
        command: "npm run dev",
        timeoutSeconds: 60,
        outputPath: undefined,
        run: ({ signal }) =>
          new Promise<CommandResult>((done) =>
            signal.addEventListener("abort", () => done({ stdout: "", stderr: "", exitCode: null, timedOut: false, aborted: true, truncated: false }), { once: true }),
          ),
      });
      turns.push({ commands, release: () => resolve({ kind: "completed" }) });
    }),
}));

describe("the native adapter's shutdown", () => {
  it("stops the background commands of the turns still running, and of none that returned", async () => {
    const adapter = createDeepAgentAdapter();
    await adapter.boot({} as Config);

    const first = adapter.runTurn({} as never, {} as never);
    const second = adapter.runTurn({} as never, {} as never);
    await vi.waitFor(() => expect(turns).toHaveLength(2));
    turns[0]!.release();
    await first;

    await adapter.shutdown();
    expect(turns[1]!.commands.get("bg_1")?.result?.aborted, "the running turn's command was stopped").toBe(true);
    expect(turns[0]!.commands.get("bg_1")?.result, "a returned turn's registry is no longer the adapter's").toBeUndefined();
    turns[1]!.release();
    await second;
    await turns[0]!.commands.stopAll();
  });
});
