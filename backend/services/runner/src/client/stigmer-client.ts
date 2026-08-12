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
import { context as otelContext, propagation } from "@opentelemetry/api";
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
import { WorkflowExecutionUpdateStatusInputSchema, GetEventLogRequestSchema, SendSignalInputSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/io_pb";
import type { JsonObject } from "@bufbuild/protobuf";
import { WorkflowQueryController } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/query_pb";
import type { Workflow } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";
import { WorkflowInstanceQueryController } from "@stigmer/protos/ai/stigmer/agentic/workflowinstance/v1/query_pb";
import type { WorkflowInstance } from "@stigmer/protos/ai/stigmer/agentic/workflowinstance/v1/api_pb";
import { PlatformQueryController, GetRunnerScopedTokenInputSchema, TokenRenewalSchema } from "@stigmer/protos/ai/stigmer/platform/v1/server_info_pb";
import { ChannelMessageQueryController } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/message_query_pb";
import type { ChannelTemplate, MessagingChannel } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/message_io_pb";
import { TOKEN_TYPE_EMBEDDED_RUNNER, tokenTypeOf } from "./token-claims.js";
import { assertCreateRequirements, assertReferenceRequirements } from "./server-contracts.js";

/**
 * Server-managed Temporal payload-encryption keys for this runner.
 *
 * Minted once per caller identity and persisted by the control plane, so
 * every boot of the same identity's runners receives the SAME key — the
 * persistence Temporal replay requires across runner restarts. The secondary
 * pair is present only during a rotation window (decrypt-only; new payloads
 * are written under the primary).
 */
export interface BootstrapPayloadEncryptionKeys {
  /** Base64-encoded 32-byte AES-256 key. */
  key: string;
  /** Key id stamped on payloads encrypted under {@link key}. */
  keyId: string;
  /** Previous key of this identity, present during rotation windows. */
  secondaryKey?: string;
  /** Key id of {@link secondaryKey}; present exactly when it is. */
  secondaryKeyId?: string;
}

/**
 * Everything an embedded runner needs to bootstrap: Temporal coordinates plus
 * its own minted access token.
 *
 * The Temporal coordinates are always present. The access token is optional: the
 * server only mints one when it has a Cursor proxy to authenticate against
 * (cloud) and a signing key configured — OSS and misconfigured servers omit it,
 * and the runner keeps using its existing token in that case. Payload-encryption
 * keys follow the same presence contract: absent when the server does not manage
 * runner keys (OSS uses env-configured keys; older cloud servers predate key
 * management).
 */
export interface RunnerBootstrapConfig {
  temporalAddress: string;
  temporalNamespace: string;
  /** Minted iss=stigmer token for the runner's proxy traffic; absent when not minted. */
  runnerAccessToken?: string;
  /** Lifetime of {@link runnerAccessToken} in seconds; absent/0 when no token. */
  runnerAccessTokenExpiresInSeconds?: number;
  /** Server-managed payload-encryption keys; absent when not managed by the server. */
  payloadEncryption?: BootstrapPayloadEncryptionKeys;
}

/**
 * A runner token scoped to one unit of dispatched work (issue #156).
 *
 * Minted on demand by the control plane at task start — a desktop runner
 * exchanges its bootstrap credential, an OSS runner asks with no credential
 * at all (oss#535) — and presented for the ExecutionContext fetch of exactly
 * that execution. Absent when the server does not mint (pre-oss#535 OSS, or
 * a refused credential class) — the runner keeps its existing credential.
 */
export interface RunnerScopedToken {
  token: string;
  /** Lifetime in seconds from issuance; absent/0 when the server omitted it. */
  expiresInSeconds?: number;
}

/**
 * Names the unit of dispatched work a scoped runner token should serve.
 * Exactly one id must be set — mirrors the proto oneof.
 *
 * `poolClaimSessionId` is the warm-pool attach exchange: a pool sandbox
 * presenting its pool_sandbox credential for the session it was claimed for
 * (the server authorizes against the claim record, not the caller's FGA
 * relations). `renewal` is a live sandbox extending its own credential
 * before expiry: no id is named because every mint parameter comes from the
 * presented credential's verified claims (see sandbox-token-renewal.ts).
 * The execution arms remain embedded_runner-only.
 */
export type RunnerScopedTokenScope =
  | { agentExecutionId: string }
  | { workflowExecutionId: string }
  | { poolClaimSessionId: string }
  | { renewal: true };

/**
 * Map the scope union onto the proto oneof init shape. The narrowing chain is
 * exhaustive: adding a variant to {@link RunnerScopedTokenScope} breaks the
 * final branch's type until it is mapped here.
 */
function toRunnerScopedTokenOneof(scope: RunnerScopedTokenScope) {
  if ("agentExecutionId" in scope) {
    return { case: "agentExecutionId", value: scope.agentExecutionId } as const;
  }
  if ("workflowExecutionId" in scope) {
    return { case: "workflowExecutionId", value: scope.workflowExecutionId } as const;
  }
  if ("poolClaimSessionId" in scope) {
    return { case: "poolClaim", value: { sessionId: scope.poolClaimSessionId } } as const;
  }
  return { case: "renewal", value: create(TokenRenewalSchema) } as const;
}

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
  private readonly channelMessageQuery: Client<typeof ChannelMessageQueryController>;

  private readonly tokenRef: TokenRef | null;
  private readonly runnerTokenRef: TokenRef | null;

  constructor(options: StigmerClientOptions) {
    this.currentToken = options.token;
    this.tokenRef = options.tokenRef ?? null;
    this.runnerTokenRef = options.runnerTokenRef ?? null;
    this.transport = createGrpcTransport({
      baseUrl: options.endpoint,
      interceptors: [
        // W3C trace-context propagation: stamps `traceparent` (and baggage)
        // from the active OTel context onto every outgoing RPC, so a runner
        // span and the server-side request span join into one distributed
        // trace (the server's GrpcRequestTraceIdInterceptor already parses
        // traceparent). When OTel is not initialized — the OSS default, no
        // OTEL_EXPORTER_OTLP_ENDPOINT — the global propagator is a no-op and
        // this adds nothing to the request.
        (next) => async (req) => {
          propagation.inject(otelContext.active(), req.header, {
            set: (carrier, key, value) => carrier.set(key, value),
          });
          return next(req);
        },
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
    this.channelMessageQuery = createClient(ChannelMessageQueryController, this.transport);
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
      // Same presence contract, grouped so callers make ONE presence check.
      // Key without id (or vice versa) is a server contract violation the
      // encryption config loader rejects — not silently dropped here, so the
      // breakage is diagnosable at the fail-closed boundary.
      payloadEncryption: res.payloadEncryptionKey
        ? {
            key: res.payloadEncryptionKey,
            keyId: res.payloadEncryptionKeyId,
            secondaryKey: res.payloadEncryptionSecondaryKey || undefined,
            secondaryKeyId: res.payloadEncryptionSecondaryKeyId || undefined,
          }
        : undefined,
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
   * Exchange this runner's credential for a token scoped to one unit of
   * dispatched work (issue #156).
   *
   * The call authenticates with the runner credential (see the interceptor).
   * Cloud verifies it is an embedded_runner token and that its identity can
   * view the named execution, then mints the same session/execution-scoped
   * sandbox token a cloud sandbox runner receives at provisioning. OSS mints
   * an execution-scoped token for any caller (oss#535 — a lane discriminator
   * on a single-user server, not a trust boundary). Returns undefined when
   * the server does not mint (pre-oss#535 OSS, or an unserved scope arm) —
   * presence-based, like the bootstrap token fields.
   *
   * `callerToken` authenticates the exchange per-call instead of the
   * process-wide runner credential. The warm-pool attach uses it: a pool
   * member exchanges with its pool_sandbox token, which is not the runner
   * credential the interceptor would pick for this method.
   */
  async getRunnerScopedToken(
    scope: RunnerScopedTokenScope,
    callerToken?: string,
  ): Promise<RunnerScopedToken | undefined> {
    const input = create(GetRunnerScopedTokenInputSchema, {
      scope: toRunnerScopedTokenOneof(scope),
    });
    const res = await this.platformQuery.getRunnerScopedToken(
      input,
      callerToken
        ? { headers: { authorization: `Bearer ${callerToken}` } }
        : undefined,
    );
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
   * The gate is the credential itself, three ways:
   *
   * 1. An unscoped embedded_runner bootstrap token MUST be exchanged, and a
   *    failed exchange is a hard error, not a fallback: since the #156
   *    item-3 flip (stigmer-cloud#218) the bootstrap credential no longer
   *    decrypts, so a read that "fell back" would silently receive redacted
   *    placeholders and the execution would run against junk secret values —
   *    strictly worse than failing here with the real reason. The
   *    secret-delivery call sites let this error fail the activity;
   *    opportunistic consumers that can genuinely proceed without a scoped
   *    token (attachment credential, channel discovery) catch it at the
   *    call site, where their degrade-to-empty contract lives.
   *
   * 2. Any other runner-class credential is already scoped (a cloud
   *    sandbox/pool/connect token) — skip; the exchange would rightly
   *    refuse it and the ambient credential decrypts on its own.
   *
   * 3. No runner-class credential at all (OSS/local, where the process
   *    token is absent or carries no token_type claim) — attempt the
   *    exchange best-effort (oss#535): a current OSS server mints an
   *    execution-scoped token here, which is the ONLY way this runner can
   *    read decrypted secrets from its redact-by-default EC RPCs. A server
   *    that answers "not minted" (pre-oss#535 OSS, which also does not
   *    redact) or refuses the exchange (cloud refusing a non-runner
   *    credential — the legacy desktop degrade, which reads redacted today
   *    regardless) falls through to the tokenless read, preserving each
   *    old pairing's exact behavior.
   */
  async acquireScopedRunnerToken(
    scope: RunnerScopedTokenScope,
  ): Promise<string | undefined> {
    // Inspect the same credential chain the EC read's interceptor would use.
    const ambientTokenType = tokenTypeOf(
      this.runnerTokenRef?.current ?? this.tokenRef?.current ?? this.currentToken,
    );
    const isEmbeddedRunner = ambientTokenType === TOKEN_TYPE_EMBEDDED_RUNNER;
    if (ambientTokenType !== undefined && !isEmbeddedRunner) {
      // Case 2: an already-scoped runner-class credential.
      return undefined;
    }
    const scopeDescription =
      "agentExecutionId" in scope
        ? `agent execution ${scope.agentExecutionId}`
        : "workflowExecutionId" in scope
          ? `workflow execution ${scope.workflowExecutionId}`
          : JSON.stringify(scope);
    let scoped: RunnerScopedToken | undefined;
    try {
      scoped = await this.getRunnerScopedToken(scope);
    } catch (err) {
      if (!isEmbeddedRunner) {
        // Case 3: best-effort — a refusal means the server does not serve
        // this credential class; the tokenless read is today's behavior.
        return undefined;
      }
      throw new Error(
        `Scoped runner token exchange failed for ${scopeDescription}: ` +
        `${err instanceof Error ? err.message : String(err)}. ` +
        "The bootstrap credential cannot read ExecutionContext secrets " +
        "(stigmer-cloud#218), so this runner cannot serve the execution " +
        "until the exchange succeeds.",
      );
    }
    if (!scoped) {
      if (!isEmbeddedRunner) {
        // Case 3: a server that mints nothing for this scope also does not
        // redact for this runner (pre-oss#535 OSS) — proceed tokenless.
        return undefined;
      }
      throw new Error(
        `Server minted no scoped runner token for ${scopeDescription}. ` +
        "The bootstrap credential cannot read ExecutionContext secrets " +
        "(stigmer-cloud#218), so this runner cannot serve the execution " +
        "until the control plane mints scoped tokens.",
      );
    }
    return scoped.token;
  }

  /**
   * The agent's serving proactive-messaging channels, as data
   * (proactive-messaging DD-006 D2) — the runner's tool-attachment
   * decision. An empty list is the everyday answer (most agents have no
   * proactive channel).
   *
   * When a scoped runner token is supplied, the read authenticates with
   * it per-call (the {@link getExecutionContextByExecutionId} precedent):
   * the messaging reach refuses the desktop runner's ambient
   * embedded_runner credential outright, and one desktop runner process
   * serves many sessions concurrently, so the credential cannot live in
   * a shared ref. A cloud sandbox runner's ambient credential is already
   * the session-scoped token; OSS sends nothing and answers empty.
   */
  async listMessagingChannels(scopedToken?: string): Promise<MessagingChannel[]> {
    const res = await this.channelMessageQuery.listMessagingChannels(
      {},
      scopedToken
        ? { headers: { authorization: `Bearer ${scopedToken}` } }
        : undefined,
    );
    return res.entries;
  }

  /**
   * The channel's provider template registry, approved entries only —
   * the `<available_channel_templates>` prompt section's source
   * (proactive-messaging DD-003 D5). Entries carry the DD-006 D1
   * sendability verdict (`unsupportedReason`, empty means sendable);
   * the section formatter filters on it. Credential rules as
   * {@link listMessagingChannels}.
   */
  async listChannelTemplates(channel: string, scopedToken?: string): Promise<ChannelTemplate[]> {
    const res = await this.channelMessageQuery.listTemplates(
      { channel, approvedOnly: true },
      scopedToken
        ? { headers: { authorization: `Bearer ${scopedToken}` } }
        : undefined,
    );
    return res.entries;
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

  /**
   * Deliver a named signal to another workflow execution through the
   * server's SendSignal lane (validate → phase gate → relay via the
   * outer orchestrator). This is the ONLY sanctioned path for
   * runner-originated signals: a direct Temporal client would bypass
   * both the authorization boundary and the payload-encryption design
   * (per-identity runner keys make sender-side encryption fail closed
   * at receivers holding a different key — see oss#517).
   *
   * Deliberately sends no idempotency_key: the server's dedupe claim is
   * not released when delivery fails (oss#442), so a key here would
   * poison the exact retry it exists to protect — and emit envelope ids
   * regenerate per activity attempt anyway. Revisit once oss#442 lands.
   */
  async sendWorkflowSignal(
    executionId: string,
    signalName: string,
    payload: JsonObject | undefined,
    options?: { timeoutMs?: number },
  ): Promise<WorkflowExecution> {
    const input = create(SendSignalInputSchema, {
      executionId,
      signalName,
      payload,
    });
    return this.workflowExecutionCommand.sendSignal(input, {
      timeoutMs: options?.timeoutMs,
    });
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
