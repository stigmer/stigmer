// The conversation-domain error mapper — the channels-domain sibling
// (DD-004 S-7's recorded posture: siblings share the idiom, never an
// abstraction over it; each domain documents its own contract).
//
// Conversation domain errors carry agent-relayable messages that are
// contract bytes (the ChannelConversationReach refusal matrix):
// "escalate is agent-audience only: it requires a session-scoped runner
// credential", "conversation identity could not be verified for this
// session", "this session is not serving a channel conversation, so
// there is nothing to escalate", the OSS "conversation participation
// requires Stigmer Cloud". The shared ../rpcerr.ts would rewrite them
// into transport advice; here the domain codes pass the server's
// message through VERBATIM as isError JSON `{error, code}` so the model
// can stop and adapt.
//
// Two deliberate differences from the channels set, each this domain's
// own contract:
//   - NOT_FOUND is a domain code HERE: the handler's "no conversation
//     with this key exists on channel …" is contract copy, and the
//     shared classifier's rewrite ("Verify the org and slug are
//     correct") names arguments escalate does not take.
//   - No google.rpc.ErrorInfo extraction: the conversation commands
//     attach none — the message alone carries the contract.

import { Code, ConnectError } from "@connectrpc/connect";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { rpcError } from "../rpcerr.js";
import { errorResult, textResult } from "../toolresult.js";

/**
 * The gRPC codes whose messages are the conversation domain contract:
 * reach denials (PERMISSION_DENIED, one fail-closed text per failure
 * class), contract misuse with corrective copy (INVALID_ARGUMENT — an
 * empty or over-budget reason), actionable preconditions
 * (FAILED_PRECONDITION — the OSS refusal, a session serving no channel
 * conversation), and the absent-conversation answer (NOT_FOUND).
 */
const DOMAIN_CODES: ReadonlySet<Code> = new Set([
  Code.PermissionDenied,
  Code.InvalidArgument,
  Code.FailedPrecondition,
  Code.NotFound,
]);

/** The structured error payload conversation tools return for domain errors. */
export interface ConversationToolError {
  /** The server's relayable message, byte-for-byte. */
  error: string;
  /** gRPC status name in SCREAMING_SNAKE (e.g. PERMISSION_DENIED). */
  code: string;
}

/**
 * Run a conversation-tool body: a string payload becomes a text result;
 * a domain error becomes an isError JSON result carrying the verbatim
 * message; a transport error delegates to the shared classifier. The
 * only try/catch in this domain.
 */
export async function conversationResult(
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
export function domainError(ce: ConnectError): ConversationToolError {
  return {
    error: ce.rawMessage,
    code: grpcStatusName(ce.code),
  };
}

/** Connect's PascalCase code name → the gRPC SCREAMING_SNAKE status name. */
function grpcStatusName(code: Code): string {
  return Code[code].replace(/([a-z0-9])([A-Z])/g, "$1_$2").toUpperCase();
}
