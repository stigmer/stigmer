// Proves help is grouped and every command a person runs shows an example
// (../commands/help.ts): every visible top-level command sits in one of the
// six groups, which `stigmer --help` lists in their order with Commander's own
// `help` last; every runnable command declares at least one example, printed
// under "Examples:", and no example names a command that does not run; every
// example parses through the real program (each action replaced, so nothing
// runs), so an example that stops parsing, or passes an argument the command
// no longer takes, fails here; and every description starts lowercase with no
// closing period.
import { describe, expect, it } from "vitest";
import type { Command } from "commander";
import {
  commandPath,
  documentedCommands,
  everyCommand,
  helpExamples,
  helpGroupOf,
  runnableCommands,
  visibleSubcommands,
} from "../command-tree.js";
import { COMMAND_GROUPS, HELP_EXAMPLES, HELP_GROUPS, ROOT_EXAMPLES } from "../commands/help.js";
import { buildProgram } from "../program.js";

/** A shell line's words, quotes taken off, cut at the first redirect, pipe or chain. */
function words(line: string): string[] {
  const out: string[] = [];
  const pattern = /"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+)/g;
  for (const match of line.matchAll(pattern)) {
    const bare = match[3];
    if (bare !== undefined && /^(>|>>|\||&&|;)$/.test(bare)) break;
    out.push(match[1] ?? match[2] ?? bare ?? "");
  }
  return out;
}

/** The program with every action replaced by one that does nothing. */
function inertProgram(): Command {
  const program = buildProgram();
  for (const cmd of everyCommand(program)) cmd.action(() => undefined);
  return program;
}

/** What `cmd --help` prints, examples included. */
function helpOf(cmd: Command): string {
  let text = "";
  cmd.configureOutput({ writeOut: (chunk) => void (text += chunk) });
  cmd.configureHelp({ ...cmd.configureHelp(), helpWidth: 80 });
  cmd.outputHelp();
  return text;
}

// Each test builds the program and walks it itself, rather than once at
// import, so a broken walker fails the test that reads it (and a mutation
// sweep can tell which test that is).

describe("CLI-10 help groups commands and gives an example for each", () => {
  it("puts every visible top-level command in one of the six groups", () => {
    const program = buildProgram();
    const ungrouped = documentedCommands(program)
      .filter((cmd) => !(HELP_GROUPS as readonly string[]).includes(helpGroupOf(cmd)))
      .map(commandPath);
    expect(ungrouped).toEqual([]);
    const stale = Object.keys(COMMAND_GROUPS).filter((name) => !documentedCommands(program).some((cmd) => cmd.name() === name));
    expect(stale, "a group for a command that no longer exists").toEqual([]);
  });

  it("lists the groups in their order, run and resume first and Commander's help last", () => {
    const help = helpOf(buildProgram());
    const headings = help.split("\n").filter((line) => /^[A-Z][a-z ]+:$/.test(line));
    expect(headings).toEqual(["Options:", ...HELP_GROUPS.map((group) => `${group}:`), "Examples:"]);
    const runAgents = help.slice(help.indexOf("Run agents:"), help.indexOf("Your library:"));
    expect(runAgents).toMatch(/^ {2}run {2,}run an agent/m);
    expect(runAgents).toMatch(/^ {2}resume {2,}/m);
    expect(help.slice(help.indexOf("Configuration:"))).toMatch(/^ {2}help {2,}display help for command\n\nExamples:/m);
  });

  it("gives every runnable command at least one example, and no example names a command that does not run", () => {
    const runnable = runnableCommands(buildProgram());
    expect(runnable.length).toBeGreaterThanOrEqual(80);
    const without = runnable.filter((cmd) => helpExamples(cmd).length === 0).map(commandPath);
    expect(without).toEqual([]);
    const paths = new Set(runnable.map(commandPath));
    expect([...HELP_EXAMPLES.keys()].filter((path) => !paths.has(path))).toEqual([]);
  });

  it("prints a command's examples under Examples:, each line with what it does beneath it", () => {
    const get = buildProgram().commands.find((cmd) => cmd.name() === "get")!;
    const help = helpOf(get);
    expect(help).toContain("\nExamples:\n  stigmer get agent my-agent\n      get an agent by slug\n");
  });

  it("starts every example with the command it belongs to", () => {
    const misplaced = [...HELP_EXAMPLES].flatMap(([path, list]) =>
      list.filter((example) => example.run !== path && !example.run.startsWith(`${path} `)).map((example) => `${path}: ${example.run}`),
    );
    expect(misplaced).toEqual([]);
    for (const example of ROOT_EXAMPLES) expect(example.run.startsWith("stigmer ")).toBe(true);
  });

  it("parses every example through the program, arguments and options included", async () => {
    const all = [...ROOT_EXAMPLES, ...runnableCommands(buildProgram()).flatMap((cmd) => helpExamples(cmd))];
    const refused: string[] = [];
    for (const example of all) {
      const [bin, ...args] = words(example.run);
      expect(bin).toBe("stigmer");
      try {
        await inertProgram().parseAsync(args, { from: "user" });
      } catch (error) {
        refused.push(`${example.run}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    expect(refused).toEqual([]);
  });

  it("reads a shell line's words as the shell does, up to a redirect", () => {
    expect(words(`stigmer run a -m "Review this quarter's ledger." --until turn`)).toEqual(["stigmer", "run", "a", "-m", "Review this quarter's ledger.", "--until", "turn"]);
    expect(words("stigmer mcp add acme https://x --header 'Authorization=Bearer ${T}'")).toEqual(["stigmer", "mcp", "add", "acme", "https://x", "--header", "Authorization=Bearer ${T}"]);
    expect(words("stigmer access-history export > access-history.jsonl")).toEqual(["stigmer", "access-history", "export"]);
  });

  it("starts every description lowercase, with no closing period", () => {
    const all: Command[] = [];
    const visit = (cmd: Command): void => {
      for (const sub of visibleSubcommands(cmd)) {
        all.push(sub);
        visit(sub);
      }
    };
    visit(buildProgram());
    const off = all.filter((cmd) => !/^[a-z`]/.test(cmd.description()) || /\.\s*$/.test(cmd.description())).map(commandPath);
    expect(off).toEqual([]);
  });
});
