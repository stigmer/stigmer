// The single exit point for command-level errors: classify, print to stderr,
// and exit with the mapped code. Mirrors the Go CLI's clierr.Handle.

import { isDebug } from "../runtime.js";
import { type CliError, classify, codeName } from "./classify.js";
import { ExitCode } from "./exit-codes.js";

/**
 * Render a CliError for stderr. In debug mode it appends the raw error chain
 * and numeric gRPC code. Returns "" when there is nothing to print (a clean
 * local cancellation), so the caller writes nothing.
 */
export function formatError(error: CliError, debugMode: boolean): string {
  const lines: string[] = [];

  if (error.message !== "") {
    lines.push(`Error: ${error.message}`);
  }

  if (error.hints !== undefined && error.hints.length > 0) {
    lines.push("");
    lines.push(...error.hints);
  }

  if (debugMode && error.cause !== undefined) {
    lines.push("");
    lines.push("--- debug ---");
    if (error.code !== undefined) {
      lines.push(`gRPC code: ${codeName(error.code)} (${error.code})`);
    }
    lines.push(`Raw error: ${error.cause.stack ?? error.cause.message}`);
  }

  return lines.length > 0 ? lines.join("\n") + "\n" : "";
}

/**
 * Classify the error, print a user-facing message to stderr, and exit with the
 * appropriate code. The debug flag is read from process-global runtime state
 * (set from `--debug`), so callers never thread it through.
 */
export function handle(error: unknown): never {
  const classified = classify(error);
  if (classified === null) {
    process.exit(ExitCode.Success);
  }

  const rendered = formatError(classified, isDebug());
  if (rendered !== "") {
    process.stderr.write(rendered);
  }
  process.exit(classified.exitCode);
}
