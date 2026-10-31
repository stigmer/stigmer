// Pins the command-tree walker (command-tree.ts) on a small commander tree:
// a hidden command and commander's own `help` are never seen, a group is not
// a leaf but its subcommands are, at any depth, sorted by path; a command's
// path reads as typed; its positional arguments come back with their shape;
// and an option counts only on the command that declares it, never through
// its parent. A runnable command is a leaf or a group with an action of its
// own, never a group that only dispatches, sorted by path whatever order the
// tree registered them in; and a help group reads without its heading's
// closing colon, a colon inside the heading kept.
import { Command } from "commander";
import { describe, expect, it } from "vitest";
import {
  commandPath,
  documentedCommands,
  hasOwnAction,
  helpGroupOf,
  isHidden,
  leafCommands,
  registeredArguments,
  runnableCommands,
  takesOption,
  visibleSubcommands,
} from "../command-tree.js";

function tree(): Command {
  const program = new Command("stigmer").option("--org <slug>", "organization");
  program.command("version");
  program.command("internal-daemon", { hidden: true });
  const config = program.command("config");
  config.command("set <key> <value>").option("--json", "json");
  const backend = config.command("backend");
  backend.command("use <name>").option("-o, --output <format>", "format");
  backend.command("add [names...]");
  backend.command("secret", { hidden: true });
  // A help command a tree registers itself, as `.addHelpCommand(cmd)` does:
  // it sits in `.commands`, where commander's implicit one never does.
  backend.addCommand(new Command("help"));
  program.command("apply").option("--quiet", "quiet");
  program.addCommand(new Command("help"));
  return program;
}

describe("the command tree", () => {
  it("sees neither a hidden command nor commander's help, at the root or below it", () => {
    const program = tree();
    expect(program.commands.map((c) => c.name())).toContain("help");
    expect(documentedCommands(program).map((c) => c.name())).toEqual(["version", "config", "apply"]);
    const backend = program.commands.find((c) => c.name() === "config")!.commands.find((c) => c.name() === "backend")!;
    expect(backend.commands.map((c) => c.name())).toContain("help");
    expect(visibleSubcommands(backend).map((c) => c.name())).toEqual(["add", "use"]);
    expect(isHidden(program.commands.find((c) => c.name() === "internal-daemon")!)).toBe(true);
    expect(isHidden(backend)).toBe(false);
  });

  it("lists every leaf, depth first, sorted by its path, and no group", () => {
    expect(leafCommands(tree()).map(commandPath)).toEqual([
      "stigmer apply",
      "stigmer config backend add",
      "stigmer config backend use",
      "stigmer config set",
      "stigmer version",
    ]);
  });

  it("reads a command's positional arguments with their shape", () => {
    const leaves = leafCommands(tree());
    const shape = (path: string) =>
      registeredArguments(leaves.find((c) => commandPath(c) === path)!).map((a) => [a.name(), a.required, a.variadic]);
    expect(shape("stigmer config set")).toEqual([["key", true, false], ["value", true, false]]);
    expect(shape("stigmer config backend add")).toEqual([["names", false, true]]);
    expect(shape("stigmer version")).toEqual([]);
  });

  it("reads the arguments of a commander that still keeps them as _args", () => {
    const legacy = { _args: [{ name: () => "ref", required: true, variadic: false }] } as unknown as Command;
    expect(registeredArguments(legacy).map((a) => a.name())).toEqual(["ref"]);
    expect(registeredArguments({} as unknown as Command)).toEqual([]);
  });

  it("counts an option on the command that declares it, never through its parent", () => {
    const leaves = new Map(leafCommands(tree()).map((c) => [commandPath(c), c]));
    expect(takesOption(leaves.get("stigmer config backend use")!, "--output")).toBe(true);
    expect(takesOption(leaves.get("stigmer config set")!, "--json")).toBe(true);
    expect(takesOption(leaves.get("stigmer config set")!, "--output")).toBe(false);
    expect(takesOption(leaves.get("stigmer apply")!, "--org")).toBe(false);
  });

  it("tells a command with an action of its own from one that only dispatches", () => {
    expect(hasOwnAction(new Command("up").action(() => undefined))).toBe(true);
    // commander keeps a null handler until .action() is called...
    expect(hasOwnAction(new Command("config"))).toBe(false);
    // ...and a command shaped by an older commander may carry none at all.
    expect(hasOwnAction({} as unknown as Command)).toBe(false);
  });

  it("runs each leaf and each group with an action, never a group that only dispatches, sorted by path", () => {
    const program = new Command("stigmer");
    // Registered out of path order, so only the sort puts them in it.
    program.command("zeta");
    const up = program.command("up").action(() => undefined);
    up.command("server");
    const config = program.command("config");
    config.command("set <key> <value>");
    program.command("internal-daemon", { hidden: true }).action(() => undefined);
    program.command("alpha");
    expect(runnableCommands(program).map(commandPath)).toEqual([
      "stigmer alpha",
      "stigmer config set",
      "stigmer up",
      "stigmer up server",
      "stigmer zeta",
    ]);
  });

  it("reads a help group without its heading's closing colon, and none when a command names none", () => {
    expect(helpGroupOf(new Command("run").helpGroup("Run agents:"))).toBe("Run agents");
    expect(helpGroupOf(new Command("run").helpGroup("Step 1: setup:"))).toBe("Step 1: setup");
    expect(helpGroupOf(new Command("run").helpGroup("Configuration"))).toBe("Configuration");
    expect(helpGroupOf(new Command("run"))).toBe("");
  });
});
