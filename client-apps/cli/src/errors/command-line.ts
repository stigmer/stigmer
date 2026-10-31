// Commander's own refusals (an unknown option, a missing or extra argument,
// a group run without its subcommand) worded and exited like every other
// usage error: `Error: ...` on stderr, the command's help named on the next
// line, exit 2, through the one exit point (handle.ts).
//
// Commander reports through `_exit`, which calls a command's exit callback
// with no command attached, so each command gets a callback of its own, a
// closure over it, and the hint names the command the error happened on.
// Commander's own error output is silenced, so the error prints once.
//
// An unknown option is named without what follows it (a value written after
// '=', or a short option's attached value), and extra arguments are counted,
// never listed (a newer Commander lists them): a key pasted onto the wrong
// option, or after the arguments, does not reach a terminal's log. An unknown
// command and a value an option's own parser refuses are still echoed, as
// Commander words them.
//
// A usage error exits 2, except on a command that declares its own code for
// one (`usageExitCode`): `eval run` keeps the plugin-eval table, where 2 is a
// partial run and an invalid option is 1.
//
// Help and version (exit code 0) leave quietly with 0; a group run without
// its subcommand has printed its help to stderr and exits 2.

import type { Command, CommanderError } from "commander";
import { ExitCode } from "@stigmer/client/exit-codes";
import { commandPath, everyCommand, registeredArguments } from "../command-tree.js";
import { CliExitError } from "./cli-exit-error.js";

/** A refusal of the command line itself, carrying Commander's code (`commander.unknownOption`). */
export class CommandLineError extends CliExitError {
  readonly code: string;

  constructor(message: string, exitCode: number, code: string, hints?: readonly string[]) {
    super(message, exitCode, hints);
    this.name = "CommandLineError";
    this.code = code;
  }
}

const USAGE_EXIT = new WeakMap<Command, number>();

/** Declare the code a usage error on `cmd` exits with, in place of 2 (module header). */
export function usageExitCode(cmd: Command, code: number): Command {
  USAGE_EXIT.set(cmd, code);
  return cmd;
}

/** Give every command in the tree its own exit callback and silence Commander's error output. */
export function installCommandLineErrors(program: Command): void {
  for (const cmd of everyCommand(program)) {
    cmd.exitOverride((error) => {
      throw commandLineErrorOf(cmd, error);
    });
    cmd.configureOutput({ outputError: () => undefined });
  }
}

/** The CLI's error for a Commander refusal on `cmd` (module header). */
export function commandLineErrorOf(cmd: Command, error: CommanderError): CommandLineError {
  if (error.exitCode === 0) return new CommandLineError("", ExitCode.Success, error.code);
  // A group run without its subcommand: its help is already on stderr.
  const exitCode = USAGE_EXIT.get(cmd) ?? ExitCode.Usage;
  if (error.code === "commander.help") return new CommandLineError("", exitCode, error.code);
  const hint = `Run \`${commandPath(cmd)} --help\` for usage.`;
  return new CommandLineError(wording(cmd, error), exitCode, error.code, [hint]);
}

function wording(cmd: Command, error: CommanderError): string {
  if (error.code === "commander.excessArguments") return excessArguments(cmd, error.message);
  const message = error.message.replace(/^error: /, "");
  if (error.code === "commander.unknownOption") return unknownOption(message);
  return message
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .join(" ");
}

// Commander echoes an unknown option as typed, so `--name=VALUE` would print
// the value, newlines and all; the answer names the option alone, with
// Commander's suggestion when its last line is one (an option's name only).
function unknownOption(message: string): string {
  const name = /^unknown option '(--[A-Za-z0-9-]+|-[A-Za-z0-9])/.exec(message)?.[1];
  if (name === undefined) return "unknown option";
  const suggestion = /\n(\(Did you mean --?[A-Za-z0-9-]+\?\))$/.exec(message)?.[1];
  return suggestion === undefined ? `unknown option '${name}'` : `unknown option '${name}' ${suggestion}`;
}

function excessArguments(cmd: Command, message: string): string {
  const expected = registeredArguments(cmd).length;
  const got = /got (\d+)/.exec(message)?.[1];
  const takes = expected === 0 ? "takes no arguments" : `takes ${expected} argument${expected === 1 ? "" : "s"}`;
  return got === undefined ? `${commandPath(cmd)} ${takes}` : `${commandPath(cmd)} ${takes}, got ${got}`;
}
