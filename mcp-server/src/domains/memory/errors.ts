// The memory-domain error mapper — the channels-domain sibling (DD-004
// S-7's recorded posture: siblings share the idiom, never an abstraction
// over it; each domain documents its own contract).
//
// Memory create errors carry agent-relayable messages that are contract
// bytes (DD-005 D2 / DD-006 D5): the visible-full refusal ("memory is
// full — review and delete existing memories"), the fail-closed
// enablement refusals (org or member has memory off), the strict caller
// gate's PERMISSION_DENIED, and the 1..500-char content contract. The
// shared ../rpcerr.ts would rewrite these into transport advice; here the
// domain codes pass the server's message through VERBATIM as isError JSON
// `{error, code, reason}` so the model can relay honestly — "memory is
// full" is something the user must act on, not something to retry.
// Transport codes still delegate to the shared helper, whose advice is
// right for them.
//
// The successful answer (outcome + created record) never reaches this
// file: a proposal is an ANSWER, never an error.

import { Code, ConnectError } from "@connectrpc/connect";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { ErrorInfoSchema } from "@stigmer/protos/google/rpc/error_details_pb";
import { rpcError } from "../rpcerr.js";
import { errorResult, textResult } from "../toolresult.js";

/**
 * The gRPC codes whose messages are the memory-domain contract: the
 * strict caller gate (PERMISSION_DENIED), the content contract
 * (INVALID_ARGUMENT — 1..500 chars), and actionable preconditions
 * (FAILED_PRECONDITION — enablement off at either scope, the visible
 * cap, the OSS/cloud edition refusals).
 */
const DOMAIN_CODES: ReadonlySet<Code> = new Set([
  Code.PermissionDenied,
  Code.InvalidArgument,
  Code.FailedPrecondition,
]);

/** The structured error payload memory tools return for domain errors. */
export interface MemoryToolError {
  /** The server's relayable message, byte-for-byte. */
  error: string;
  /** gRPC status name in SCREAMING_SNAKE (e.g. FAILED_PRECONDITION). */
  code: string;
  /** ErrorInfo reason, when the server attached one. */
  reason?: string;
}

/**
 * Run a memory-tool body: a string payload becomes a text result; a
 * domain error becomes an isError JSON result carrying the verbatim
 * message; a transport error delegates to the shared classifier. The
 * only try/catch in this domain.
 */
export async function memoryResult(
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
export function domainError(ce: ConnectError): MemoryToolError {
  const payload: MemoryToolError = {
    error: ce.rawMessage,
    code: grpcStatusName(ce.code),
  };
  const details = ce.findDetails(ErrorInfoSchema);
  if (details.length > 0 && details[0].reason !== "") {
    payload.reason = details[0].reason;
  }
  return payload;
}

/** Connect's PascalCase code name → the gRPC SCREAMING_SNAKE status name. */
function grpcStatusName(code: Code): string {
  return Code[code].replace(/([a-z0-9])([A-Z])/g, "$1_$2").toUpperCase();
}
