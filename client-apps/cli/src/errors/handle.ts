// The single exit point for command-level errors: classify, print to stderr,
// and exit with the mapped code.
//
// A failure the server answered (a refusal, a not-found, a denied call) ends
// with the server's help line when its operator set one: "Stuck? <words>:
// <address>". It is asked of the server once, bounded, and only then: a
// server that could not be reached, a request that timed out and a refusal
// the CLI made itself ask nothing, so a failure never waits on a server
// that is down.

import { Code } from "@connectrpc/connect";
import { isDebug, serverHelpProbe } from "../runtime.js";
import { type CliError, classify, codeName, isTransportFailure } from "./classify.js";
import { ExitCode } from "@stigmer/client/exit-codes";
import { printableCell } from "../output/printable.js";

/** How long a failure waits for the server's help link before printing without it. */
export const HELP_PROBE_TIMEOUT_MS = 1_000;

/** Where the server says to ask for help, as the failure's last line prints it. */
export interface ServerHelp {
  readonly url: string;
  readonly label: string;
}

/**
 * Render a CliError for stderr. A server's help link, when given, is the
 * last line before the debug block. In debug mode it appends the raw error
 * chain and numeric gRPC code. Returns "" when there is nothing to print (a
 * clean local cancellation), so the caller writes nothing.
 */
export function formatError(error: CliError, debugMode: boolean, help?: ServerHelp): string {
  const lines: string[] = [];

  if (error.message !== "") {
    lines.push(`Error: ${error.message}`);
  }

  if (error.hints !== undefined && error.hints.length > 0) {
    lines.push("");
    lines.push(...error.hints);
  }

  if (help !== undefined && error.message !== "") {
    lines.push("");
    lines.push(helpLine(help));
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
 * The help line as a terminal prints it: the server's words and address on
 * one line, with no control or escape sequence (the server's text reaches
 * the terminal only through output/printable.ts).
 */
export function helpLine(help: ServerHelp): string {
  return `Stuck? ${printableCell(help.label)}: ${printableCell(help.url)}`;
}

/**
 * Whether a classified failure is a server's answer: it carries an RPC
 * status, and it is neither a request that never reached a server nor one
 * that ran out of time (where asking the server again would wait again).
 */
export function isServerAnswer(error: CliError): boolean {
  if (error.code === undefined || error.code === Code.DeadlineExceeded) return false;
  if (error.code === Code.Unavailable && isTransportFailure(error.cause?.message ?? "", error.cause)) return false;
  return true;
}

/**
 * The dialled server's help link for a failure it answered, or undefined:
 * when the failure is not the server's, when no client was made, when the
 * server set none, when asking fails, and when the answer takes longer
 * than {@link HELP_PROBE_TIMEOUT_MS}.
 */
export async function serverHelpFor(error: CliError, timeoutMs = HELP_PROBE_TIMEOUT_MS): Promise<ServerHelp | undefined> {
  const probe = serverHelpProbe();
  if (probe === undefined || !isServerAnswer(error)) return undefined;
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), timeoutMs);
    timer.unref();
  });
  try {
    return await Promise.race([probe().catch(() => undefined), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Classify the error, print a user-facing message to stderr, and exit with the
 * appropriate code. The debug flag is read from process-global runtime state
 * (set from `--debug`), so callers never thread it through.
 */
export async function handle(error: unknown): Promise<never> {
  const classified = classify(error);
  if (classified === null) {
    process.exit(ExitCode.Success);
  }

  const help = await serverHelpFor(classified);
  const rendered = formatError(classified, isDebug(), help);
  if (rendered !== "") {
    process.stderr.write(rendered);
  }
  process.exit(classified.exitCode);
}
