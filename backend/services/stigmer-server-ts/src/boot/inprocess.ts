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
import { AgentInstanceQueryController } from "@stigmer/protos/ai/stigmer/agentic/agentinstance/v1/query_pb";
import { AgentInstanceIdSchema } from "@stigmer/protos/ai/stigmer/agentic/agentinstance/v1/io_pb";
import { EnvironmentCommandController } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/command_pb";
import { EnvironmentQueryController } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/query_pb";
import { ExecutionContextCommandController } from "@stigmer/protos/ai/stigmer/agentic/executioncontext/v1/command_pb";
import { SessionCommandController } from "@stigmer/protos/ai/stigmer/agentic/session/v1/command_pb";
import { SessionQueryController } from "@stigmer/protos/ai/stigmer/agentic/session/v1/query_pb";
import { SessionIdSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/io_pb";
import { WorkflowQueryController } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/query_pb";
import { WorkflowIdSchema } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/io_pb";
import { WorkflowInstanceCommandController } from "@stigmer/protos/ai/stigmer/agentic/workflowinstance/v1/command_pb";
import { WorkflowInstanceQueryController } from "@stigmer/protos/ai/stigmer/agentic/workflowinstance/v1/query_pb";
import { WorkflowInstanceIdSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowinstance/v1/io_pb";
import { AgentExecutionCommandController } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/command_pb";

import type { AgentInstanceApplier } from "../domain/agent/steps.js";
import type { ParentAgentLoader } from "../domain/agentinstance/steps.js";
import type {
  AgentLoader,
  ExecutionAgentInstanceCreator,
  SessionCreator,
} from "../domain/agentexecution/create-steps.js";
import type {
  AgentInstanceLoader,
  EnvironmentReader,
  ExecutionContextCreator,
  SessionLoader,
} from "../domain/agentexecution/create-execution-context-step.js";
import type { ManagedEnvironmentClient } from "../domain/mcpserver/oauth/managed-env.js";
import type { AgentInstanceCreator } from "../domain/session/steps.js";
import type { WorkflowInstanceCreator } from "../domain/workflow/steps.js";
import type { ExecutionWorkflowInstanceCreator } from "../domain/workflowexecution/create-steps.js";
import type {
  ExecutionWorkflowInstanceLoader,
  WorkflowExecutionContextCreator,
} from "../domain/workflowexecution/create-execution-context-step.js";
import type { AgentExecutionApprovalForwarder } from "../domain/workflowexecution/submit-approval.js";
import type { AgentExecutionFileDecisionForwarder } from "../domain/workflowexecution/submit-file-decision.js";
import type { ParentWorkflowLoader } from "../domain/workflowinstance/steps.js";
import { buildInterceptorChain } from "../pipeline/chain.js";
import type { Logger } from "./logger.js";

/** The narrow in-process surfaces the domains consume (DD-002). */
export interface InProcessClients {
  readonly agentInstanceApplier: AgentInstanceApplier;
  readonly agentInstanceCreator: AgentInstanceCreator;
  readonly parentAgentLoader: ParentAgentLoader;
  readonly workflowInstanceCreator: WorkflowInstanceCreator;
  readonly parentWorkflowLoader: ParentWorkflowLoader;
  // The agentexecution create/EC-builder edges (server.go 565–566: the
  // controller's agent/agentinstance/session/environment/executioncontext
  // in-process clients).
  readonly executionAgentLoader: AgentLoader;
  readonly executionAgentInstanceLoader: AgentInstanceLoader;
  readonly executionAgentInstanceCreator: ExecutionAgentInstanceCreator;
  readonly executionSessionLoader: SessionLoader;
  readonly executionSessionCreator: SessionCreator;
  /**
   * Reads for the EC builder plus the secret rewrite the OAuth pre-flight
   * refresh needs (ManagedEnvironmentClient) — one surface, every call
   * through the full chain.
   */
  readonly executionEnvironmentReader: EnvironmentReader &
    ManagedEnvironmentClient;
  readonly executionContextCreator: ExecutionContextCreator;
  // The workflowexecution edges (server.go 636–642: the controller's
  // workflowinstance/executioncontext clients and the two HITL forwarding
  // interfaces satisfied by the agentexecution controller).
  readonly workflowExecutionInstanceCreator: ExecutionWorkflowInstanceCreator;
  readonly workflowExecutionInstanceLoader: ExecutionWorkflowInstanceLoader;
  readonly workflowExecutionContextCreator: WorkflowExecutionContextCreator;
  readonly workflowExecutionApprovalForwarder: AgentExecutionApprovalForwarder;
  readonly workflowExecutionFileDecisionForwarder: AgentExecutionFileDecisionForwarder;
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
  const agentInstanceQuery = createClient(
    AgentInstanceQueryController,
    transport,
  );
  const agentQuery = createClient(AgentQueryController, transport);
  const sessionCommand = createClient(SessionCommandController, transport);
  const sessionQuery = createClient(SessionQueryController, transport);
  const environmentCommand = createClient(
    EnvironmentCommandController,
    transport,
  );
  const environmentQuery = createClient(EnvironmentQueryController, transport);
  const executionContextCommand = createClient(
    ExecutionContextCommandController,
    transport,
  );
  const workflowInstanceCommand = createClient(
    WorkflowInstanceCommandController,
    transport,
  );
  const workflowInstanceQuery = createClient(
    WorkflowInstanceQueryController,
    transport,
  );
  const workflowQuery = createClient(WorkflowQueryController, transport);
  const agentExecutionCommand = createClient(
    AgentExecutionCommandController,
    transport,
  );

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
    // Go's workflowinstance.Client.CreateAsSystem is the Create RPC under
    // the process-global operator identity; workflow create's
    // default-instance step uses CREATE (not apply) so a duplicate
    // default-instance slug surfaces as AlreadyExists instead of silently
    // updating — same posture as the agent edge above.
    workflowInstanceCreator: {
      createAsSystem: (instance) => workflowInstanceCommand.create(instance),
    },
    // Go's workflow.Client.Get for workflowinstance create's parent load
    // (server.go 657: the other direction of the mutual edge).
    parentWorkflowLoader: {
      get: (workflowId) =>
        workflowQuery.get(create(WorkflowIdSchema, { value: workflowId })),
    },
    // The agentexecution edges. CreateAsSystem semantics per the agent
    // edge above: create under the process-global operator identity.
    executionAgentLoader: {
      get: (agentId) =>
        agentQuery.get(create(AgentIdSchema, { value: agentId })),
    },
    executionAgentInstanceLoader: {
      get: (instanceId) =>
        agentInstanceQuery.get(
          create(AgentInstanceIdSchema, { value: instanceId }),
        ),
    },
    executionAgentInstanceCreator: {
      createAsSystem: (instance) => agentInstanceCommand.create(instance),
    },
    executionSessionLoader: {
      get: (sessionId) =>
        sessionQuery.get(create(SessionIdSchema, { value: sessionId })),
    },
    executionSessionCreator: {
      create: (session) => sessionCommand.create(session),
    },
    executionEnvironmentReader: {
      list: (request) => environmentQuery.list(request),
      getSecretValue: (input) => environmentQuery.getSecretValue(input),
      updateVariables: (request) => environmentCommand.updateVariables(request),
    },
    executionContextCreator: {
      create: (ec) => executionContextCommand.create(ec),
    },
    // The workflowexecution edges. CreateAsSystem semantics per the
    // workflow edge above: create under the process-global operator
    // identity (default-instance self-heal must surface duplicate slugs
    // as AlreadyExists).
    workflowExecutionInstanceCreator: {
      createAsSystem: (instance) => workflowInstanceCommand.create(instance),
    },
    workflowExecutionInstanceLoader: {
      get: (instanceId) =>
        workflowInstanceQuery.get(
          create(WorkflowInstanceIdSchema, { value: instanceId }),
        ),
    },
    workflowExecutionContextCreator: {
      create: (ec) => executionContextCommand.create(ec),
    },
    // The two HITL forwarding edges — Go's method-segregated
    // AgentExecutionApprovalClient / AgentExecutionFileDecisionClient,
    // both satisfied by the in-process agentexecution controller.
    workflowExecutionApprovalForwarder: {
      submitApproval: (input) => agentExecutionCommand.submitApproval(input),
    },
    workflowExecutionFileDecisionForwarder: {
      submitFileDecision: (input) =>
        agentExecutionCommand.submitFileDecision(input),
    },
  };
}
