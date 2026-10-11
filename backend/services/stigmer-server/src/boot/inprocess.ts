/**
 * In-process ConnectRPC clients — the TS twin of Go's pkg/downstream/*
 * packages (agent and the rest), which serve cross-domain calls through
 * the same *grpc.Server over an in-memory bufconn so EVERY interceptor
 * executes: an internal call is validated, logged, and kind-tagged exactly
 * like an external one. Here the bufconn equivalent is ConnectRPC's
 * `createRouterTransport` built from the SAME routes registration function
 * the unified-port server uses, with the SAME interceptor chain EXCEPT the
 * position-1 identity source: this chain stamps the
 * `internal` caller class only it can mint, where the serving chain runs
 * the verifier chassis over the wire's credentials. Chain traversal proven
 * by src/pipeline/__tests__/router-transport.test.ts: every
 * interceptor runs, in registration order, and a chain rejection
 * short-circuits with a ConnectError the in-process caller sees.
 *
 * The routes↔clients cycle is broken at the CONSUMERS with lazy providers
 * (`() => client`) resolved at call time; this module only supplies the
 * client objects those providers close over.
 */
import { createClient, createRouterTransport } from "@connectrpc/connect";
import type { ConnectRouter, Transport } from "@connectrpc/connect";
import { create } from "@bufbuild/protobuf";

import { AgentCommandController } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/command_pb";
import { AgentQueryController } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/query_pb";
import { AgentIdSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/io_pb";
import { GetAgentVersionInputSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/version_pb";
import { SkillCommandController } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/command_pb";
import { OrganizationCommandController } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/command_pb";
import { SessionCommandController } from "@stigmer/protos/ai/stigmer/agentic/session/v1/command_pb";
import { SessionQueryController } from "@stigmer/protos/ai/stigmer/agentic/session/v1/query_pb";
import { SessionIdSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/io_pb";
import { RunCommandController } from "@stigmer/protos/ai/stigmer/agentic/run/v1/command_pb";
import { TerminateRunInputSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/io_pb";
import { ScoreCommandController } from "@stigmer/protos/ai/stigmer/agentic/score/v1/command_pb";
import { ScoreIdSchema } from "@stigmer/protos/ai/stigmer/agentic/score/v1/io_pb";

import type {
  AgentLoader,
  SessionCreator,
} from "../domain/run/create-steps.js";
import type { SessionLoader } from "../domain/run/plan-run-values-step.js";
import type {
  JudgeRunCreator,
  JudgeSessionDeleter,
  ScoreDeleter,
  ScoreRecorder,
} from "../domain/score/ports.js";
import type { ExecutionStatusWriter } from "../temporal/agentexecution/activities.js";
import type { ScheduleExecutionCreator } from "../temporal/schedule/run-starter.js";
import type { PluginEvalTryLane } from "../temporal/evals/ports.js";
import { buildInterceptorChain } from "../pipeline/chain.js";
import type { SharedChainInterceptors } from "../pipeline/chain.js";
import {
  createInProcessCallerInterceptor,
  encodeInProcessCaller,
  IN_PROCESS_CALLER_HEADER,
} from "../pipeline/interceptors/auth.js";
import type { CallerIdentity } from "../extensions/identity.js";
import type { Logger } from "./logger.js";
import type { SingleOrganizationCreator } from "./single-organization.js";
import type { CallOptions } from "@connectrpc/connect";

/** The narrow in-process surfaces the domains consume. */
export interface InProcessClients {
  // The run create and value-planner edges: the controller's agent and
  // session in-process clients.
  readonly executionAgentLoader: AgentLoader;
  readonly executionSessionLoader: SessionLoader;
  readonly executionSessionCreator: SessionCreator;
  /**
   * The grading code's write of a run's run-health score
   * (temporal/grading/, domain/score/grading-observer.ts): the score's
   * create chain as the server, the only caller its source guard admits
   * for a check.
   */
  readonly scoreRecorder: ScoreRecorder;
  /**
   * The removal of a run's scores when the run goes
   * (domain/score/cascade.ts): each score's delete chain as the server, so
   * its access goes with its row.
   */
  readonly scoreDeleter: ScoreDeleter;
  /**
   * The AI judge's run (temporal/grading/judge-activities.ts): its create
   * enters the FULL run create pipeline, as the schedule clock's fire does,
   * AS THE GRADING CALLER when the composition minted one (the asCaller
   * lane), so the hosted edition's launch gates and sandbox see a caller
   * they can bill and mint for; its terminate is the server's own.
   */
  readonly judgeRunCreator: JudgeRunCreator;
  /**
   * The judge session's removal once its grade is recorded: the session's
   * delete chain as the server, which deletes its run and releases its
   * sandbox.
   */
  readonly judgeSessionDeleter: JudgeSessionDeleter;
  /**
   * A plugin eval's tries and votes (temporal/evals/ports.ts): each
   * session, then its run, through their FULL create chains AS THE EVAL'S
   * CALLER when the composition minted one (the asCaller lane), else as
   * the server, so the session may carry the reserved plugin-eval label
   * by the in-process origin; a run's stop is the server's own.
   */
  readonly pluginEvalTries: PluginEvalTryLane;
  /**
   * The schedule clock's fire edge (server.go 581: the RunStarter's
   * in-process agentexecution client): every fire — cron tick or manual
   * trigger — enters the FULL execution create pipeline, so session
   * auto-create, the value plan, launch gates, and workflow start all
   * run exactly as for an external create.
   */
  readonly scheduleExecutionCreator: ScheduleExecutionCreator;
  /**
   * The agent-execution worker's own-behalf status edge (stigmer#979): the
   * invoke workflow's fallback writes — FAILED when a runner fails without
   * persisting, the IN_PROGRESS re-assertions on recovery and resume, the
   * CANCELLED fallback, the PAUSED / WAITING_FOR_APPROVAL defense-in-depth
   * persists — enter the SAME updateStatus chain the runner's gRPC path
   * runs (Authorize, the merge chokepoint, the status hooks, the
   * broadcast) and carry the internal caller class this transport's
   * position 1 stamps. The worker builds no identity of its own: server
   * code acting on its own behalf rides this lane, where the class is
   * minted — exactly like the schedule clock above.
   */
  readonly executionStatusWriter: ExecutionStatusWriter;
  /**
   * The boot step of a composition that declares one organization
   * (boot/single-organization.ts): the organization's FULL create chain AS
   * THE CALLER compose.ts names (the operator's account under trusted-local,
   * the server acting as nobody under sign-in), so the role lifecycle and the
   * creator stamp say who made it.
   */
  readonly singleOrganizationCreator: SingleOrganizationCreator;
}

/**
 * The in-process wiring: the narrow typed clients above PLUS the transport
 * they ride. The transport is exposed because it is the one lane that can
 * reach EVERY service the routes closure registers — extension services
 * included — which the fixed client set
 * above cannot know about; it doubles as the extension test suite's
 * both-router visibility proof and stays behavior-identical to the
 * clients' own calls (same routes, same interceptor chain).
 */
export interface InProcessWiring {
  readonly clients: InProcessClients;
  readonly transport: Transport;
}

/**
 * Builds the in-process clients over a router transport that registers the
 * SAME routes and runs the SAME interceptor chain as the serving router —
 * validation parity is the point, exactly Go's bufconn shape.
 */
export function createInProcessClients(
  routes: (router: ConnectRouter) => void,
  logger: Logger,
  shared: SharedChainInterceptors = {},
): InProcessWiring {
  // Position 1 of this chain is the in-process identity stamper, NOT the
  // serving chassis: every call through this transport
  // carries the internal caller class, which only this chain can mint —
  // the TS rendering of the Java in-process authorization skip. Positions
  // 2–4 stay identical to the serving chain (validation parity).
  const transport = createRouterTransport(routes, {
    router: {
      interceptors: buildInterceptorChain(
        logger,
        createInProcessCallerInterceptor(),
        undefined,
        shared,
      ),
    },
  });

  const agentQuery = createClient(AgentQueryController, transport);
  const sessionCommand = createClient(SessionCommandController, transport);
  const sessionQuery = createClient(SessionQueryController, transport);
  const agentExecutionCommand = createClient(
    RunCommandController,
    transport,
  );
  const agentCommand = createClient(AgentCommandController, transport);
  const organizationCommand = createClient(
    OrganizationCommandController,
    transport,
  );
  const skillCommand = createClient(SkillCommandController, transport);
  const scoreCommand = createClient(ScoreCommandController, transport);

  // The caller-propagation call options (the Java posture restored): the
  // ORIGINAL caller's identity rides the
  // propagation header (the one client→router channel; contextValues are
  // server-side); the in-process position-1 interceptor decodes it and
  // stamps `origin: "in-process"` instead of minting internal. Explicit
  // per call, never ambient (identity is threaded, never global); the serving
  // chassis strips the header, so the wire cannot forge it.
  const asCaller = (caller: CallerIdentity): CallOptions => ({
    headers: { [IN_PROCESS_CALLER_HEADER]: encodeInProcessCaller(caller) },
  });

  const clients: InProcessClients = {
    // The agentexecution edges: reads stay under the internal class (the
    // daemon-safe default); the session CREATE propagates the original
    // caller so a session born during execution create carries its real
    // owner.
    executionAgentLoader: {
      get: (agentId) =>
        agentQuery.get(create(AgentIdSchema, { value: agentId })),
      getVersion: (agentId, versionHash) =>
        agentQuery.getVersion(
          create(GetAgentVersionInputSchema, { agentId, versionHash }),
        ),
    },
    executionSessionLoader: {
      get: (sessionId) =>
        sessionQuery.get(create(SessionIdSchema, { value: sessionId })),
    },
    executionSessionCreator: {
      createAsCaller: (session, caller) =>
        sessionCommand.create(session, asCaller(caller)),
    },
    // The server acting for itself: a check's verdict is the platform's,
    // and so is the removal of a deleted run's scores.
    scoreRecorder: {
      record: (score) => scoreCommand.create(score),
    },
    scoreDeleter: {
      delete: async (scoreId) => {
        await scoreCommand.delete(create(ScoreIdSchema, { value: scoreId }));
      },
    },
    judgeRunCreator: {
      create: (run, caller) =>
        agentExecutionCommand.create(
          run,
          caller === undefined ? undefined : asCaller(caller),
        ),
      terminate: async (runId, reason) => {
        await agentExecutionCommand.terminate(
          create(TerminateRunInputSchema, { id: runId, reason }),
        );
      },
    },
    judgeSessionDeleter: {
      delete: async (sessionId) => {
        await sessionCommand.delete(create(SessionIdSchema, { value: sessionId }));
      },
    },
    pluginEvalTries: {
      createSession: (session, caller) =>
        sessionCommand.create(
          session,
          caller === undefined ? undefined : asCaller(caller),
        ),
      createRun: (run, caller) =>
        agentExecutionCommand.create(
          run,
          caller === undefined ? undefined : asCaller(caller),
        ),
      terminateRun: async (runId, reason) => {
        await agentExecutionCommand.terminate(
          create(TerminateRunInputSchema, { id: runId, reason }),
        );
      },
    },
    // The schedule clock's fire edge — the plain Create RPC (Go's
    // ExecutionCreator). Every call through this transport
    // carries the internal caller class stamped at position 1; its audit
    // derivation equals the old process-global operator identity. A
    // composed fire caller (the scheduleFireCaller driver point)
    // propagates instead — the RunStarter mints it per
    // fire, so the created execution and its auto-created session carry
    // the edition's schedule identity (the asCaller lane).
    scheduleExecutionCreator: {
      create: (execution, fireCaller) =>
        agentExecutionCommand.create(
          execution,
          fireCaller === undefined ? undefined : asCaller(fireCaller),
        ),
    },
    // The worker's own-behalf status writes — the plain UpdateStatus RPC
    // under the internal class (never asCaller: the fallback is the
    // server's own reconciliation of a runner outcome, a daemon-origin
    // write with no original caller to propagate, exactly the schedule
    // clock's posture when no fire caller is composed).
    executionStatusWriter: {
      updateStatus: (input) => agentExecutionCommand.updateStatus(input),
    },
    singleOrganizationCreator: {
      createAsCaller: (organization, caller) =>
        organizationCommand.create(organization, asCaller(caller)),
    },
  };

  return { clients, transport };
}
