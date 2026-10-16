/**
 * One lane request's reach into the native methods: typed clients over the
 * serving chain held in memory, and the options every call carries (the
 * caller's forwarded headers and the request's abort signal).
 *
 * The clients ride a router transport built from the serving router's own
 * routes and interceptor array (boot/compose.ts), so a lane call meets
 * every check a network call meets: the error boundary, authentication
 * under the server's posture, the composed caller guards, validation, and
 * each method's own authorization and gates. That transport must never be
 * handed to server code as "in-process": it carries an outside caller's
 * credentials and nothing that marks the server's own internal calls.
 */
import type { CallOptions, Client } from "@connectrpc/connect";

import type { RunCommandController } from "@stigmer/apis/ai/stigmer/agentic/run/v1/command_pb";
import type { SessionCommandController } from "@stigmer/apis/ai/stigmer/agentic/session/v1/command_pb";
import type { SessionQueryController } from "@stigmer/apis/ai/stigmer/agentic/session/v1/query_pb";

/** The native methods the lane calls. */
export interface LaneClients {
  readonly sessionQuery: Client<typeof SessionQueryController>;
  readonly sessionCommand: Client<typeof SessionCommandController>;
  readonly runCommand: Client<typeof RunCommandController>;
}

/** One request's calls: the session it names, the clients, and every call's options. */
export interface LaneCall {
  readonly sessionId: string;
  readonly clients: LaneClients;
  readonly options: CallOptions & { readonly signal: AbortSignal };
  readonly requestId: string;
}
