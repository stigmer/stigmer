// Classifies any thrown value into a CliError: an exit code, a user-facing
// message, and optional remediation hints. It walks the error chain so
// wrapped RPC errors still map to the right exit code.
//
// A refusal that carries a reason the CLI knows gets its own copy. Today
// there are two:
//   - API_KEY_CREATED_BEFORE_SIGN_IN (stigmer/stigmer#1169), an
//     Unauthenticated whose fix is not "sign in again" but "sign in, then
//     create a new key". Its sentence is the server's, and it names the two
//     commands. Every other Unauthenticated keeps the generic sign-in copy.
//   - AGENT_HOURS_USED_UP, a FailedPrecondition from a Stigmer Cloud
//     organization that has used its plan's agent hours. The server's
//     sentence already names the hours, the plan and the reset date, so it
//     is printed as is, with `stigmer usage hours` as the place to see the
//     standing. A child organization's refusal names no plan (its parent
//     manages it) and gets no hint: the hours are its parent's to read.
//
// Every other kind ends with what to do, in the CLI's own commands (the
// terminal kit words its failures the same way: headline, cause, next;
// sdk/ink/src/errors.ts). A server that cannot be reached is named by the
// address the backend client dialled, read from the record the client
// left in runtime.ts when it was made, never resolved again here; the next
// step follows where that address came from. A code path that made no
// client names no address. A missing resource points at the list of its
// type when the command recorded one, and a refused request at the running
// command's help.

import { Code, ConnectError } from "@connectrpc/connect";
import { getErrorReason, StigmerError } from "@stigmer/client";
import { CliExitError } from "./cli-exit-error.js";
import { ExitCode } from "@stigmer/client/exit-codes";
import {
  actionCommandPath,
  actionResourceType,
  dialedServerAddress,
  type ServerAddress,
} from "../runtime.js";

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

// The server's reason for refusing a key created before sign-in was turned
// on (the apikey verifier; apis/ai/stigmer/iam/apikey/v1/README.md).
const REASON_API_KEY_CREATED_BEFORE_SIGN_IN = "API_KEY_CREATED_BEFORE_SIGN_IN";

// The cloud's refusal of new work once an organization's plan has no agent
// hours left this month; its metadata `plan` is empty for a child
// organization.
const REASON_AGENT_HOURS_USED_UP = "AGENT_HOURS_USED_UP";

export function classify(err: unknown): CliError | null {
  if (err === null || err === undefined) {
    return null;
  }

  // Local cancellation (Ctrl-C / AbortController) is a clean outcome, not a
  // failure — exit 0 silently. A *remote* Canceled status is a genuine failure
  // and falls through to classifyConnectCode (exit 1).
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
    if (
      coded.code === Code.Unauthenticated &&
      getErrorReason(err)?.reason === REASON_API_KEY_CREATED_BEFORE_SIGN_IN
    ) {
      return {
        exitCode: ExitCode.Auth,
        code: coded.code,
        cause: toError(err),
        message: coded.message,
        hints: [
          "Sign in, then create a new key:",
          "  stigmer auth login",
          "  stigmer apikey create --name <name>",
        ],
      };
    }
    const reason = getErrorReason(err);
    if (coded.code === Code.FailedPrecondition && reason?.reason === REASON_AGENT_HOURS_USED_UP) {
      return {
        exitCode: ExitCode.Usage,
        code: coded.code,
        cause: toError(err),
        message: coded.message,
        ...((reason.metadata.plan ?? "") === ""
          ? {}
          : { hints: ["See the organization's agent hours:", "  stigmer usage hours"] }),
      };
    }
    return classifyConnectCode(coded.code, coded.message, toError(err));
  }

  return { exitCode: ExitCode.General, message: messageOf(err), cause: toError(err) };
}

interface CodedError {
  readonly code: number;
  readonly message: string;
}

// Walks the cause chain for the first SDK StigmerError or raw ConnectError, so
// a wrapped RPC error still classifies by its status.
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

// The network's own refusals, by the code Node gives them or the words its
// fetch and HTTP/2 client use: no connection, no address, a reset or a hang-up.
const TRANSPORT_FAILURE = /\b(ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNRESET|EHOSTUNREACH|ENETUNREACH|EPIPE|UND_ERR_\w+)\b|fetch failed|socket hang up|other side closed|NGHTTP2_\w+/;

/**
 * Whether an Unavailable is the transport's (the request never reached a
 * server) rather than a server's answer: its message, or an error in its
 * cause chain, names a network failure.
 */
export function isTransportFailure(message: string, cause: unknown): boolean {
  if (TRANSPORT_FAILURE.test(message)) return true;
  let depth = 0;
  for (let current: unknown = cause; current != null && depth < MAX_CHAIN_DEPTH; current = causeOf(current), depth++) {
    const errno = (current as { code?: unknown }).code;
    if (typeof errno === "string" && TRANSPORT_FAILURE.test(errno)) return true;
    if (current instanceof Error && TRANSPORT_FAILURE.test(current.message)) return true;
  }
  return false;
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
      // A request that never reached the server names the address it was
      // sent to; one the server answered with Unavailable keeps its words.
      if (isTransportFailure(message, cause)) {
        return { exitCode: ExitCode.Connection, code, cause, ...cannotConnect(dialedServerAddress()) };
      }
      return { exitCode: ExitCode.Connection, code, cause, message, hints: ["The server could not take the request just now. Try again in a moment."] };

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
      return { exitCode: ExitCode.NotFound, code, cause, message, hints: [notFoundHint()] };

    case Code.InvalidArgument:
      return { exitCode: ExitCode.Usage, code, cause, message, hints: [helpHint()] };

    case Code.FailedPrecondition:
      return { exitCode: ExitCode.Usage, code, cause, message: `Precondition failed: ${message}`, hints: [helpHint()] };

    case Code.AlreadyExists:
      return { exitCode: ExitCode.Usage, code, cause, message: `Already exists: ${message}`, hints: [helpHint()] };

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
      return {
        exitCode: ExitCode.General,
        code,
        cause,
        message: "Operation cancelled",
        hints: ["The server cancelled the request. Try again."],
      };

    default:
      return {
        exitCode: ExitCode.General,
        code,
        cause,
        message: `${codeName(code)}: ${message}`,
        hints: ["Run with --debug for more details."],
      };
  }
}

/** What a failure to reach the server says: what was tried and what to do. */
export interface ConnectFailure {
  readonly message: string;
  readonly hints: readonly string[];
}

/**
 * The words for a server that could not be reached at `address`, with the
 * next step its source calls for: start the local daemon, check the named
 * backend, or look at the override. With no address (no client was made)
 * it names none. The connect timeout (client/client.ts) words itself with
 * this too, so both failures read alike.
 */
export function cannotConnect(address: ServerAddress | undefined): ConnectFailure {
  // The next step for a named backend, and for a failure that names no
  // address: the status command prints the active backend and its endpoint.
  const checkBackend = "Check the backend: stigmer config backend status";
  if (address === undefined) {
    return { message: "Could not reach the Stigmer server", hints: [checkBackend] };
  }
  switch (address.source) {
    case "environment":
      return {
        message: `Could not reach the Stigmer server at ${address.address} (set by STIGMER_SERVER_ADDRESS)`,
        hints: ["Start the server it names, or unset STIGMER_SERVER_ADDRESS to use the active backend."],
      };
    case "local":
      return { message: `Could not reach the Stigmer server at ${address.address}`, hints: ["Start it: stigmer up"] };
    case "cloud":
    case "selfhost":
      return { message: `Could not reach the Stigmer server at ${address.address}`, hints: [checkBackend] };
  }
}

// A missing resource: the list of its type when the running command
// recorded one (get, delete and download do), else the two things a
// reference is made of.
function notFoundHint(): string {
  const type = actionResourceType();
  return type === "" ? "Check the reference and the organization (--org)." : `Check the reference: stigmer list ${type}`;
}

// A refused request: the running command's help, worded as a command-line
// refusal words it (errors/command-line.ts); the root's before any command
// ran.
function helpHint(): string {
  const path = actionCommandPath();
  return `Run \`${path === "" ? "stigmer" : path} --help\` for usage.`;
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
