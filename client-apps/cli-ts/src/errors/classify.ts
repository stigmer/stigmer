// Classifies any thrown value into a CliError: an exit code, a user-facing
// message, and optional remediation hints. Mirrors the Go CLI's
// clierr.Classify, including walking the error chain so wrapped RPC errors
// still map to the right exit code.

import { Code, ConnectError } from "@connectrpc/connect";
import { StigmerError } from "@stigmer/sdk";
import { CliExitError } from "./cli-exit-error.js";
import { ExitCode } from "./exit-codes.js";

/**
 * Structured result of classifying a raw error. `classify` produces these and
 * `handle` consumes them. `message === ""` signals a clean, silent outcome
 * (local cancellation) for which nothing should be printed.
 */
export interface CliError {
  readonly exitCode: number;
  readonly message: string;
  readonly hints?: readonly string[];
  readonly cause?: Error;
  /** Numeric Connect/gRPC code, present when the error originated from an RPC. */
  readonly code?: number;
}

// Guards against pathological/circular `cause` chains.
const MAX_CHAIN_DEPTH = 20;

export function classify(err: unknown): CliError | null {
  if (err === null || err === undefined) {
    return null;
  }

  // Local cancellation (Ctrl-C / AbortController) is a clean outcome, not a
  // failure — exit 0 silently. A *remote* Canceled status is a genuine failure
  // and falls through to classifyConnectCode (exit 1). This is the one place
  // the TS CLI deliberately improves on the Go CLI, which exits 1 for both.
  if (isLocalAbort(err)) {
    return { exitCode: ExitCode.Success, message: "", cause: toError(err) };
  }

  // Local errors that carry their own exit code (UsageError, auth-required,
  // etc.) are passed through verbatim, including any remediation hints.
  if (err instanceof CliExitError) {
    return { exitCode: err.exitCode, message: err.message, hints: err.hints, cause: err };
  }

  const coded = extractCoded(err);
  if (coded !== undefined) {
    return classifyConnectCode(coded.code, coded.message, toError(err));
  }

  return { exitCode: ExitCode.General, message: messageOf(err), cause: toError(err) };
}

interface CodedError {
  readonly code: number;
  readonly message: string;
}

// Walks the cause chain for the first SDK StigmerError or raw ConnectError.
// status.FromError in Go only checks the outermost error; this mirrors the Go
// CLI's extractGRPCStatus which walks Unwrap to handle wrapped RPC errors.
function extractCoded(err: unknown): CodedError | undefined {
  let depth = 0;
  for (let current: unknown = err; current != null && depth < MAX_CHAIN_DEPTH; current = causeOf(current), depth++) {
    if (current instanceof StigmerError) {
      return { code: current.connectCode, message: current.message };
    }
    if (current instanceof ConnectError) {
      return { code: current.code, message: current.rawMessage };
    }
  }
  return undefined;
}

function isLocalAbort(err: unknown): boolean {
  let depth = 0;
  for (let current: unknown = err; current != null && depth < MAX_CHAIN_DEPTH; current = causeOf(current), depth++) {
    if (current instanceof Error && current.name === "AbortError") {
      return true;
    }
  }
  return false;
}

function classifyConnectCode(code: number, message: string, cause: Error): CliError {
  switch (code) {
    case Code.Unavailable:
      return {
        exitCode: ExitCode.Connection,
        code,
        cause,
        message: "Cannot connect to the Stigmer server",
        hints: ["Make sure the Stigmer server is running and reachable."],
      };

    case Code.DeadlineExceeded:
      return {
        exitCode: ExitCode.Connection,
        code,
        cause,
        message: "Operation timed out",
        hints: ["The server took too long to respond. Try again in a moment."],
      };

    case Code.ResourceExhausted:
      return {
        exitCode: ExitCode.Connection,
        code,
        cause,
        message: "Rate limit exceeded",
        hints: ["Too many requests. Wait a moment and try again."],
      };

    case Code.NotFound:
      return { exitCode: ExitCode.NotFound, code, cause, message };

    case Code.InvalidArgument:
      return { exitCode: ExitCode.Usage, code, cause, message };

    case Code.FailedPrecondition:
      return { exitCode: ExitCode.Usage, code, cause, message: `Precondition failed: ${message}` };

    case Code.AlreadyExists:
      return { exitCode: ExitCode.Usage, code, cause, message: `Already exists: ${message}` };

    case Code.Unauthenticated:
      return {
        exitCode: ExitCode.Auth,
        code,
        cause,
        message: "Not authenticated",
        hints: ["Please sign in:", "  stigmer auth login"],
      };

    case Code.PermissionDenied:
      return {
        exitCode: ExitCode.Auth,
        code,
        cause,
        message: `Permission denied: ${message}`,
        hints: ["Check your permissions, or re-authenticate:", "  stigmer auth login"],
      };

    case Code.Internal:
      return {
        exitCode: ExitCode.General,
        code,
        cause,
        message: "Internal server error",
        hints: [
          "This is unexpected. If the problem persists, check the server logs.",
          "Run with --debug for more details.",
        ],
      };

    case Code.Aborted:
      return {
        exitCode: ExitCode.General,
        code,
        cause,
        message: `Operation aborted: ${message}`,
        hints: ["The operation was interrupted. You can safely retry."],
      };

    case Code.Canceled:
      return { exitCode: ExitCode.General, code, cause, message: "Operation cancelled" };

    default:
      return {
        exitCode: ExitCode.General,
        code,
        cause,
        message: `${codeName(code)}: ${message}`,
      };
  }
}

function causeOf(value: unknown): unknown {
  return value !== null && typeof value === "object"
    ? (value as { cause?: unknown }).cause
    : undefined;
}

function toError(value: unknown): Error {
  if (value instanceof Error) return value;
  return new Error(messageOf(value));
}

function messageOf(value: unknown): string {
  if (value instanceof Error) return value.message;
  if (typeof value === "string") return value;
  return String(value);
}

/** Human-readable Connect/gRPC code name, e.g. 12 -> "Unimplemented". */
export function codeName(code: number): string {
  return Code[code] ?? "Unknown";
}
