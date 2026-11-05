/**
 * Every sentence the Temporal worker lane answers with, in one place, so
 * the words are reviewed together and pinned by their tests. Each names
 * the Stigmer server, never the lane's own name, and names only the
 * caller: no other sandbox, queue or tenant appears in a refusal.
 */

export const WORDS = {
  notHttp2:
    "The Stigmer server speaks Temporal's worker protocol over HTTP/2 only",
  notGrpc: "The Stigmer server answers Temporal's worker protocol as gRPC only",
  compressed: "The Stigmer server does not accept compressed Temporal requests",
  malformed: "The Stigmer server could not read this Temporal request",
  tooLarge: "This Temporal request is larger than the Stigmer server accepts",
  notServed: (method: string) =>
    `The Stigmer server does not serve ${method} to a sandboxed runner`,
  noCredential:
    "The Stigmer server admits a runner to Temporal by its sandbox credential, and this request carries none",
  notASandbox:
    "The Stigmer server admits only a sandboxed runner's own credential to Temporal; this credential is not one, or its sandbox has ended",
  wrongNamespace: (namespace: string) =>
    `The Stigmer server serves only its own Temporal namespace, not ${namespace}`,
  wrongQueue:
    "The Stigmer server lets a sandboxed runner poll only its own task queue",
  stickyQueue:
    "The Stigmer server serves a sandboxed runner's own task queue only, with no sticky or versioned queue",
  notYourReceipt:
    "The Stigmer server did not hand this task to this sandbox",
  engineUnavailable:
    "The Stigmer server is not connected to Temporal right now; retry shortly",
  receiptKeyUnavailable:
    "The Stigmer server cannot read its task receipt key right now; retry shortly",
  tooManyForSandbox:
    "This sandbox already holds as many open polls as the Stigmer server allows one sandbox",
  tooManyForServer:
    "The Stigmer server holds as many open polls as it allows; retry shortly",
} as const;
