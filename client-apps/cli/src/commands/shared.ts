// Shared commander wiring for output flags. Keeps the unified output model
// (src/output/format.ts) consistent across every command and out of the
// individual handlers.

import type { Command } from "commander";
import { UsageError } from "../errors/usage-error.js";
import { nearestOption } from "../global-options.js";
import { type CommandClass, type OutputFlags, type OutputFormat, resolveFormat } from "../output/index.js";

/** Add read-verb output flags: `-o/--output {table,json,yaml}` plus `--json`. */
export function addReadFlags(command: Command): Command {
  return command
    .option("-o, --output <format>", "output format: table, json, or yaml")
    .option("--json", "shorthand for --output json");
}

/** Add mutating-command output flags: `-o/--output {table,json}`, `--json` and `--quiet`. */
export function addResultFlags(command: Command): Command {
  return command
    .option("-o, --output <format>", "output format: table or json")
    .option("--json", "emit the result as JSON")
    .option("--quiet", "print only the status line");
}

/** Add output flags for a command whose answer is a bare value: `-o/--output {table,json}` and `--json`. */
export function addValueFlags(command: Command): Command {
  return command
    .option("-o, --output <format>", "output format: table (the bare value) or json")
    .option("--json", "shorthand for --output json");
}

/** Add streaming-command output flags: `-o/--output {table,json,ndjson}` and `--json`. */
export function addStreamFlags(command: Command, json = "stream events as newline-delimited JSON"): Command {
  return command
    .option("-o, --output <format>", "output format: table (the live view), json or ndjson (newline-delimited JSON events)")
    .option("--json", json);
}

/** Resolve the output format for a streaming command from parsed options. */
export function streamFormat(options: OutputFlags): OutputFormat {
  return resolveFormat(options, "streaming");
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

/** Read the global `--org` flag from within a subcommand action, written before or after the command. */
export function globalOrg(command: Command): string | undefined {
  const value = nearestOption(command, "org");
  return typeof value === "string" && value !== "" ? value : undefined;
}

/** `--until`'s value for `run` and `resume`: "exit" when absent; anything but turn or exit is refused. */
export function untilOf(raw: string | undefined): "turn" | "exit" {
  if (raw === undefined || raw === "exit") return "exit";
  if (raw === "turn") return "turn";
  throw new UsageError(`invalid --until value "${raw}" (expected turn or exit)`);
}
