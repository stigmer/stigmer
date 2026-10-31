// A sweep over every command the CLI builds (buildProgram, walked by
// command-tree.ts), holding the rules no single command's test can: a rule
// written once in the output layer (output/format.ts) that each command must
// opt into by declaring its flags.
//
// Every command a person runs takes `-o/--output`, groups that run included
// (`stigmer up`): one flag says "machine-readable" everywhere, and its class
// map (output/format.ts) refuses a value the command cannot print rather than
// Commander's "unknown option". The few commands that print no data a script
// reads are named in PRINTS_NO_DATA, each with its reason, and the list only
// shrinks: a listed command that has gained `-o`, or no longer exists, fails.
import type { Command } from "commander";
import { describe, expect, it } from "vitest";
import { commandPath, runnableCommands, takesOption } from "../command-tree.js";
import { buildProgram } from "../program.js";

/** Commands that print no data, so `-o` would have nothing to shape: path to the reason. */
const PRINTS_NO_DATA = new Map([
  ["stigmer completion", "prints a shell script for the shell to source"],
  ["stigmer logs", "prints the local stack's own log text, as its processes wrote it"],
  ["stigmer mcp-server", "serves the MCP protocol on stdio or a port; it prints no result"],
]);

/**
 * Every runnable command of a freshly built program. Each test walks it
 * itself, rather than once at import, so a broken walker fails the test that
 * reads it (and a mutation sweep can tell which test that is).
 */
function runnableNow(): Command[] {
  return runnableCommands(buildProgram());
}

describe("CLI-02 every command that prints machine output accepts -o", () => {
  it("walks every command a person runs, groups that run included", () => {
    // A walker that lost the tree would pass every rule below vacuously.
    const runnable = runnableNow();
    const paths = runnable.map(commandPath);
    expect(runnable.length).toBeGreaterThanOrEqual(80);
    expect(paths).toContain("stigmer get");
    expect(paths).toContain("stigmer config backend use");
    expect(paths).toContain("stigmer up");
    expect(paths).toContain("stigmer up server");
    expect(paths).not.toContain("stigmer config");
    expect(paths).not.toContain("stigmer internal-daemon");
  });

  it("takes -o/--output on every runnable command outside the named list", () => {
    const missing = runnableNow()
      .filter((cmd) => !takesOption(cmd, "--output"))
      .map(commandPath)
      .filter((path) => !PRINTS_NO_DATA.has(path));
    expect(missing, "add -o (commands/shared.ts: addResultFlags, addReadFlags, addValueFlags, addStreamFlags)").toEqual([]);
  });

  it("binds -o to --output wherever a command takes --output, and to nothing else", () => {
    const runnable = runnableNow();
    const unbound = runnable
      .filter((cmd) => takesOption(cmd, "--output"))
      .filter((cmd) => cmd.options.find((option) => option.long === "--output")?.short !== "-o")
      .map(commandPath);
    expect(unbound).toEqual([]);
    const otherwise = runnable
      .filter((cmd) => cmd.options.some((option) => option.short === "-o" && option.long !== "--output"))
      .map(commandPath);
    expect(otherwise, "-o is the output format on every command").toEqual([]);
  });

  it("keeps the named list to commands that exist and still take no -o", () => {
    const byPath = new Map(runnableNow().map((cmd) => [commandPath(cmd), cmd]));
    const stale = [...PRINTS_NO_DATA.keys()].filter((path) => {
      const cmd = byPath.get(path);
      return cmd === undefined || takesOption(cmd, "--output");
    });
    expect(stale, "a command that takes -o now, or no longer exists, leaves PRINTS_NO_DATA").toEqual([]);
  });
});
