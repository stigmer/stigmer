// The records-domain error mapper (DD-005 SD-6) — a deliberate,
// documented divergence from the shared ../rpcerr.ts.
//
// Record-RPC domain errors carry agent-relayable messages that are
// cross-edition contract bytes (DD-002 SD-5): "that slot is already
// booked", "you are not allowed to insert records in bookings". The
// shared helper would rewrite them ("Check your API key permissions")
// and discards google.rpc.ErrorInfo. Here the domain codes pass the
// server's message through VERBATIM as isError JSON text
// `{error, code, reason, constraint}` — reason/constraint extracted
// from ErrorInfo — so the model can self-correct (retry another slot
// on CONSTRAINT_VIOLATION; stop and relay on PERMISSION_DENIED).
// Transport codes still delegate to the shared helper, whose advice is
// right for them.

import { Code, ConnectError } from "@connectrpc/connect";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { ErrorInfoSchema } from "@stigmer/protos/google/rpc/error_details_pb";
import { rpcError } from "../rpcerr.js";
import { errorResult, textResult } from "../toolresult.js";

/**
 * The gRPC codes whose messages are the record-RPC domain contract
 * (DD-005 SD-6): declared constraint messages, fixed denial texts, and
 * domain validation — all written to be relayed to end users verbatim.
 */
const DOMAIN_CODES: ReadonlySet<Code> = new Set([
  Code.PermissionDenied,
  Code.AlreadyExists,
  Code.FailedPrecondition,
  Code.InvalidArgument,
  Code.NotFound,
]);

/** The structured error payload record tools return for domain errors. */
export interface RecordToolError {
  /** The server's relayable message, byte-for-byte. */
  error: string;
  /** gRPC status name in SCREAMING_SNAKE (e.g. ALREADY_EXISTS). */
  code: string;
  /** ErrorInfo reason (e.g. CONSTRAINT_VIOLATION), when present. */
  reason?: string;
  /** Violated constraint name from ErrorInfo metadata, when present. */
  constraint?: string;
}

/**
 * Run a record-tool body: a string payload becomes a text result; a
 * domain error becomes an isError JSON result carrying the verbatim
 * message + ErrorInfo companions; a transport error delegates to the
 * shared classifier. The records analog of ../toolresult.ts
 * textOrError, and the only try/catch in this domain.
 */
export async function recordResult(
  toolContext: string,
  produce: () => Promise<string>,
): Promise<CallToolResult> {
  try {
    return textResult(await produce());
  } catch (err) {
    const ce = ConnectError.from(err);
    if (DOMAIN_CODES.has(ce.code)) {
      return {
        content: [{ type: "text", text: JSON.stringify(domainError(ce)) }],
        isError: true,
      };
    }
    return errorResult(rpcError(ce, toolContext));
  }
}

/** Project a domain ConnectError into the structured tool payload. */
export function domainError(ce: ConnectError): RecordToolError {
  const payload: RecordToolError = {
    error: ce.rawMessage,
    code: grpcStatusName(ce.code),
  };
  // The record RPCs attach one google.rpc.ErrorInfo per domain error
  // (domain datastore.stigmer.ai); absence means an older server — the
  // message alone still carries the contract.
  const details = ce.findDetails(ErrorInfoSchema);
  if (details.length > 0) {
    const info = details[0];
    if (info.reason !== "") {
      payload.reason = info.reason;
    }
    const constraint = info.metadata["constraint"];
    if (constraint !== undefined && constraint !== "") {
      payload.constraint = constraint;
    }
  }
  return payload;
}

/** Connect's PascalCase code name → the gRPC SCREAMING_SNAKE status name. */
function grpcStatusName(code: Code): string {
  return Code[code].replace(/([a-z0-9])([A-Z])/g, "$1_$2").toUpperCase();
}
