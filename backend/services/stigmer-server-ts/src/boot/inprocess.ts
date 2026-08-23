/**
 * In-process ConnectRPC clients — the TS twin of Go's pkg/downstream/*
 * packages (agent, agentinstance), which serve cross-domain calls through
 * the same *grpc.Server over an in-memory bufconn so EVERY interceptor
 * executes: an internal call is validated, logged, and kind-tagged exactly
 * like an external one. Here the bufconn equivalent is ConnectRPC's
 * `createRouterTransport` built from the SAME routes registration function
 * the unified-port server uses, with the SAME interceptor chain — proven by
 * spike SP-B (src/pipeline/__tests__/router-transport.test.ts): every
 * interceptor runs, in registration order, and a chain rejection
 * short-circuits with a ConnectError the in-process caller sees (DD-002).
 *
 * The agent↔agentinstance true cycle is broken at the CONSUMERS with lazy
 * providers (`() => client`) resolved at call time; this module only
 * supplies the client objects those providers close over.
 */
import { createClient, createRouterTransport } from "@connectrpc/connect";
import type { ConnectRouter } from "@connectrpc/connect";
import { create } from "@bufbuild/protobuf";

import { AgentQueryController } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/query_pb";
import { AgentIdSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/io_pb";
import { AgentInstanceCommandController } from "@stigmer/protos/ai/stigmer/agentic/agentinstance/v1/command_pb";

import type { AgentInstanceApplier } from "../domain/agent/steps.js";
import type { ParentAgentLoader } from "../domain/agentinstance/steps.js";
import type { AgentInstanceCreator } from "../domain/session/steps.js";
import { buildInterceptorChain } from "../pipeline/chain.js";
import type { Logger } from "./logger.js";

/** The narrow in-process surfaces the domains consume (DD-002). */
export interface InProcessClients {
  readonly agentInstanceApplier: AgentInstanceApplier;
  readonly agentInstanceCreator: AgentInstanceCreator;
  readonly parentAgentLoader: ParentAgentLoader;
}

/**
 * Builds the in-process clients over a router transport that registers the
 * SAME routes and runs the SAME interceptor chain as the serving router —
 * validation parity is the point, exactly Go's bufconn shape.
 */
export function createInProcessClients(
  routes: (router: ConnectRouter) => void,
  logger: Logger,
): InProcessClients {
  const transport = createRouterTransport(routes, {
    router: { interceptors: buildInterceptorChain(logger) },
  });

  const agentInstanceCommand = createClient(
    AgentInstanceCommandController,
    transport,
  );
  const agentQuery = createClient(AgentQueryController, transport);

  return {
    // Go's ApplyAsSystem is the Apply RPC with no extra identity attached:
    // the audit actor comes from the process-global operator identity
    // (installed once by main.ts, #400), so a plain apply IS the
    // system-actor apply in this edition.
    agentInstanceApplier: {
      applyAsSystem: (instance) => agentInstanceCommand.apply(instance),
    },
    // Go's CreateAsSystem is the Create RPC under the same process-global
    // operator identity; session create's resolve step uses CREATE (not
    // apply) so a duplicate default-instance slug surfaces as
    // AlreadyExists instead of silently updating.
    agentInstanceCreator: {
      createAsSystem: (instance) => agentInstanceCommand.create(instance),
    },
    parentAgentLoader: {
      get: (agentId) =>
        agentQuery.get(create(AgentIdSchema, { value: agentId })),
    },
  };
}
