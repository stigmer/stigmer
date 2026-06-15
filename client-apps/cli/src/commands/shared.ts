// Shared commander wiring for output flags. Keeps the unified output model
// (src/output/format.ts) consistent across every command and out of the
// individual handlers.

import type { Command } from "commander";
import { type CommandClass, type OutputFlags, type OutputFormat, resolveFormat } from "../output/index.js";

/** Add read-verb output flags: `-o/--output {table,json,yaml}` plus `--json`. */
export function addReadFlags(command: Command): Command {
  return command
    .option("-o, --output <format>", "output format: table, json, or yaml")
    .option("--json", "shorthand for --output json");
}

/** Add mutating-command output flags: `--json` and `--quiet`. */
export function addResultFlags(command: Command): Command {
  return command
    .option("--json", "emit the result as JSON")
    .option("--quiet", "print only the status line");
}

/** Resolve the output format for a read verb from parsed options. */
export function readFormat(options: OutputFlags): OutputFormat {
  return resolveFormat(options, "read");
}

/** Resolve the output format for a mutating command from parsed options. */
export function resultFormat(options: OutputFlags): OutputFormat {
  return resolveFormat(options, "mutating");
}

/** Resolve any command class's format (escape hatch for non-standard verbs). */
export function formatFor(options: OutputFlags, commandClass: CommandClass): OutputFormat {
  return resolveFormat(options, commandClass);
}

/** Read the inherited global `--org` flag from within a subcommand action. */
export function globalOrg(command: Command): string | undefined {
  const value = command.optsWithGlobals().org;
  return typeof value === "string" && value !== "" ? value : undefined;
}
