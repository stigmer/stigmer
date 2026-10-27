// A sweep over every command the CLI builds (buildProgram, walked by
// command-tree.ts), holding the rules no single command's test can: a rule
// written once in the output layer (output/format.ts) that each command must
// opt into by declaring its flags.
//
// `--json` and `--quiet` are the back-compat aliases of `-o/--output`, so a
// command that takes either prints machine-readable output and must take
// `-o` too. Today most such commands take only the aliases (stigmer#2620);
// they are listed in WITHOUT_OUTPUT_FLAG, and the list only shrinks: a new
// command with `--json` and no `-o` fails, and so does a listed command that
// has gained `-o`, so the fix that adds the flag also drops the line.
import { describe, expect, it } from "vitest";
import type { Command } from "commander";
import { commandPath, leafCommands, takesOption } from "../command-tree.js";
import { buildProgram } from "../program.js";

/** Commands that print machine output through `--json`/`--quiet` and do not take `-o/--output` yet (stigmer#2620). */
const WITHOUT_OUTPUT_FLAG = new Set([
  "stigmer apply",
  "stigmer auth logout",
  "stigmer auth whoami",
  "stigmer channel disable",
  "stigmer channel enable",
  "stigmer channel link",
  "stigmer config backend add",
  "stigmer config backend list",
  "stigmer config backend remove",
  "stigmer config backend set",
  "stigmer config backend status",
  "stigmer config backend use",
  "stigmer config context set",
  "stigmer config context show",
  "stigmer config set",
  "stigmer delete",
  "stigmer down server",
  "stigmer download",
  "stigmer eval run",
  "stigmer file upload",
  "stigmer install",
  "stigmer marketplace add",
  "stigmer marketplace list",
  "stigmer marketplace remove",
  "stigmer marketplace show",
  "stigmer mcp add",
  "stigmer push",
  "stigmer reset",
  "stigmer resume",
  "stigmer routine fire",
  "stigmer routine resume",
  "stigmer run",
  "stigmer service-account create",
  "stigmer service-account delete",
  "stigmer setup",
  "stigmer status",
  "stigmer up server",
  "stigmer validate",
  "stigmer vault connect-link",
  "stigmer vault create",
  "stigmer vault mine",
  "stigmer vault remove-connection",
  "stigmer vault remove-secret",
  "stigmer vault set-connection",
  "stigmer vault set-secret",
]);

const leaves = leafCommands(buildProgram());
const paths = leaves.map(commandPath);

function printsMachineOutput(cmd: Command): boolean {
  return takesOption(cmd, "--json") || takesOption(cmd, "--quiet");
}

describe("CLI-02 every command that prints machine output accepts -o", () => {
  it("walks every command a person runs", () => {
    // A walker that lost the tree would pass every rule below vacuously.
    expect(leaves.length).toBeGreaterThanOrEqual(70);
    expect(paths).toContain("stigmer get");
    expect(paths).toContain("stigmer config backend use");
    expect(paths).not.toContain("stigmer internal-daemon");
  });

  it("takes -o/--output on every command that takes --json or --quiet, outside the known list", () => {
    const missing = leaves
      .filter((cmd) => printsMachineOutput(cmd) && !takesOption(cmd, "--output"))
      .map(commandPath)
      .filter((path) => !WITHOUT_OUTPUT_FLAG.has(path));
    expect(missing, "add `-o, --output <format>` (output/format.ts resolves it with the aliases)").toEqual([]);
  });

  it("binds -o to --output wherever a command takes --output", () => {
    const unbound = leaves
      .filter((cmd) => takesOption(cmd, "--output"))
      .filter((cmd) => cmd.options.find((option) => option.long === "--output")?.short !== "-o")
      .map(commandPath);
    expect(unbound).toEqual([]);
  });

  it("keeps the known list to commands that exist and still lack -o", () => {
    const byPath = new Map(leaves.map((cmd) => [commandPath(cmd), cmd]));
    const stale = [...WITHOUT_OUTPUT_FLAG].filter((path) => {
      const cmd = byPath.get(path);
      return cmd === undefined || !printsMachineOutput(cmd) || takesOption(cmd, "--output");
    });
    expect(stale, "a command that takes -o now, or no longer exists, leaves WITHOUT_OUTPUT_FLAG").toEqual([]);
  });
});
