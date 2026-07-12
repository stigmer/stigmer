/**
 * Connect-RPC client for communicating with the Stigmer server.
 *
 * Provides typed wrappers around generated service stubs for RPCs the
 * runner needs: execution queries, status updates, session reads/writes,
 * and blueprint resolution (agent, skill, MCP server).
 *
 * Shared by all activities in the unified runner.
 */

import { createClient, type Client, type Transport } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import { AgentExecutionCommandController } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/command_pb";
import { AgentExecutionQueryController } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/query_pb";
import { ExecutionContextQueryController } from "@stigmer/protos/ai/stigmer/agentic/executioncontext/v1/query_pb";
import { SessionCommandController } from "@stigmer/protos/ai/stigmer/agentic/session/v1/command_pb";
import { SessionQueryController } from "@stigmer/protos/ai/stigmer/agentic/session/v1/query_pb";
import { AgentQueryController } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/query_pb";
import { AgentInstanceQueryController } from "@stigmer/protos/ai/stigmer/agentic/agentinstance/v1/query_pb";
import { McpServerQueryController } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/query_pb";
import { McpServerCommandController } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/command_pb";
import { ArtifactCommandController } from "@stigmer/protos/ai/stigmer/agentic/artifact/v1/command_pb";
import type { Artifact } from "@stigmer/protos/ai/stigmer/agentic/artifact/v1/api_pb";
import type { CreateArtifactInput } from "@stigmer/protos/ai/stigmer/agentic/artifact/v1/io_pb";
import { SkillQueryController } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/query_pb";
import { BillingCommandController } from "@stigmer/protos/ai/stigmer/billing/v1/command_pb";
import type { RecordLlmCallUsageInput, RecordLlmCallUsageResponse } from "@stigmer/protos/ai/stigmer/billing/v1/io_pb";
import type { AgentExecution, AgentExecutionStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import type { ExecutionContext } from "@stigmer/protos/ai/stigmer/agentic/executioncontext/v1/api_pb";
import { ExecutionContextExecutionIdInputSchema } from "@stigmer/protos/ai/stigmer/agentic/executioncontext/v1/io_pb";
import type { Session } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import type { AgentInstance } from "@stigmer/protos/ai/stigmer/agentic/agentinstance/v1/api_pb";
import type { McpServer } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import type { Skill } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/api_pb";
import type { ApiResourceReference } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import type { GetArtifactResponse } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/io_pb";
import { create } from "@bufbuild/protobuf";
import { ConnectInputSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/io_pb";
import { ExecutionValueSchema } from "@stigmer/protos/ai/stigmer/agentic/executioncontext/v1/spec_pb";
import { AgentExecutionUpdateStatusInputSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/io_pb";
import type { UpdateStatusResponse } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/io_pb";
import { WorkflowExecutionCommandController } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/command_pb";
import { WorkflowExecutionQueryController } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/query_pb";
import type { WorkflowExecution, WorkflowExecutionStatus } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import { WorkflowExecutionUpdateStatusInputSchema, GetEventLogRequestSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/io_pb";
import { WorkflowQueryController } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/query_pb";
import type { Workflow } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";
import { WorkflowInstanceQueryController } from "@stigmer/protos/ai/stigmer/agentic/workflowinstance/v1/query_pb";
import type { WorkflowInstance } from "@stigmer/protos/ai/stigmer/agentic/workflowinstance/v1/api_pb";
import { PlatformQueryController, GetRunnerScopedTokenInputSchema } from "@stigmer/protos/ai/stigmer/platform/v1/server_info_pb";
import { isEmbeddedRunnerToken } from "./token-claims.js";
import { assertCreateRequirements, assertReferenceRequirements } from "./server-contracts.js";

/**
 * Everything an embedded runner needs to bootstrap: Temporal coordinates plus
 * its own minted access token.
 *
 * The Temporal coordinates are always present. The access token is optional: the
 * server only mints one when it has a Cursor proxy to authenticate against
 * (cloud) and a signing key configured — OSS and misconfigured servers omit it,
 * and the runner keeps using its existing token in that case.
 */
export interface RunnerBootstrapConfig {
  temporalAddress: string;
  temporalNamespace: string;
  /** Minted iss=stigmer token for the runner's proxy traffic; absent when not minted. */
  runnerAccessToken?: string;
  /** Lifetime of {@link runnerAccessToken} in seconds; absent/0 when no token. */
  runnerAccessTokenExpiresInSeconds?: number;
}

/**
 * A runner token scoped to one unit of dispatched work (issue #156).
 *
 * Minted on demand by the control plane when the runner exchanges its
 * bootstrap credential at task start; presented for the ExecutionContext
 * fetch of exactly that execution. Absent when the server does not mint
 * (OSS, or no signing key) — the runner keeps its existing credential.
 */
export interface RunnerScopedToken {
  token: string;
  /** Lifetime in seconds from issuance; absent/0 when the server omitted it. */
  expiresInSeconds?: number;
}

/**
 * Names the unit of dispatched work a scoped runner token should serve.
 * Exactly one id must be set — mirrors the proto oneof.
 */
export type RunnerScopedTokenScope =
  | { agentExecutionId: string }
  | { workflowExecutionId: string };

/**
 * A shared mutable token reference. When provided, the interceptor
 * reads from this on every request, enabling token updates to
 * propagate to all clients sharing the same ref.
 */
export interface TokenRef {
  current: string | null;
}

export interface StigmerClientOptions {
  endpoint: string;
  token: string | null;
  tokenRef?: TokenRef;
  /**
   * Optional runner credential (a server-minted token with a runner-class
   * `token_type` claim). When populated, ExecutionContext reads authenticate
   * with this instead of the control-plane token — see the interceptor in the
   * constructor for why the credential differs per service.
   */
  runnerTokenRef?: TokenRef;
}

export class StigmerClient {
  readonly transport: Transport;
  private currentToken: string | null;
  private readonly executionQuery: Client<typeof AgentExecutionQueryController>;
  private readonly executionCommand: Client<typeof AgentExecutionCommandController>;
  private readonly executionContextQuery: Client<typeof ExecutionContextQueryController>;
  private readonly sessionQuery: Client<typeof SessionQueryController>;
  private readonly sessionCommand: Client<typeof SessionCommandController>;
  private readonly agentQuery: Client<typeof AgentQueryController>;
  private readonly agentInstanceQuery: Client<typeof AgentInstanceQueryController>;
  private readonly mcpServerQuery: Client<typeof McpServerQueryController>;
  private readonly mcpServerCommand: Client<typeof McpServerCommandController>;
  private readonly skillQuery: Client<typeof SkillQueryController>;
  private readonly billingCommand: Client<typeof BillingCommandController>;
  private readonly artifactCommand: Client<typeof ArtifactCommandController>;
  readonly workflowExecutionCommand: Client<typeof WorkflowExecutionCommandController>;
  private readonly workflowExecutionQuery: Client<typeof WorkflowExecutionQueryController>;
  private readonly workflowQuery: Client<typeof WorkflowQueryController>;
  private readonly workflowInstanceQuery: Client<typeof WorkflowInstanceQueryController>;
  private readonly platformQuery: Client<typeof PlatformQueryController>;

  private readonly tokenRef: TokenRef | null;
  private readonly runnerTokenRef: TokenRef | null;

  constructor(options: StigmerClientOptions) {
    this.currentToken = options.token;
    this.tokenRef = options.tokenRef ?? null;
    this.runnerTokenRef = options.runnerTokenRef ?? null;
    this.transport = createGrpcTransport({
      baseUrl: options.endpoint,
      interceptors: [
        // Credential selection lives here — one tested decision point — rather
        // than at call sites. Precedence:
        //
        // 1. An explicit per-call credential (an authorization header set via
        //    CallOptions) always wins. The scoped-token flow (issue #156)
        //    authenticates each ExecutionContext read with a token minted for
        //    that specific execution; concurrent sessions in one runner process
        //    make a shared mutable ref unusable for this — session A's read
        //    must never go out with session B's token.
        //
        // 2. The runner credential (runnerTokenRef) authenticates the services
        //    that require a runner-class token_type claim: ExecutionContext
        //    reads carry decrypted secrets on cloud, and the server gates that
        //    decrypt on runner class + scope (stigmer-cloud#152/#155); the
        //    scoped-token exchange itself requires the embedded_runner
        //    bootstrap credential (a desktop runner's control-plane token is
        //    the user's own Auth0 token, which the server correctly treats as
        //    a browsing user).
        //
        // 3. Everything else uses the control-plane token. Falls through
        //    unchanged when no runner token exists (OSS/local, where the
        //    server enforces no auth).
        (next) => async (req) => {
          if (req.header.has("authorization")) {
            return next(req);
          }
          const usesRunnerCredential =
            req.service.typeName === ExecutionContextQueryController.typeName ||
            (req.service.typeName === PlatformQueryController.typeName &&
              req.method.name === PlatformQueryController.method.getRunnerScopedToken.name);
          const token =
            (usesRunnerCredential ? this.runnerTokenRef?.current : null)
            ?? this.tokenRef?.current
            ?? this.currentToken;
          if (token) {
            req.header.set("authorization", `Bearer ${token}`);
          }
          return next(req);
        },
      ],
    });

    this.executionQuery = createClient(AgentExecutionQueryController, this.transport);
    this.executionCommand = createClient(AgentExecutionCommandController, this.transport);
    this.executionContextQuery = createClient(ExecutionContextQueryController, this.transport);
    this.sessionQuery = createClient(SessionQueryController, this.transport);
    this.sessionCommand = createClient(SessionCommandController, this.transport);
    this.agentQuery = createClient(AgentQueryController, this.transport);
    this.agentInstanceQuery = createClient(AgentInstanceQueryController, this.transport);
    this.mcpServerQuery = createClient(McpServerQueryController, this.transport);
    this.mcpServerCommand = createClient(McpServerCommandController, this.transport);
    this.skillQuery = createClient(SkillQueryController, this.transport);
    this.billingCommand = createClient(BillingCommandController, this.transport);
    this.artifactCommand = createClient(ArtifactCommandController, this.transport);
    this.workflowExecutionCommand = createClient(WorkflowExecutionCommandController, this.transport);
    this.workflowExecutionQuery = createClient(WorkflowExecutionQueryController, this.transport);
    this.workflowQuery = createClient(WorkflowQueryController, this.transport);
    this.workflowInstanceQuery = createClient(WorkflowInstanceQueryController, this.transport);
    this.platformQuery = createClient(PlatformQueryController, this.transport);
  }

  /**
   * Fetch this runner's bootstrap config from the control plane.
   *
   * Lets an embedded runner self-bootstrap from a token alone: the control
   * plane returns the Temporal frontend address and namespace for the
   * environment the token belongs to (so integrators never hardcode
   * infrastructure addresses) and, on cloud, a minted iss=stigmer access token
   * the runner uses for its proxy traffic. The token fields are absent when the
   * server does not mint one (OSS, or no signing key configured).
   */
  async getRunnerBootstrapConfig(): Promise<RunnerBootstrapConfig> {
    const res = await this.platformQuery.getRunnerBootstrapConfig({});
    return {
      temporalAddress: res.temporalAddress,
      temporalNamespace: res.temporalNamespace,
      // Empty proto string/0 means "not minted" — normalize to undefined so
      // callers branch on presence rather than emptiness.
      runnerAccessToken: res.runnerAccessToken || undefined,
      runnerAccessTokenExpiresInSeconds:
        res.runnerAccessTokenExpiresInSeconds || undefined,
    };
  }

  async getExecution(executionId: string): Promise<AgentExecution> {
    return this.executionQuery.get({ value: executionId });
  }

  async updateStatus(
    executionId: string,
    status: AgentExecutionStatus,
  ): Promise<UpdateStatusResponse> {
    const input = create(AgentExecutionUpdateStatusInputSchema, {
      executionId,
      status,
    });
    return this.executionCommand.updateStatus(input);
  }

  /**
   * Fetch the ExecutionContext for an execution.
   *
   * When a scoped runner token is supplied (issue #156), the read
   * authenticates with it per-call instead of the process-wide credential:
   * on cloud the decrypt gate releases secrets only to a runner token whose
   * scope binds it to this very execution, and one desktop runner process
   * serves many sessions concurrently, so the credential cannot live in a
   * shared ref.
   */
  async getExecutionContextByExecutionId(
    executionId: string,
    scopedToken?: string,
  ): Promise<ExecutionContext> {
    return this.executionContextQuery.getByExecutionId(
      create(ExecutionContextExecutionIdInputSchema, { executionId }),
      scopedToken
        ? { headers: { authorization: `Bearer ${scopedToken}` } }
        : undefined,
    );
  }

  /**
   * Exchange this runner's bootstrap credential for a token scoped to one
   * unit of dispatched work (issue #156).
   *
   * The call authenticates with the runner credential (see the interceptor);
   * the server verifies it is an embedded_runner token and that its identity
   * can view the named execution, then mints the same session/execution-scoped
   * sandbox token a cloud sandbox runner receives at provisioning. Returns
   * undefined when the server does not mint (OSS, or no signing key) —
   * presence-based, like the bootstrap token fields.
   */
  async getRunnerScopedToken(
    scope: RunnerScopedTokenScope,
  ): Promise<RunnerScopedToken | undefined> {
    const input = create(GetRunnerScopedTokenInputSchema,
      "agentExecutionId" in scope
        ? { scope: { case: "agentExecutionId", value: scope.agentExecutionId } }
        : { scope: { case: "workflowExecutionId", value: scope.workflowExecutionId } });
    const res = await this.platformQuery.getRunnerScopedToken(input);
    if (!res.runnerScopedToken) {
      return undefined;
    }
    return {
      token: res.runnerScopedToken,
      expiresInSeconds: res.expiresInSeconds || undefined,
    };
  }

  /**
   * Acquire a scoped runner token for an ExecutionContext read, if this
   * runner's credential situation calls for one.
   *
   * The gate is the credential itself: only an unscoped embedded_runner
   * bootstrap token needs exchanging. A cloud sandbox runner's credential is
   * already scoped (skip — the exchange would rightly refuse it), and an
   * OSS/local runner holds no runner-class credential at all (skip — the
   * server neither mints nor redacts).
   *
   * Failure falls back rather than failing the execution: returning undefined
   * makes the read authenticate with the bootstrap credential, which remains
   * decrypt-eligible until issue #156 item 3 removes it — at that point this
   * fallback stops yielding secrets and executions surface the warning below.
   */
  async acquireScopedRunnerToken(
    scope: RunnerScopedTokenScope,
  ): Promise<string | undefined> {
    if (!isEmbeddedRunnerToken(this.runnerTokenRef?.current)) {
      return undefined;
    }
    try {
      const scoped = await this.getRunnerScopedToken(scope);
      if (!scoped) {
        console.warn(
          "[stigmer-client] Server minted no scoped runner token; " +
          "falling back to the bootstrap credential for the ExecutionContext read",
        );
        return undefined;
      }
      return scoped.token;
    } catch (err) {
      console.warn(
        "[stigmer-client] Scoped runner token exchange failed; " +
        "falling back to the bootstrap credential for the ExecutionContext read: " +
        `${err instanceof Error ? err.message : err}`,
      );
      return undefined;
    }
  }

  async getSession(sessionId: string): Promise<Session> {
    return this.sessionQuery.get({ value: sessionId });
  }

  async updateSession(session: Session): Promise<Session> {
    return this.sessionCommand.update(session);
  }

  async getAgent(agentId: string): Promise<Agent> {
    return this.agentQuery.get({ value: agentId });
  }

  async getAgentInstance(instanceId: string): Promise<AgentInstance> {
    return this.agentInstanceQuery.get({ value: instanceId });
  }

  async getMcpServer(serverId: string): Promise<McpServer> {
    return this.mcpServerQuery.get({ value: serverId });
  }

  async getMcpServerByReference(ref: ApiResourceReference): Promise<McpServer> {
    return this.mcpServerQuery.getByReference(ref);
  }

  async connectMcpServer(
    mcpServerId: string,
    org: string,
    runtimeEnv?: Record<string, { value: string; isSecret: boolean }>,
  ): Promise<McpServer> {
    const input = create(ConnectInputSchema, {
      mcpServerId,
      org,
    });
    if (runtimeEnv) {
      for (const [key, entry] of Object.entries(runtimeEnv)) {
        input.runtimeEnv[key] = create(ExecutionValueSchema, {
          value: entry.value,
          isSecret: entry.isSecret,
        });
      }
    }
    return this.mcpServerCommand.connect(input);
  }

  async getSkill(skillId: string): Promise<Skill> {
    return this.skillQuery.get({ value: skillId });
  }

  async getSkillByReference(ref: ApiResourceReference): Promise<Skill> {
    return this.skillQuery.getByReference(ref);
  }

  async getSkillArtifact(artifactStorageKey: string): Promise<GetArtifactResponse> {
    return this.skillQuery.getArtifact({ artifactStorageKey });
  }

  async createArtifact(input: CreateArtifactInput): Promise<Artifact> {
    return this.artifactCommand.create(input);
  }

  async recordLlmCallUsage(input: RecordLlmCallUsageInput): Promise<RecordLlmCallUsageResponse> {
    return this.billingCommand.recordLlmCallUsage(input);
  }

  async getAgentByReference(ref: ApiResourceReference): Promise<Agent> {
    assertReferenceRequirements(ref, "Agent", "getAgentByReference");
    return this.agentQuery.getByReference(ref);
  }

  async createSession(session: Session): Promise<Session> {
    assertCreateRequirements(session, "Session", "createSession");
    return this.sessionCommand.create(session);
  }

  async applySession(session: Session): Promise<Session> {
    assertCreateRequirements(session, "Session", "applySession");
    return this.sessionCommand.apply(session);
  }

  async createAgentExecution(execution: AgentExecution): Promise<AgentExecution> {
    assertCreateRequirements(execution, "AgentExecution", "createAgentExecution");
    return this.executionCommand.create(execution);
  }

  async updateWorkflowExecutionStatus(
    executionId: string,
    status: WorkflowExecutionStatus,
    options?: {
      updatePendingApprovals?: boolean;
      updatePendingFileReviews?: boolean;
      // The child a per-child merge targets (required whenever either update flag
      // is set, including the scoped-clear case where the list is empty).
      pendingUpdateChildAgentExecutionId?: string;
    },
  ): Promise<WorkflowExecution> {
    const input = create(WorkflowExecutionUpdateStatusInputSchema, {
      executionId,
      status,
      updatePendingApprovals: options?.updatePendingApprovals ?? false,
      updatePendingFileReviews: options?.updatePendingFileReviews ?? false,
      pendingUpdateChildAgentExecutionId: options?.pendingUpdateChildAgentExecutionId ?? "",
    });
    return this.workflowExecutionCommand.updateStatus(input);
  }

  async getWorkflowExecution(executionId: string): Promise<WorkflowExecution> {
    return this.workflowExecutionQuery.get({ value: executionId });
  }

  /**
   * Return the highest persisted event sequence_number for a workflow execution.
   *
   * Paginates through getEventLog with the maximum page size (500) and
   * follows the cursor until has_more is false. The final page's
   * latest_sequence is the global high-water mark.
   *
   * Returns 0 when no events have been persisted yet (new execution).
   */
  async getEventLogHighWaterMark(executionId: string): Promise<bigint> {
    let afterSequence = BigInt(0);
    let highWaterMark = BigInt(0);

    for (;;) {
      const resp = await this.workflowExecutionQuery.getEventLog(
        create(GetEventLogRequestSchema, {
          executionId,
          afterSequence,
          pageSize: 500,
        }),
      );

      if (resp.latestSequence > highWaterMark) {
        highWaterMark = resp.latestSequence;
      }

      if (!resp.hasMore) {
        return highWaterMark;
      }

      afterSequence = resp.latestSequence;
    }
  }

  async getWorkflow(workflowId: string): Promise<Workflow> {
    return this.workflowQuery.get({ value: workflowId });
  }

  async getWorkflowVersion(workflowId: string, versionHash: string) {
    return this.workflowQuery.getVersion({ workflowId, versionHash });
  }

  async getWorkflowInstance(instanceId: string): Promise<WorkflowInstance> {
    return this.workflowInstanceQuery.get({ value: instanceId });
  }

  updateToken(token: string | null): void {
    this.currentToken = token;
  }
}
