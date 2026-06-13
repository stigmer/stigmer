// Translation of transport/RPC failures into user-facing tool errors.
//
// Parity contract (mirrors Go internal/domains/rpcerr.go): the original error is
// logged at WARN for operator debugging; only the classified, user-friendly
// message is returned to the AI client. Message text is kept verbatim so the
// TS and Go servers are indistinguishable to clients.

import { Code, ConnectError } from "@connectrpc/connect";
import { log } from "../logger.js";

/**
 * Translate a Connect/gRPC error into a user-friendly Error.
 *
 * `resourceDescription` identifies what was being accessed, e.g.
 * `agent "code-reviewer" in org "stigmer"`.
 */
export function rpcError(err: unknown, resourceDescription: string): Error {
  const ce = ConnectError.from(err);

  log.warn("rpc call failed", {
    resource: resourceDescription,
    code: Code[ce.code],
    grpc_message: ce.rawMessage,
  });

  return new Error(classifyCode(ce, resourceDescription));
}

function classifyCode(ce: ConnectError, resourceDescription: string): string {
  switch (ce.code) {
    case Code.NotFound:
      return `${resourceDescription} not found. Verify the org and slug are correct.`;
    case Code.PermissionDenied:
      return `Permission denied for ${resourceDescription}. Check your API key permissions.`;
    case Code.Unauthenticated:
      return "Authentication failed. Check your API key.";
    case Code.Unavailable:
      return "Stigmer server is unavailable. Ensure it is running and reachable.";
    case Code.DeadlineExceeded:
      return "Request timed out contacting stigmer-server.";
    case Code.InvalidArgument:
      return ce.rawMessage;
    default:
      return `unexpected error: ${ce.rawMessage}`;
  }
}
