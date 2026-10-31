// The global options a person may write before or after the command:
// `stigmer --org acme run reviewer` and `stigmer run reviewer --org acme`
// read alike, as gh and kubectl take theirs.
//
// The root keeps positional options (`enablePositionalOptions`), because they
// are what keeps `stigmer setup --api-key` (the Anthropic key) from being read
// as the global Stigmer key. So the root's options do not reach a command's
// own arguments; instead each runnable command gets hidden copies of the ones
// that may follow it, and every reader takes the nearest command's value
// (`nearestOption`): the one written after the command wins over the one
// before it. Commander's own `optsWithGlobals` lets the root win, so it is
// not used for these.
//
// - `--org`, `-d/--debug` and `--standalone` follow any command that does not
//   declare the name itself (`config context set --org` keeps its own
//   meaning).
// - `--api-key` stays before the command: two commands give the name another
//   meaning (`setup`, `mcp-server`), and a key belongs in the environment
//   (`STIGMER_API_KEY`), not in a shell's history.
//
// The copies are hidden, so help shows the globals once, in its "Global
// Options" section, and the docs generator leaves them out of each page. A
// command's line in its parent's list says "[options]" only for options it
// shows (`helpConfiguration`), since every runnable command now holds the
// hidden copies.

import { type Command, type HelpConfiguration, Option } from "commander";
import { registeredArguments, runnableCommands } from "./command-tree.js";

/** A global option that may also follow the command. */
interface TrailingGlobal {
  readonly flags: string;
  readonly long: string;
  readonly short?: string;
  readonly description: string;
}

/** The global options that may be written after the command too, as the root declares them. */
export const TRAILING_GLOBALS: readonly TrailingGlobal[] = [
  { flags: "-d, --debug", long: "--debug", short: "-d", description: "enable debug output" },
  { flags: "--standalone", long: "--standalone", description: "ignore the config file; use flags and environment only" },
  { flags: "--org <slug>", long: "--org", description: "organization, on servers that hold several" },
];

/** Declare the trailing globals on the root, in help's order. */
export function addGlobalOptions(program: Command): Command {
  for (const global of TRAILING_GLOBALS) program.option(global.flags, global.description);
  return program.option("--api-key <key>", "API key for authentication (before the command)");
}

/** Give every runnable command hidden copies of the trailing globals it does not declare itself. */
export function acceptGlobalsAfterCommand(program: Command): void {
  for (const cmd of runnableCommands(program)) {
    for (const global of TRAILING_GLOBALS) {
      if (cmd.options.some((option) => option.long === global.long)) continue;
      const shortTaken = global.short !== undefined && cmd.options.some((option) => option.short === global.short);
      const flags = shortTaken || global.short === undefined ? global.flags.replace(/^-\w, /, "") : global.flags;
      cmd.addOption(new Option(flags, global.description).hideHelp());
    }
  }
}

/** The global options as the command that runs sees them: its own trailing copy first, then the root's. */
export interface GlobalOptions {
  readonly debug: boolean;
  readonly standalone: boolean;
  /** The Stigmer API key, read from the root alone (module header). */
  readonly apiKey: string;
}

/** An option's value on `cmd` or, when unset there, on the nearest command above it that has one. */
export function nearestOption(cmd: Command, key: string): unknown {
  for (let current: Command | null = cmd; current !== null; current = current.parent) {
    const value: unknown = current.opts()[key];
    if (value !== undefined) return value;
  }
  return undefined;
}

/** Read the global options for the action command `action` under `root`. */
export function readGlobalOptions(root: Command, action: Command): GlobalOptions {
  const apiKey = root.opts().apiKey;
  return {
    debug: Boolean(nearestOption(action, "debug")),
    standalone: Boolean(nearestOption(action, "standalone")),
    apiKey: typeof apiKey === "string" ? apiKey : "",
  };
}

/**
 * The help every command shows: the globals once per page, and a command's
 * line in its parent's list naming "[options]" only when it has options of
 * its own to show (Commander's own check counts hidden ones).
 */
export const helpConfiguration: HelpConfiguration = {
  showGlobalOptions: true,
  subcommandTerm: (cmd) => {
    const args = registeredArguments(cmd).map((arg) => {
      const name = `${arg.name()}${arg.variadic ? "..." : ""}`;
      return arg.required ? `<${name}>` : `[${name}]`;
    });
    const alias = cmd.aliases()[0];
    const options = cmd.options.some((option) => !option.hidden) ? ["[options]"] : [];
    return [`${cmd.name()}${alias === undefined ? "" : `|${alias}`}`, ...options, ...args].join(" ");
  },
};
