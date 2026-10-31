// Proves the global options read alike before and after the command
// (../global-options.ts): `--org`, `-d/--debug` and `--standalone` reach the
// command that runs from either place, the command's own copy winning; every
// runnable command takes them, hidden from its own options; a command that
// declares the name keeps its meaning; and `--api-key` is read before the
// command only, so `setup --api-key` stays the provider key.
import { afterEach, describe, expect, it } from "vitest";
import type { Command } from "commander";
import { commandPath, runnableCommands, takesOption } from "../command-tree.js";
import { globalOrg } from "../commands/shared.js";
import { buildProgram } from "../program.js";
import { isDebug, isStandalone, setDebug, setStandalone } from "../runtime.js";

const savedKey = process.env.STIGMER_API_KEY;

afterEach(() => {
  setDebug(false);
  setStandalone(false);
  if (savedKey === undefined) delete process.env.STIGMER_API_KEY;
  else process.env.STIGMER_API_KEY = savedKey;
});

/** The command at `path` under a fresh program, its action replaced by one that records what it saw. */
function stubbed(path: readonly string[]): { program: Command; seen: () => { org: string | undefined; debug: boolean; standalone: boolean } } {
  const program = buildProgram();
  let cmd: Command = program;
  for (const name of path) cmd = cmd.commands.find((sub) => sub.name() === name)!;
  let seen = { org: undefined as string | undefined, debug: false, standalone: false };
  cmd.action((...args: unknown[]) => {
    const self = args.at(-1) as Command;
    seen = { org: globalOrg(self), debug: isDebug(), standalone: isStandalone() };
  });
  return { program, seen: () => seen };
}

describe("CLI-16 global options work before or after the command", () => {
  it.each([
    ["before", ["--org", "acme", "-d", "--standalone", "get", "agent", "reviewer"]],
    ["after", ["get", "agent", "reviewer", "--org", "acme", "-d", "--standalone"]],
    ["split", ["--org", "acme", "get", "agent", "reviewer", "--debug", "--standalone"]],
  ])("reads --org, --debug and --standalone written %s the command", async (_where, argv) => {
    const { program, seen } = stubbed(["get"]);
    await program.parseAsync(argv, { from: "user" });
    expect(seen()).toEqual({ org: "acme", debug: true, standalone: true });
  });

  it("lets the value after the command win over the one before it", async () => {
    const { program, seen } = stubbed(["run"]);
    await program.parseAsync(["--org", "first", "run", "reviewer", "--org", "second"], { from: "user" });
    expect(seen().org).toBe("second");
  });

  it("reaches a nested command and a group that runs", async () => {
    const nested = stubbed(["config", "backend", "status"]);
    await nested.program.parseAsync(["config", "backend", "status", "--org", "acme"], { from: "user" });
    expect(nested.seen().org).toBe("acme");
    const group = stubbed(["up"]);
    await group.program.parseAsync(["up", "--debug"], { from: "user" });
    expect(group.seen().debug).toBe(true);
  });

  it("gives every runnable command the trailing globals, hidden, unless it declares the name itself", () => {
    const program = buildProgram();
    const runnable = runnableCommands(program);
    expect(runnable.length).toBeGreaterThanOrEqual(80);
    const missing = runnable
      .filter((cmd) => !["--org", "--debug", "--standalone"].every((long) => takesOption(cmd, long)))
      .map(commandPath);
    expect(missing).toEqual([]);
    const shown = runnable.filter((cmd) => cmd.options.some((option) => option.long === "--debug" && !option.hidden)).map(commandPath);
    expect(shown).toEqual([]);
  });

  it("keeps config context set's own --org, the organization it saves", () => {
    const set = buildProgram()
      .commands.find((cmd) => cmd.name() === "config")!
      .commands.find((cmd) => cmd.name() === "context")!
      .commands.find((cmd) => cmd.name() === "set")!;
    const orgs = set.options.filter((option) => option.long === "--org");
    expect(orgs).toHaveLength(1);
    expect(orgs[0]!.hidden).toBe(false);
  });

  it("reads --api-key before the command only, so setup's own --api-key stays the provider key", async () => {
    delete process.env.STIGMER_API_KEY;
    const setup = stubbed(["setup"]);
    await setup.program.parseAsync(["setup", "--api-key", "provider-key"], { from: "user" });
    expect(process.env.STIGMER_API_KEY).toBeUndefined();

    const before = stubbed(["get"]);
    await before.program.parseAsync(["--api-key", "stigmer-key", "get", "agent", "reviewer"], { from: "user" });
    expect(process.env.STIGMER_API_KEY).toBe("stigmer-key");

    const after = stubbed(["get"]);
    await expect(after.program.parseAsync(["get", "agent", "reviewer", "--api-key", "x"], { from: "user" })).rejects.toMatchObject({
      code: "commander.unknownOption",
      exitCode: 2,
    });
  });

  it("shows the globals once on a command's help, in their own section", () => {
    const get = buildProgram().commands.find((cmd) => cmd.name() === "get")!;
    const help = get.helpInformation();
    expect(help).toContain("Global Options:");
    expect(help.match(/--org <slug>/g)).toHaveLength(1);
  });
});
