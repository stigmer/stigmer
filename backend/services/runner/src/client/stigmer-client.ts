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
import { RunCommandController } from "@stigmer/apis/ai/stigmer/agentic/run/v1/command_pb";
import { RunQueryController } from "@stigmer/apis/ai/stigmer/agentic/run/v1/query_pb";
import { VaultValueController, FetchExecutionValuesInputSchema } from "@stigmer/apis/ai/stigmer/agentic/vault/v1/values_pb";
import type { File } from "@stigmer/apis/ai/stigmer/agentic/file/v1/api_pb";
import {
  CreateOutputUploadsInputSchema,
  MountRunFilesInputSchema,
  RegisterOutputsInputSchema,
  RunFileController,
  type FileMount,
  type OutputUpload,
} from "@stigmer/apis/ai/stigmer/agentic/file/v1/run_files_pb";
import type { ExecutionValues } from "@stigmer/apis/ai/stigmer/agentic/vault/v1/values_pb";
import { SessionCommandController } from "@stigmer/apis/ai/stigmer/agentic/session/v1/command_pb";
import { SessionQueryController } from "@stigmer/apis/ai/stigmer/agentic/session/v1/query_pb";
import { AgentQueryController } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/query_pb";
import { SkillQueryController } from "@stigmer/apis/ai/stigmer/agentic/skill/v1/query_pb";
import { PluginQueryController } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/query_pb";
import { EvalQueryController } from "@stigmer/apis/ai/stigmer/agentic/eval/v1/query_pb";
import { GetRunEvalCaseArchiveInputSchema, RunEvalCaseController } from "@stigmer/apis/ai/stigmer/agentic/eval/v1/run_eval_case_pb";
import type { EvalArchive, EvalArchiveDownloadUrl } from "@stigmer/apis/ai/stigmer/agentic/eval/v1/io_pb";
import type { Plugin } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/api_pb";
import type { GetArtifactResponse as GetPluginArtifactResponse, PluginArtifactDownloadUrl } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/io_pb";
import type { Run, RunStatus } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import type { Session } from "@stigmer/apis/ai/stigmer/agentic/session/v1/api_pb";
import type { SessionEvent } from "@stigmer/apis/ai/stigmer/agentic/session/v1/event_pb";
import type {
  AppendSessionEventsResponse,
  SessionEventPreview,
} from "@stigmer/apis/ai/stigmer/agentic/session/v1/io_pb";
import type { Agent } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/api_pb";
import type { AgentVersionEntry } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/version_pb";
import type { Skill } from "@stigmer/apis/ai/stigmer/agentic/skill/v1/api_pb";
import type { ApiResourceReference } from "@stigmer/apis/ai/stigmer/commons/apiresource/io_pb";
import type { GetArtifactResponse, SkillArtifactDownloadUrl } from "@stigmer/apis/ai/stigmer/agentic/skill/v1/io_pb";
import { create } from "@bufbuild/protobuf";
import { RunUpdateStatusInputSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/io_pb";
import type { UpdateStatusResponse } from "@stigmer/apis/ai/stigmer/agentic/run/v1/io_pb";
import { PlatformQueryController, GetRunnerScopedTokenInputSchema, TokenRenewalSchema } from "@stigmer/apis/ai/stigmer/platform/v1/server_info_pb";
import { ChannelMessageQueryController } from "@stigmer/apis/ai/stigmer/agentic/channel/v1/message_query_pb";
import type { ChannelTemplate, MessagingChannel } from "@stigmer/apis/ai/stigmer/agentic/channel/v1/message_io_pb";
import { TOKEN_TYPE_EMBEDDED_RUNNER, tokenTypeOf } from "./token-claims.js";
import { assertCreateRequirements, assertReferenceRequirements } from "./server-contracts.js";
import type { TokenRef } from "../config.js";
import { currentRunCredential } from "../shared/run-credential-store.js";

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
 * server only mints one when it has a model proxy to authenticate against
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
 * at all (oss#535) — and presented to fetch the values of exactly that
 * execution. Absent when the server does not mint (pre-oss#535 OSS, or
 * a refused credential class) — the runner keeps its existing credential.
 */
export interface RunnerScopedToken {
  token: string;
  /** Lifetime in seconds from issuance; absent/0 when the server omitted it. */
  expiresInSeconds?: number;
}

/**
 * The credential a call bound to one execution presents, with how long it
 * lives: `token` undefined means the ambient credential serves (an
 * already-scoped runner credential, which renews on its own), and
 * `expiresInSeconds` is set only for a clocked exchange token, which the
 * holder must renew before it lapses. A run credential has no expiry.
 */
export interface ScopedRunnerCredential {
  readonly token: string | undefined;
  readonly expiresInSeconds?: number;
}

/**
 * Names the unit of dispatched work a scoped runner token should serve.
 * Exactly one id must be set — mirrors the proto oneof.
 *
 * `renewal` is a live sandbox extending its own credential before expiry: no
 * id is named because every mint parameter comes from the presented
 * credential's verified claims (see sandbox-token-renewal.ts). The execution
 * arm remains embedded_runner-only.
 */
export type RunnerScopedTokenScope =
  | { agentExecutionId: string }
  | { renewal: true };

/**
 * Map the scope union onto the proto oneof init shape. The narrowing chain is
 * exhaustive: adding a variant to {@link RunnerScopedTokenScope} breaks the
 * final branch's type until it is mapped here.
 */
function toRunnerScopedTokenOneof(scope: RunnerScopedTokenScope) {
  if ("agentExecutionId" in scope) {
    return { case: "runId", value: scope.agentExecutionId } as const;
  }
  return { case: "renewal", value: create(TokenRenewalSchema) } as const;
}

/** The runner's shared credential reference (config.ts); re-exported for the client's callers. */
export type { TokenRef };

export interface StigmerClientOptions {
  endpoint: string;
  /**
   * A fixed credential, for a client whose credential never rotates (a
   * renewal client that authenticates each call explicitly passes `null`).
   * Runner activities pass {@link tokenRef} instead: the interceptor reads
   * it on every request, so one rotation reaches every client sharing it.
   */
  token?: string | null;
  tokenRef?: Readonly<TokenRef>;
  /**
   * Optional runner credential (a server-minted token with a runner-class
   * `token_type` claim). When populated, value fetches authenticate
   * with this instead of the control-plane token — see the interceptor in the
   * constructor for why the credential differs per service.
   */
  runnerTokenRef?: Readonly<TokenRef>;
}

export class StigmerClient {
  readonly transport: Transport;
  private readonly fixedToken: string | null;
  private readonly executionQuery: Client<typeof RunQueryController>;
  private readonly executionCommand: Client<typeof RunCommandController>;
  private readonly vaultValues: Client<typeof VaultValueController>;
  private readonly runFiles: Client<typeof RunFileController>;
  private readonly sessionQuery: Client<typeof SessionQueryController>;
  private readonly sessionCommand: Client<typeof SessionCommandController>;
  private readonly agentQuery: Client<typeof AgentQueryController>;
  private readonly skillQuery: Client<typeof SkillQueryController>;
  private readonly pluginQuery: Client<typeof PluginQueryController>;
  private readonly evalQuery: Client<typeof EvalQueryController>;
  private readonly runEvalCase: Client<typeof RunEvalCaseController>;
  private readonly platformQuery: Client<typeof PlatformQueryController>;
  private readonly channelMessageQuery: Client<typeof ChannelMessageQueryController>;

  private readonly tokenRef: Readonly<TokenRef> | null;
  private readonly runnerTokenRef: Readonly<TokenRef> | null;

  constructor(options: StigmerClientOptions) {
    this.fixedToken = options.token ?? null;
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
        //    authenticates each value fetch with a token minted for that
        //    specific execution; the renewal exchange presents the token
        //    being renewed; the connect lane hands its
        //    decrypt-lane token per call.
        //
        // 2. The run credential of the activity this request belongs to
        //    (shared/run-credential-store.ts), on every RPC that is about a
        //    run — which is every RPC but the process-bound bootstrap read.
        //    The server minted it for exactly this execution at dispatch and,
        //    with sign-in on, admits its bearer as the run's own human: the
        //    status write and the session title are the member's, whoever's API
        //    key this process holds. It is read from the async context, never
        //    from a ref: one process serves many runs at once and a shared ref
        //    would be the wrong run's the moment two overlap — the same reason
        //    rule 1 exists. Absent outside an activity and when the dispatch
        //    carried none (an older server; the cloud, whose runner credential
        //    is provisioned), so the rules below are exactly what they were.
        //
        // 3. The runner credential (runnerTokenRef) authenticates the services
        //    that require a runner-class token_type claim: a value fetch
        //    answers a run's secrets, and the server releases them only to a
        //    runner credential bound to that execution; the
        //    scoped-token exchange itself requires the embedded_runner
        //    bootstrap credential (a desktop runner's control-plane token is
        //    the user's own Auth0 token, which the server correctly treats as
        //    a browsing user).
        //
        // 4. Everything else uses the control-plane token: the process
        //    credential, an operator's API key on a self-host. Falls through
        //    unchanged when no runner token exists.
        (next) => async (req) => {
          if (req.header.has("authorization")) {
            return next(req);
          }
          const isProcessBound =
            req.service.typeName === PlatformQueryController.typeName &&
            req.method.name === PlatformQueryController.method.getRunnerBootstrapConfig.name;
          const usesRunnerCredential =
            req.service.typeName === VaultValueController.typeName ||
            req.service.typeName === RunFileController.typeName ||
            req.service.typeName === RunEvalCaseController.typeName ||
            (req.service.typeName === PlatformQueryController.typeName &&
              req.method.name === PlatformQueryController.method.getRunnerScopedToken.name);
          const token =
            (isProcessBound ? undefined : currentRunCredential())
            ?? (usesRunnerCredential ? this.runnerTokenRef?.current : null)
            ?? this.tokenRef?.current
            ?? this.fixedToken;
          if (token) {
            req.header.set("authorization", `Bearer ${token}`);
          }
          return next(req);
        },
      ],
    });

    this.executionQuery = createClient(RunQueryController, this.transport);
    this.executionCommand = createClient(RunCommandController, this.transport);
    this.vaultValues = createClient(VaultValueController, this.transport);
    this.runFiles = createClient(RunFileController, this.transport);
    this.sessionQuery = createClient(SessionQueryController, this.transport);
    this.sessionCommand = createClient(SessionCommandController, this.transport);
    this.agentQuery = createClient(AgentQueryController, this.transport);
    this.skillQuery = createClient(SkillQueryController, this.transport);
    this.pluginQuery = createClient(PluginQueryController, this.transport);
    this.evalQuery = createClient(EvalQueryController, this.transport);
    this.runEvalCase = createClient(RunEvalCaseController, this.transport);
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

  async getExecution(executionId: string): Promise<Run> {
    return this.executionQuery.get({ value: executionId });
  }

  async updateStatus(
    executionId: string,
    status: RunStatus,
  ): Promise<UpdateStatusResponse> {
    const input = create(RunUpdateStatusInputSchema, {
      runId: executionId,
      status,
    });
    return this.executionCommand.updateStatus(input);
  }

  /**
   * Fetch the values of a run or a tool connect from their vaults, grouped
   * by who declared them.
   *
   * When a scoped runner token is supplied (issue #156), the fetch
   * authenticates with it per-call instead of the process-wide credential:
   * the server answers only a runner credential bound to this very
   * execution and refuses every other caller, and one desktop runner
   * process serves many sessions concurrently, so the credential cannot
   * live in a shared ref.
   */
  async fetchExecutionValues(
    executionId: string,
    scopedToken?: string,
  ): Promise<ExecutionValues> {
    return this.vaultValues.fetchValues(
      create(FetchExecutionValuesInputSchema, { executionId }),
      scopedToken
        ? { headers: { authorization: `Bearer ${scopedToken}` } }
        : undefined,
    );
  }

  /**
   * The Files a run's conversation holds, each with where the agent finds
   * it under `.stigmer/uploads/` and a short-lived link to its bytes
   * (`shared/file-mount.ts`). Authenticated as {@link fetchExecutionValues}
   * is, and for the same reason: the server answers only a runner
   * credential acting for this very run.
   */
  async mountRunFiles(runId: string, scopedToken?: string): Promise<FileMount[]> {
    const answer = await this.runFiles.mount(
      create(MountRunFilesInputSchema, { runId }),
      scopedToken ? { headers: { authorization: `Bearer ${scopedToken}` } } : undefined,
    );
    return answer.entries;
  }

  /**
   * One upload link per output a turn saved (`shared/outputs.ts`), in the
   * request's order. Authenticated as {@link mountRunFiles} is.
   */
  async createOutputUploads(
    runId: string,
    entries: ReadonlyArray<{ readonly outputPath: string; readonly sizeBytes: number }>,
    scopedToken?: string,
  ): Promise<OutputUpload[]> {
    const answer = await this.runFiles.createOutputUploads(
      create(CreateOutputUploadsInputSchema, {
        runId,
        entries: entries.map((entry) => ({ outputPath: entry.outputPath, sizeBytes: BigInt(entry.sizeBytes) })),
      }),
      scopedToken ? { headers: { authorization: `Bearer ${scopedToken}` } } : undefined,
    );
    return answer.entries;
  }

  /**
   * Makes each uploaded output a File of the run's conversation, in the
   * request's order. Authenticated as {@link mountRunFiles} is.
   */
  async registerOutputs(
    runId: string,
    entries: ReadonlyArray<{ readonly outputPath: string; readonly uploadRef: string; readonly contentSha256: string }>,
    scopedToken?: string,
  ): Promise<File[]> {
    const answer = await this.runFiles.registerOutputs(
      create(RegisterOutputsInputSchema, { runId, entries: entries.map((entry) => ({ ...entry })) }),
      scopedToken ? { headers: { authorization: `Bearer ${scopedToken}` } } : undefined,
    );
    return answer.files;
  }

  /**
   * Exchange this runner's credential for a token scoped to one unit of
   * dispatched work (issue #156).
   *
   * The call authenticates with the runner credential (see the interceptor).
   * Cloud verifies it is an embedded_runner token and that its identity can
   * view the named execution, then mints the same session/execution-scoped
   * sandbox token a cloud sandbox runner receives at provisioning. An
   * open-source server with sign-in off mints an execution-scoped token for
   * any caller (oss#535 — there it only unlocks the value fetch); with
   * sign-in on the same token admits its bearer as the run's
   * human, so the exchange mints only for the run's own person (a missing
   * run NOT_FOUND, anyone else PERMISSION_DENIED). Runs normally receive
   * their credential from the dispatch itself (shared/run-credential.ts);
   * this exchange is the fallback. Returns undefined when the server does
   * not mint (pre-oss#535 OSS, or an unserved scope arm) — presence-based,
   * like the bootstrap token fields.
   *
   * `callerToken` authenticates the exchange per-call instead of the
   * process-wide runner credential. The sandbox credential renewal uses it
   * (sandbox-token-renewal.ts): the exchange authenticates with exactly the
   * credential being renewed, read at that cycle, not whichever credential
   * the interceptor would pick for this method.
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
   * Acquire a scoped runner token to fetch an execution's values, if this
   * runner's credential situation calls for one.
   *
   * When the activity this call belongs to carries a run credential (the
   * server minted it for this very execution at dispatch —
   * shared/run-credential.ts), that IS the scoped token: it is answered
   * without an RPC, and the exchange below serves only a dispatch that
   * carried none — an older server, or the cloud's provisioned runner.
   *
   * Otherwise the gate is the credential itself:
   *
   * 1. An already-scoped runner-class credential (a cloud sandbox or
   *    connect token) — skip; the exchange would rightly refuse it and the
   *    ambient credential is bound to its work on its own.
   *
   * 2. An unscoped embedded_runner bootstrap token, or no runner-class
   *    credential at all (OSS/local) — exchange it. A failed exchange, or a
   *    server that mints nothing, is a hard error naming the cause: the
   *    value fetch answers only a credential bound to the execution and
   *    refuses every other, so there is nothing to fall back to. The
   *    value-delivery call sites let this error end the turn; opportunistic
   *    consumers that can genuinely proceed without a scoped token
   *    (attachment credential, channel discovery) catch it at the call
   *    site, where their degrade-to-empty contract lives.
   */
  async acquireScopedRunnerToken(
    scope: RunnerScopedTokenScope,
  ): Promise<string | undefined> {
    return (await this.acquireScopedRunnerCredential(scope)).token;
  }

  /**
   * {@link acquireScopedRunnerToken}, with the token's lifetime: the same
   * chain, for a holder that keeps the credential for a long turn and must
   * renew a clocked exchange token before it lapses (the session event
   * emitter, `harness/events/emitter.ts`; stigmer#2455). The exchange's
   * token is minted for an hour; a run credential has no expiry.
   */
  async acquireScopedRunnerCredential(
    scope: RunnerScopedTokenScope,
  ): Promise<ScopedRunnerCredential> {
    const runCredential = currentRunCredential();
    if (runCredential !== undefined) {
      return { token: runCredential };
    }
    // Inspect the same credential chain the fetch's interceptor would use.
    const ambientTokenType = tokenTypeOf(
      this.runnerTokenRef?.current ?? this.tokenRef?.current ?? this.fixedToken,
    );
    if (ambientTokenType !== undefined && ambientTokenType !== TOKEN_TYPE_EMBEDDED_RUNNER) {
      return { token: undefined };
    }
    const scopeDescription =
      "agentExecutionId" in scope
        ? `agent execution ${scope.agentExecutionId}`
        : JSON.stringify(scope);
    let scoped: RunnerScopedToken | undefined;
    try {
      scoped = await this.getRunnerScopedToken(scope);
    } catch (err) {
      throw new Error(
        `Scoped runner token exchange failed for ${scopeDescription}: ` +
        `${err instanceof Error ? err.message : String(err)}. ` +
        "This runner holds no credential bound to the execution, so it cannot " +
        "fetch the execution's values until the exchange succeeds.",
      );
    }
    if (!scoped) {
      throw new Error(
        `Server minted no scoped runner token for ${scopeDescription}. ` +
        "This runner holds no credential bound to the execution, so it cannot " +
        "fetch the execution's values until the control plane mints scoped tokens.",
      );
    }
    return { token: scoped.token, ...(scoped.expiresInSeconds !== undefined ? { expiresInSeconds: scoped.expiresInSeconds } : {}) };
  }

  /**
   * The agent's serving proactive-messaging channels, as data — the
   * runner's tool-attachment
   * decision. An empty list is the everyday answer (most agents have no
   * proactive channel).
   *
   * When a scoped runner token is supplied, the read authenticates with
   * it per-call (the {@link fetchExecutionValues} precedent):
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
   * the `<available_channel_templates>` prompt section's source.
   * Entries carry the sendability verdict (`unsupportedReason`, empty
   * means sendable);
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

  /**
   * Append a run's events, and the live previews of what it is still
   * producing, to its session's log. The server admits only the runner
   * acting for that run: it decides the credential as a values fetch does,
   * so the caller passes the same scoped token
   * ({@link acquireScopedRunnerToken}); without one the request carries the
   * credential the interceptor chooses.
   */
  async appendSessionEvents(
    runId: string,
    events: readonly SessionEvent[],
    previews: readonly SessionEventPreview[],
    scopedToken?: string,
  ): Promise<AppendSessionEventsResponse> {
    return this.sessionCommand.appendEvents(
      { runId, events: [...events], previews: [...previews] },
      scopedToken ? { headers: { authorization: `Bearer ${scopedToken}` } } : undefined,
    );
  }

  /**
   * Take the messages queued in a run's session for the run to read
   * (`harness/turn-input.ts`): the server moves each to the head of the log
   * as this run's and answers them in the order sent. Admitted only for the
   * runner acting for the run, with the same scoped token an append carries.
   */
  async claimSessionInput(runId: string, scopedToken?: string): Promise<SessionEvent[]> {
    const response = await this.sessionCommand.claimInput(
      { runId },
      scopedToken ? { headers: { authorization: `Bearer ${scopedToken}` } } : undefined,
    );
    return response.events;
  }

  /**
   * Every event of one run in its session's log, oldest first, of `types`
   * when given (every type otherwise): what a resumed turn already sent, or
   * the answers the server recorded on its asks (`harness/approval-answers.ts`).
   * Pages to the end, at most 1000 a page.
   */
  async listRunSessionEvents(sessionId: string, runId: string, types: readonly string[] = []): Promise<SessionEvent[]> {
    const events: SessionEvent[] = [];
    let pageToken = "";
    do {
      const page = await this.sessionQuery.listEvents({ sessionId, runId, types: [...types], pageSize: 1000, pageToken });
      events.push(...page.events);
      pageToken = page.nextPageToken;
    } while (pageToken !== "");
    return events;
  }

  /**
   * Whether the log holds any event of one run of `types`: one page of at
   * most one event, so the answer costs the same however long the run is.
   * What a turn's start asks to learn whether an earlier invocation of the
   * run already wrote what its engine did (`harness/turn-context.ts`
   * `isReinvocation`).
   */
  async hasRunSessionEvent(sessionId: string, runId: string, types: readonly string[]): Promise<boolean> {
    const page = await this.sessionQuery.listEvents({ sessionId, runId, types: [...types], pageSize: 1, pageToken: "" });
    return page.events.length > 0;
  }

  /**
   * One page of a session's log, filtered by event type, in the order asked
   * for: the read a turn's start pages back through, newest first, to find
   * the undos still owed (`harness/owed-undos.ts`). The caller pages and
   * decides where to stop; the credential is the interceptor's, as for
   * {@link listRunSessionEvents}.
   */
  async listSessionEvents(
    sessionId: string,
    query: {
      readonly types: readonly string[];
      readonly order: "asc" | "desc";
      readonly pageSize: number;
      readonly pageToken: string;
    },
  ): Promise<{ readonly events: readonly SessionEvent[]; readonly nextPageToken: string }> {
    const page = await this.sessionQuery.listEvents({
      sessionId,
      types: [...query.types],
      order: query.order,
      pageSize: query.pageSize,
      pageToken: query.pageToken,
    });
    return { events: page.events, nextPageToken: page.nextPageToken };
  }

  /**
   * Race-safe, field-level subject write. The dedicated updateSubject RPC
   * exists precisely so concurrent writers (title generation vs a user
   * rename) never lose each other's updates — always prefer it for subject
   * changes.
   */
  async updateSessionSubject(sessionId: string, subject: string): Promise<Session> {
    return this.sessionCommand.updateSubject({ id: sessionId, subject });
  }

  async getAgent(agentId: string): Promise<Agent> {
    return this.agentQuery.get({ value: agentId });
  }

  /** One version of an agent, with its full spec: what a turn recorded on it runs. */
  async getAgentVersion(agentId: string, versionHash: string): Promise<AgentVersionEntry> {
    return this.agentQuery.getVersion({ agentId, versionHash });
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

  /**
   * Mint an HTTP download URL for a skill artifact (#675). Preferred over
   * getSkillArtifact for the actual bytes: the unary response is capped by
   * the server's 10MB gRPC message limit, while skills may be 100MB.
   * Throws ConnectError with Code.Unimplemented against servers that
   * predate the transfer lane — callers fall back to getSkillArtifact.
   */
  async getSkillArtifactDownloadUrl(artifactStorageKey: string): Promise<SkillArtifactDownloadUrl> {
    return this.skillQuery.getArtifactDownloadUrl({ artifactStorageKey });
  }

  async getPlugin(pluginId: string): Promise<Plugin> {
    return this.pluginQuery.get({ value: pluginId });
  }

  async getPluginByReference(ref: ApiResourceReference): Promise<Plugin> {
    return this.pluginQuery.getByReference(ref);
  }

  async getPluginArtifact(artifactStorageKey: string): Promise<GetPluginArtifactResponse> {
    return this.pluginQuery.getArtifact({ artifactStorageKey });
  }

  /**
   * Mint an HTTP download URL for a plugin archive, the skill lane's twin:
   * preferred over getPluginArtifact for the bytes, and answered
   * UNIMPLEMENTED by a server that predates it.
   */
  async getPluginArtifactDownloadUrl(artifactStorageKey: string): Promise<PluginArtifactDownloadUrl> {
    return this.pluginQuery.getArtifactDownloadUrl({ artifactStorageKey });
  }

  /**
   * Mint an HTTP download URL for one version of an Eval, named by its
   * reference (its id and the digest as the version). The server asks
   * can_view on the Eval first, of the run's caller, and signs the link for
   * a person's address; a server with no transfer lane answers
   * FAILED_PRECONDITION. A try reads its case through
   * {@link getRunEvalCaseArchiveDownloadUrl}, and through this only on a
   * server that predates that door.
   */
  async getEvalDownloadUrl(ref: ApiResourceReference): Promise<EvalArchiveDownloadUrl> {
    return this.evalQuery.getDownloadUrl(ref);
  }

  /**
   * Mint an HTTP download URL for the archive of the Eval version a run's
   * case names, signed for this runner's address: the run's own door,
   * which the server answers only to a runner credential acting for this
   * very run, authenticated as {@link mountRunFiles} is. The run's spec
   * names the Eval and its version, so the request names only the run. A
   * server that predates the door answers UNIMPLEMENTED; one with no
   * transfer lane, FAILED_PRECONDITION.
   */
  async getRunEvalCaseArchiveDownloadUrl(runId: string, scopedToken?: string): Promise<EvalArchiveDownloadUrl> {
    return this.runEvalCase.getArchiveDownloadUrl(
      create(GetRunEvalCaseArchiveInputSchema, { runId }),
      scopedToken ? { headers: { authorization: `Bearer ${scopedToken}` } } : undefined,
    );
  }

  /** One version of an Eval's archive inline, after the same can_view; capped by the gRPC message limit. */
  async downloadEval(ref: ApiResourceReference): Promise<EvalArchive> {
    return this.evalQuery.download(ref);
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
}
