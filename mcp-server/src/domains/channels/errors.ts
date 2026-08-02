// The channels-domain error mapper — the records-domain sibling
// (DD-004 S-7's recorded posture: siblings share the idiom, never an
// abstraction over it; each domain documents its own contract).
//
// Channel-messaging domain errors carry agent-relayable messages that
// are contract bytes (proactive-messaging DD-002 D4's error table):
// "this agent has no proactive-messaging channel it can use", "channel
// is required: this agent serves multiple proactive-enabled channels:
// …", the OSS "proactive channel messaging requires Stigmer Cloud".
// The shared ../rpcerr.ts would rewrite them into transport advice and
// discard google.rpc.ErrorInfo; here the domain codes pass the server's
// message through VERBATIM as isError JSON `{error, code, reason}` so
// the model can self-correct (name the channel on INVALID_ARGUMENT;
// stop and relay on PERMISSION_DENIED). Transport codes still delegate
// to the shared helper, whose advice is right for them.
//
// Typed send outcomes (accepted/queued/refused) never reach this file:
// they are successful responses by design (DD-002 D4 — policy refusals
// are answers, not errors).

import { Code, ConnectError } from "@connectrpc/connect";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { ErrorInfoSchema } from "@stigmer/protos/google/rpc/error_details_pb";
import { rpcError } from "../rpcerr.js";
import { errorResult, textResult } from "../toolresult.js";

/**
 * The gRPC codes whose messages are the channel-messaging domain
 * contract: reach denials (PERMISSION_DENIED, one fail-closed text per
 * failure class), contract misuse with corrective copy
 * (INVALID_ARGUMENT — ambiguous channel, ambiguous template language),
 * and actionable preconditions (FAILED_PRECONDITION — the OSS refusal,
 * not-installed, registry misconfiguration with its ErrorInfo reason).
 */
const DOMAIN_CODES: ReadonlySet<Code> = new Set([
  Code.PermissionDenied,
  Code.InvalidArgument,
  Code.FailedPrecondition,
]);

/** The structured error payload channel tools return for domain errors. */
export interface ChannelToolError {
  /** The server's relayable message, byte-for-byte. */
  error: string;
  /** gRPC status name in SCREAMING_SNAKE (e.g. PERMISSION_DENIED). */
  code: string;
  /** ErrorInfo reason (e.g. WHATSAPP_MANAGEMENT_SCOPE_MISSING), when present. */
  reason?: string;
}

/**
 * Run a channel-tool body: a string payload becomes a text result; a
 * domain error becomes an isError JSON result carrying the verbatim
 * message + ErrorInfo reason; a transport error delegates to the shared
 * classifier. The only try/catch in this domain.
 */
export async function channelResult(
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
export function domainError(ce: ConnectError): ChannelToolError {
  const payload: ChannelToolError = {
    error: ce.rawMessage,
    code: grpcStatusName(ce.code),
  };
  // The messaging RPCs attach google.rpc.ErrorInfo to operator-actionable
  // preconditions (DD-005 D8); absence means the message alone carries
  // the contract.
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
