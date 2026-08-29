/**
 * McpServer connect (blocking lane) + the shared connect machinery —
 * ports pkg/domain/mcpserver/controller/connect.go: the Connect RPC,
 * prepareConnect (OAuth refresh pre-flight, ephemeral ExecutionContext,
 * decrypt-lane token minting), environment resolution, the workflow
 * failure→gRPC mapping, and apply's best-effort auto-connect tail. The
 * async lane lives in start-connect.ts; the connect_status persistence
 * family in connect-status.ts.
 *
 * Discovery runs on the RUNNER: this module starts the runner's
 * stigmer/mcp-server/connect workflow through the engine seam
 * (engine.ts) and never registers a worker.
 *
 * Proven by mcpserver-connect.conformance.test.ts
 * (CONFORMANCE_TARGET=local-execution) and __tests__/connect.test.ts.
 */
import { create } from "@bufbuild/protobuf";
import type { MessageInitShape } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { randomUUID } from "node:crypto";

import type {
  EnvironmentList,
  EnvironmentSecretValueInputSchema,
  ListEnvironmentsRequestSchema,
} from "@stigmer/protos/ai/stigmer/agentic/environment/v1/io_pb";
import type {
  EnvironmentValue as EnvironmentSpecValue,
  EnvVarDeclaration,
} from "@stigmer/protos/ai/stigmer/agentic/environment/v1/spec_pb";
import { EnvironmentValueSchema } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/spec_pb";
import type { ExecutionContext } from "@stigmer/protos/ai/stigmer/agentic/executioncontext/v1/api_pb";
import { ExecutionContextSchema } from "@stigmer/protos/ai/stigmer/agentic/executioncontext/v1/api_pb";
import type { ExecutionValue } from "@stigmer/protos/ai/stigmer/agentic/executioncontext/v1/spec_pb";
import { ExecutionValueSchema } from "@stigmer/protos/ai/stigmer/agentic/executioncontext/v1/spec_pb";
import type { McpServer } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { McpServerSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { McpServerCommandController } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/command_pb";
import type { ConnectInput } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/io_pb";
import type { ApiResourceDeleteInputSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { TokenEndpointAuthMethod } from "@stigmer/protos/ai/stigmer/iam/oauthapp/v1/spec_pb";

import type { Logger } from "../../boot/logger.js";
import type { Authorizer } from "../../extensions/authorizer.js";
import type { CallerIdentity } from "../../extensions/identity.js";
import { authorizeDirect } from "../../pipeline/steps/authorize.js";
import type { SecretService } from "../../encryption/encryption.js";
import {
  failedPreconditionError,
  internalError,
  notFoundError,
  invalidArgumentError,
  unavailableError,
} from "../../pipeline/errors.js";
import type { RunnerCredentialProvider } from "../../runnerauth/runner-credential-provider.js";
import { TOKEN_TYPE_EXECUTION_SCOPED } from "../../runnerauth/runnerauth.js";
import type {
  OAuthGrantStore,
  PendingOAuthStateStore,
  Store,
} from "../../store/interface.js";
import { ResourceNotFoundError } from "../../store/interface.js";
import { resolveOAuthAppRef } from "../oauthapp/refresolution.js";
import {
  persistConnectFailure,
  persistConnectResult,
  persistConnectStarting,
} from "./connect-status.js";
import type {
  ConnectRun,
  ConnectRunFailure,
  ConnectWorkflowInput,
  McpServerEngineStateProvider,
} from "./engine.js";
import { refreshTokenIfExpired } from "./oauth/refresh.js";
import {
  TOKEN_AUTH_METHOD_BASIC,
  TOKEN_AUTH_METHOD_POST,
} from "./oauth/token.js";
import type { ManagedEnvironmentService } from "./oauth/managed-env.js";

/**
 * A connect budget: the workflow run timeout in milliseconds plus its Go
 * time.Duration String() rendering — the DEADLINE_EXCEEDED copy names the
 * budget that fired, and the string must match Go's %s byte-for-byte.
 */
export interface ConnectBudget {
  readonly ms: number;
  readonly goLabel: string;
}

/**
 * The connect workflow's WorkflowRunTimeout — the total budget for
 * discovery + tool-approval classification. Sized from the runner's own
 * bounds (issue #243): the 270s stdio init allowance (STDIO_INIT_TIMEOUT_MS
 * in activities/discover-mcp-server.ts — a first run may download and
 * compile packages via npx/uvx/go run) + the 120s classification floor
 * (classifyWithTimeout in workflows/connect-mcp-server.ts) + margin for
 * tool listing and persistence. Anything smaller makes the runner's
 * cold-start allowance — and its actionable timeout error — unreachable by
 * construction, which is exactly how the pre-#243 45s value killed every
 * heavy stdio connect.
 *
 * Deliberately NOT sized for classification retries (maximumAttempts: 2)
 * or >~160-tool stdio servers, whose budgets scale past any flat ceiling —
 * async/pollable discovery is the cure for those, not a longer wait.
 *
 * Trade-off, accepted: this is also the bound on "no runner ever picked up
 * the task", so a connect against a dead runner now waits the full budget
 * before DEADLINE_EXCEEDED. The local daemon supervises the runner
 * (crash-restart), making that state pathological rather than designed; a
 * CLI --timeout remains the caller's soft bound.
 */
export const CONNECT_TIMEOUT: ConnectBudget = {
  ms: 420_000,
  goLabel: "7m0s",
};

/**
 * The WorkflowRunTimeout for connects started through the async lane
 * (startConnect), where no client blocks on the result and the ceiling is
 * a backstop rather than anyone's wait.
 *
 * Sized generously above the activity budgets that do the real
 * budget-keeping (discovery hard-bounded at 600s; classification scales
 * max(120, (n/40+1)*60)s with up to 2 attempts): one hour covers the
 * discovery bound plus two classification attempts for servers up to
 * ~800 tools — well past anything in the wild. Beyond that a flat
 * backstop becomes the limiting factor again; if such a server ever
 * exists, the ceiling should turn into a value derived from the
 * discovered tool count, not a bigger constant.
 *
 * The dead-runner concern that shaped CONNECT_TIMEOUT does not apply
 * here: the async lane surfaces "no worker is polling" as a start-time
 * warning on ConnectStatus instead of making a client wait to find out.
 */
export const ASYNC_CONNECT_TIMEOUT: ConnectBudget = {
  ms: 60 * 60 * 1000,
  goLabel: "1h0m0s",
};

/**
 * Added to a budget to bound a settle task's wait on the workflow result.
 * The workflow's own WorkflowRunTimeout is the deadline that should fire
 * first; this slightly longer bound is only a backstop so a settle task
 * can never hang if Temporal becomes unreachable (Go
 * bestEffortConnectGetBuffer).
 */
export const BEST_EFFORT_CONNECT_GET_BUFFER_MS = 15_000;

/** The label selecting the user's personal environment (connect.go:74). */
export const PERSONAL_ENV_LABEL = "stigmer.ai/personal";

/**
 * The narrow environment read surface the connect lanes consume for
 * personal-environment resolution — satisfied by the composition root's
 * in-process clients (DD-002: full interceptor traversal).
 */
export interface ConnectEnvironmentReader {
  list(
    request: MessageInitShape<typeof ListEnvironmentsRequestSchema>,
  ): Promise<EnvironmentList>;
  getSecretValue(
    input: MessageInitShape<typeof EnvironmentSecretValueInputSchema>,
  ): Promise<EnvironmentSpecValue>;
}

/**
 * The ExecutionContext lifecycle surface for the ephemeral connect EC —
 * Go's downstream executioncontext client (create + delete).
 */
export interface ConnectExecutionContextClient {
  create(
    executionContext: MessageInitShape<typeof ExecutionContextSchema>,
  ): Promise<ExecutionContext>;
  delete(
    input: MessageInitShape<typeof ApiResourceDeleteInputSchema>,
  ): Promise<ExecutionContext>;
}

/**
 * Dependencies of the connect/OAuth slice — Go's optional
 * SetConnectDependencies/SetOAuthDependencies fields, made REQUIRED
 * constructor-style parameters per the composition-root idiom
 * (guidelines §4): "Temporal is down" is the engine-state provider's
 * modeled state, never a missing dependency. Ratified DB-1 consequence:
 * the OAuth RPCs (managed-env service included) work on a Temporal-less
 * server where Go's composition gate refuses completeOAuthConnect —
 * disclosed, deliberately unpinned divergence.
 */
export interface McpServerConnectDeps {
  readonly store: Store;
  readonly logger: Logger;
  /**
   * The composed authorization seam — every connect-family lane evaluates
   * its can_connect/can_view annotation (the Java handlers' bespoke
   * authorize steps carry the same config; C2 Stage 4).
   */
  readonly authorizer: Authorizer;
  readonly engineState: McpServerEngineStateProvider;
  readonly environmentReader: ConnectEnvironmentReader;
  readonly executionContext: ConnectExecutionContextClient;
  readonly runnerAuth: RunnerCredentialProvider;
  readonly managedEnv: ManagedEnvironmentService;
  readonly oauthGrants: OAuthGrantStore;
  readonly pendingOAuthStates: PendingOAuthStateStore;
  readonly secretService: SecretService;
  readonly oauthRedirectUri: string;
}

/**
 * Everything prepareConnect resolves for a connect lane: the slim
 * workflow input plus the ephemeral EC coordinates for cleanup.
 */
interface PreparedConnect {
  readonly workflowInput: ConnectWorkflowInput;
  readonly ecResourceId: string;
  readonly executionId: string;
}

/**
 * Connect — triggers server-side MCP discovery and tool approval
 * classification via the runner's Temporal workflow, blocking until the
 * operation settles (Go Connect, connect.go:165).
 *
 * Lifecycle: prepareConnect → start-or-attach → record CONNECTING (the
 * same bookkeeping the async lane does, so observers see one consistent
 * record regardless of which lane ran) → block on the result → persist
 * capabilities + classifier output + terminal phase atomically → delete
 * the ExecutionContext. Prefer startConnect for interactive clients: this
 * RPC's response can outlive browser transport limits.
 */
export async function connect(
  deps: McpServerConnectDeps,
  input: ConnectInput,
  identity: CallerIdentity,
): Promise<McpServer> {
  const engineState = deps.engineState();
  if (!engineState.connected) {
    throw failedPreconditionError(
      "connect is not available: Temporal not configured",
    );
  }

  const mcpServerId = input.mcpServerId;
  if (mcpServerId === "") {
    throw invalidArgumentError("mcp_server_id is required");
  }
  if (input.org === "") {
    throw invalidArgumentError("org is required for connect");
  }

  let mcpServer: McpServer;
  try {
    mcpServer = await deps.store.getResource(
      ApiResourceKind.mcp_server,
      mcpServerId,
      McpServerSchema,
    );
  } catch {
    throw notFoundError("mcp_server", mcpServerId);
  }

  // The annotation's can_connect check AFTER the load — the Java
  // McpServerConnectHandler order (load-before-authorize, stigmer#224).
  // C2 Stage 4.
  await authorizeDirect(
    McpServerCommandController.method.connect,
    deps.authorizer,
    identity,
    input,
  );

  const prepared = await prepareConnect(deps, mcpServer, input);

  try {
    let run: ConnectRun;
    try {
      run = await engineState.engine.startOrAttachConnect(
        mcpServerId,
        prepared.workflowInput,
        CONNECT_TIMEOUT.ms,
      );
    } catch (error) {
      deps.logger.error("Failed to start MCP connect workflow", {
        mcp_server_id: mcpServerId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw internalError(error, "failed to start connect workflow");
    }

    // Record the operation on connect_status. Skipped when attached: the
    // lane that started the run already recorded it, and overwriting
    // would reset its started_at. Best-effort — the blocking caller
    // learns the outcome from this RPC's response either way.
    if (!run.attached) {
      try {
        await persistConnectStarting(deps.store, mcpServerId, run.workflowId, "");
      } catch (error) {
        deps.logger.warn(
          "Failed to record CONNECTING on connect_status (non-fatal)",
          {
            mcp_server_id: mcpServerId,
            error: error instanceof Error ? error.message : String(error),
          },
        );
      }
    }

    // Bounded even on the blocking lane: Go's wait rides the RPC context
    // (unbounded when Temporal dies mid-await); here the budget+buffer
    // race answers Internal instead of hanging the handler forever —
    // unreachable while Temporal is alive, disclosed as a bounded-wait
    // delta.
    const outcome = await run.result(
      CONNECT_TIMEOUT.ms + BEST_EFFORT_CONNECT_GET_BUFFER_MS,
    );
    if (!outcome.ok) {
      const failure = mapConnectFailure(
        deps.logger,
        mcpServer,
        run.workflowId,
        outcome.failure,
        CONNECT_TIMEOUT,
      );
      await persistConnectFailure(deps.store, deps.logger, mcpServerId, failure);
      throw failure;
    }

    // Persist discovered capabilities + the connect-time classifier
    // output (layer 1 of the approval policy chain) atomically. The
    // freshly-read, updated resource is returned to the caller.
    let persisted: McpServer;
    let toolApprovalCount: number;
    try {
      ({ persisted, toolApprovalCount } = await persistConnectResult(
        deps.store,
        mcpServerId,
        run.workflowId,
        outcome.output,
      ));
    } catch (error) {
      throw internalError(error, "failed to save mcp server after connect");
    }

    deps.logger.info("MCP server connect completed and stored", {
      mcp_server_id: mcpServerId,
      tools: persisted.status?.discoveredCapabilities?.tools.length ?? 0,
      resource_templates:
        persisted.status?.discoveredCapabilities?.resourceTemplates.length ?? 0,
      tool_approvals: toolApprovalCount,
    });

    return persisted;
  } finally {
    if (prepared.ecResourceId !== "") {
      await deleteConnectExecutionContext(
        deps,
        prepared.ecResourceId,
        prepared.executionId,
      );
    }
  }
}

/**
 * The caller-context half of a connect: the OAuth refresh pre-flight,
 * ephemeral ExecutionContext creation, and decrypt-lane token minting
 * (Go prepareConnect).
 *
 * Both the blocking (connect) and async (startConnect) lanes run this
 * synchronously inside the RPC handler, because everything here needs the
 * caller's identity: OAuth refresh and personal-environment resolution
 * read the caller's grant and secrets, which a background task has no
 * request context to do (the same constraint that scopes
 * startBestEffortConnect to env-less servers).
 */
export async function prepareConnect(
  deps: McpServerConnectDeps,
  mcpServer: McpServer,
  input: ConnectInput,
): Promise<PreparedConnect> {
  const mcpServerId = mcpServer.metadata?.id ?? "";
  const callerOrg = input.org;

  // Pre-flight: refresh expired OAuth tokens before env resolution. Only
  // applies when runtime_env is empty and the MCP server has an auth
  // block with an existing OAuthGrant. Tokens are refreshed in the
  // grant's managed environment.
  if (Object.keys(input.runtimeEnv).length === 0) {
    await refreshOAuthTokenIfNeeded(deps, mcpServer, callerOrg);
  }

  const executionId = `connect-${mcpServerId}-${randomUUID().slice(0, 8)}`;

  const ecResourceId = await createConnectExecutionContext(
    deps,
    mcpServer,
    executionId,
    callerOrg,
    input.runtimeEnv,
  );

  const workflowInput: ConnectWorkflowInput = {
    mcp_server_id: mcpServerId,
    ...(ecResourceId !== "" ? { execution_context_id: executionId } : {}),
  };

  // Mint the decrypt-lane token for the EC just created (oss#535) — see
  // the engine.ts ConnectWorkflowInput doc for why this rides the
  // payload. Minting failure degrades, not fails: discovery of a server
  // with declared credentials will refuse the redacted read with an
  // actionable error, and credential-less servers connect fine without
  // the token.
  if (
    ecResourceId !== "" &&
    deps.runnerAuth.isEnabled(TOKEN_TYPE_EXECUTION_SCOPED)
  ) {
    try {
      const minted = deps.runnerAuth.mint(
        TOKEN_TYPE_EXECUTION_SCOPED,
        executionId,
        0,
      );
      return {
        workflowInput: {
          ...workflowInput,
          execution_context_token: minted.token,
        },
        ecResourceId,
        executionId,
      };
    } catch (error) {
      deps.logger.warn(
        "Failed to mint connect EC token — discovery will read redacted credentials",
        {
          execution_id: executionId,
          error: error instanceof Error ? error.message : String(error),
        },
      );
    }
  }

  return { workflowInput, ecResourceId, executionId };
}

/**
 * Builds and persists an ephemeral ExecutionContext for the connect
 * activity (Go createConnectExecutionContext).
 *
 * When runtime_env is provided, the values are used directly (one-time
 * use). When runtime_env is empty, variables are resolved from two
 * sources: OAuth-managed variables from the grant's managed environment,
 * the remainder from the user's personal environment. Returns "" when the
 * MCP server has no env declarations and no runtime_env.
 */
async function createConnectExecutionContext(
  deps: McpServerConnectDeps,
  mcpServer: McpServer,
  executionId: string,
  callerOrg: string,
  runtimeEnv: { [key: string]: ExecutionValue },
): Promise<string> {
  let ecData: { [key: string]: ExecutionValue };

  if (Object.keys(runtimeEnv).length > 0) {
    ecData = runtimeEnv;
    deps.logger.info(
      "Using runtime_env for connect ExecutionContext (one-time use)",
      {
        execution_id: executionId,
        runtime_env_count: Object.keys(runtimeEnv).length,
      },
    );
  } else {
    const envDecls = mcpServer.spec?.env ?? {};
    if (Object.keys(envDecls).length === 0) {
      deps.logger.debug(
        "MCP server has no env declarations — skipping ExecutionContext creation",
        { execution_id: executionId },
      );
      return "";
    }

    const mcpServerId = mcpServer.metadata?.id ?? "";

    // Split resolution: OAuth vars from managed env, rest from personal.
    const { oauthVars, remainingDecls } = await resolveOAuthVarsFromManagedEnv(
      deps,
      mcpServerId,
      callerOrg,
      envDecls,
    );

    let personalVars: { [key: string]: ExecutionValue } = {};
    if (Object.keys(remainingDecls).length > 0) {
      personalVars = await resolveFromPersonalEnvironment(
        deps,
        callerOrg,
        remainingDecls,
      );
    }

    ecData = { ...personalVars, ...oauthVars };

    deps.logger.info("Resolved env vars for connect ExecutionContext", {
      execution_id: executionId,
      oauth_count: Object.keys(oauthVars).length,
      personal_count: Object.keys(personalVars).length,
    });
  }

  if (Object.keys(ecData).length === 0) {
    return "";
  }

  let created: ExecutionContext;
  try {
    created = await deps.executionContext.create(
      create(ExecutionContextSchema, {
        apiVersion: "agentic.stigmer.ai/v1",
        kind: "ExecutionContext",
        metadata: {
          name: `exec-ctx-${executionId}`,
          org: callerOrg,
        },
        spec: {
          executionId,
          data: ecData,
        },
      }),
    );
  } catch (error) {
    throw internalError(error, "failed to create connect ExecutionContext");
  }

  const resourceId = created.metadata?.id ?? "";
  deps.logger.info("Created ephemeral ExecutionContext for MCP connect", {
    execution_context_id: resourceId,
    execution_id: executionId,
    data_entries: Object.keys(ecData).length,
  });

  return resourceId;
}

/**
 * Reads OAuth-managed variables from the grant's managed environment and
 * returns them along with the remaining declarations that still need the
 * personal environment (Go resolveOAuthVarsFromManagedEnv). If no grant
 * exists or reads fail, all declarations are returned as "remaining" —
 * the personal-env fallback Go takes on the same arms.
 */
async function resolveOAuthVarsFromManagedEnv(
  deps: McpServerConnectDeps,
  mcpServerId: string,
  org: string,
  envDecls: { [key: string]: EnvVarDeclaration },
): Promise<{
  oauthVars: { [key: string]: ExecutionValue };
  remainingDecls: { [key: string]: EnvVarDeclaration };
}> {
  let grant;
  try {
    grant = await deps.oauthGrants.find("", mcpServerId, org);
  } catch {
    // A grant-store read failure falls through to the personal env,
    // exactly Go's err-folded arm.
    return { oauthVars: {}, remainingDecls: envDecls };
  }
  if (grant === undefined || grant.environmentId === "") {
    return { oauthVars: {}, remainingDecls: envDecls };
  }

  const oauthKey = grant.accessTokenEnvVar;
  if (!(oauthKey in envDecls)) {
    return { oauthVars: {}, remainingDecls: envDecls };
  }

  let tokenValue = "";
  try {
    tokenValue = await deps.managedEnv.readSecretValue(
      grant.environmentId,
      oauthKey,
    );
  } catch (error) {
    deps.logger.warn(
      "Failed to read OAuth token from managed environment — falling back to personal env",
      {
        mcp_server_id: mcpServerId,
        oauth_key: oauthKey,
        managed_env_id: grant.environmentId,
        error: error instanceof Error ? error.message : String(error),
      },
    );
    return { oauthVars: {}, remainingDecls: envDecls };
  }
  if (tokenValue === "") {
    deps.logger.warn(
      "Failed to read OAuth token from managed environment — falling back to personal env",
      {
        mcp_server_id: mcpServerId,
        oauth_key: oauthKey,
        managed_env_id: grant.environmentId,
      },
    );
    return { oauthVars: {}, remainingDecls: envDecls };
  }

  const remainingDecls: { [key: string]: EnvVarDeclaration } = {};
  for (const [k, v] of Object.entries(envDecls)) {
    if (k !== oauthKey) {
      remainingDecls[k] = v;
    }
  }

  deps.logger.debug("Resolved OAuth token from managed environment", {
    mcp_server_id: mcpServerId,
    oauth_key: oauthKey,
    managed_env_id: grant.environmentId,
  });

  return {
    oauthVars: {
      [oauthKey]: create(ExecutionValueSchema, {
        value: tokenValue,
        isSecret: true,
      }),
    },
    remainingDecls,
  };
}

/**
 * Reads environment variables from the user's personal environment
 * (labeled stigmer.ai/personal=true; Go resolveFromPersonalEnvironment).
 * Required variables (optional=false, the default) must be present;
 * optional variables are included when available but silently skipped
 * when missing.
 */
async function resolveFromPersonalEnvironment(
  deps: McpServerConnectDeps,
  org: string,
  envDecls: { [key: string]: EnvVarDeclaration },
): Promise<{ [key: string]: ExecutionValue }> {
  const requiredKeys: string[] = [];
  for (const [k, decl] of Object.entries(envDecls)) {
    if (!decl.optional) {
      requiredKeys.push(k);
    }
  }

  let listResponse: EnvironmentList;
  try {
    listResponse = await deps.environmentReader.list({
      org,
      labels: { [PERSONAL_ENV_LABEL]: "true" },
    });
  } catch (error) {
    throw internalError(error, "failed to list personal environments");
  }
  if (listResponse.totalCount === 0 || listResponse.items.length === 0) {
    if (requiredKeys.length === 0) {
      return {};
    }
    // Go renders the key list with %v — bracketed, space-separated.
    throw failedPreconditionError(
      `personal environment not found for org '${org}'; save required credentials first: [${requiredKeys.join(" ")}]`,
    );
  }

  const personalEnv = listResponse.items[0];
  const personalEnvId = personalEnv?.metadata?.id ?? "";
  const storedKeys = new Set(Object.keys(personalEnv?.spec?.data ?? {}));

  const result: { [key: string]: ExecutionValue } = {};
  const missing: string[] = [];

  for (const [key, decl] of Object.entries(envDecls)) {
    if (!storedKeys.has(key)) {
      if (decl.optional) {
        deps.logger.debug(
          "Optional env var not in personal environment — skipping",
          { key },
        );
        continue;
      }
      missing.push(key);
      continue;
    }

    let secretValue: EnvironmentSpecValue;
    try {
      secretValue = await deps.environmentReader.getSecretValue({
        environmentId: personalEnvId,
        key,
      });
    } catch (error) {
      deps.logger.warn("Failed to get secret value from personal environment", {
        key,
        personal_env_id: personalEnvId,
        error: error instanceof Error ? error.message : String(error),
      });
      if (decl.optional) {
        continue;
      }
      missing.push(key);
      continue;
    }
    if (secretValue.value === "") {
      if (decl.optional) {
        continue;
      }
      missing.push(key);
      continue;
    }

    result[key] = create(ExecutionValueSchema, {
      value: secretValue.value,
      isSecret: decl.isSecret,
    });
  }

  if (missing.length > 0) {
    throw failedPreconditionError(
      `missing required credentials in personal environment: [${missing.join(" ")}]`,
    );
  }

  return result;
}

/**
 * Removes the ephemeral ExecutionContext after the connect workflow
 * completes (Go deleteConnectExecutionContext). Failures are logged but
 * not propagated, since the result is already stored.
 */
export async function deleteConnectExecutionContext(
  deps: McpServerConnectDeps,
  resourceId: string,
  executionId: string,
): Promise<void> {
  try {
    await deps.executionContext.delete({ resourceId });
  } catch (error) {
    deps.logger.warn("Failed to delete connect ExecutionContext (non-fatal)", {
      resource_id: resourceId,
      execution_id: executionId,
      error: error instanceof Error ? error.message : String(error),
    });
    return;
  }
  deps.logger.debug("Deleted ephemeral connect ExecutionContext", {
    resource_id: resourceId,
    execution_id: executionId,
  });
}

/**
 * Maps a classified connect-run failure to the gRPC status the connect
 * contract promises (Go awaitConnectWorkflow's switch, connect.go:661-694).
 * budget is the WorkflowRunTimeout the run was started with, named in the
 * DEADLINE_EXCEEDED message so the error reports the ceiling that
 * actually fired.
 */
export function mapConnectFailure(
  logger: Logger,
  mcpServer: McpServer,
  workflowId: string,
  failure: ConnectRunFailure,
  budget: ConnectBudget,
): ConnectError {
  const mcpServerId = mcpServer.metadata?.id ?? "";
  logger.error("MCP connect workflow failed", {
    workflow_id: workflowId,
    mcp_server_id: mcpServerId,
    failure_kind: failure.kind,
  });

  switch (failure.kind) {
    case "application":
      // FAILED_PRECONDITION, not INTERNAL (issue #239): an application
      // error from the connect workflow means the TARGET server (or its
      // credentials/config) refused the connect — the runner's message
      // is crafted for the user, and clients render FAILED_PRECONDITION
      // messages verbatim while (correctly) hiding INTERNAL detail.
      return failedPreconditionError(
        buildConnectFailureMessage(mcpServer, failure.message),
      );
    case "timeout":
      // Name the budget that fired (issue #243): the runner's own bounds
      // fail earlier with specific, actionable errors, so reaching this
      // ceiling usually means the runner never served the task at all.
      return new ConnectError(
        `connect did not complete within the ${budget.goLabel} budget for MCP server '${mcpServerId}' — ` +
          "if this repeats, check that your runner is running and healthy",
        Code.DeadlineExceeded,
      );
    case "service-not-found":
      return unavailableError(
        `connect service temporarily unavailable for MCP server '${mcpServerId}'`,
      );
    case "other": {
      // Deliberate exception to the "internal causes stay off the wire"
      // rule (stigmer/stigmer#478): the cause here is the runner's own
      // CLASSIFIED, user-facing connect-failure text, not raw server
      // internals — so the message rides the wire, NOT the sanitized
      // internalError helper. Connect failures are user-debugged
      // configuration problems; the classified cause is the product.
      return new ConnectError(
        buildConnectFailureMessage(mcpServer, failure.message),
        Code.Internal,
      );
    }
    default: {
      const exhaustive: never = failure;
      throw new Error(`unhandled connect failure ${String(exhaustive)}`);
    }
  }
}

/**
 * Builds a user-facing, transport-aware connect failure message (Go
 * buildConnectFailureMessage), replacing the raw ExceptionGroup/TaskGroup
 * text that told users nothing.
 *
 * In the OSS/local edition the local runner spawns stdio servers on the
 * user's own machine, so a stdio failure is usually a missing command or
 * bad args/environment — and previewing discovery locally with --dry-run
 * is the fastest way to diagnose it. HTTP servers fail on reachability or
 * credentials.
 */
export function buildConnectFailureMessage(
  mcpServer: McpServer,
  cause: string,
): string {
  const name = mcpServer.metadata?.name ?? "";
  // The runner classifies a 401 OAuth challenge into a self-contained,
  // user-facing message (see runner mcp-oauth-detect.ts). It already
  // names the server and tells the user to sign in, so pass it through
  // verbatim rather than wrapping it with a generic "check your
  // credentials" suffix that would contradict it. The "requires OAuth"
  // phrase is the stable marker.
  if (cause.includes("requires OAuth")) {
    return cause;
  }
  if (mcpServer.spec?.serverType.case === "stdio") {
    const slug = mcpServer.metadata?.slug ?? "";
    return (
      `connect failed for MCP server '${name}': ${cause}. This is a stdio server launched ` +
      "by your local runner — verify the command is installed and its arguments " +
      "and environment variables are correct. Preview discovery locally with: " +
      `stigmer connect mcp-server ${slug} --dry-run`
    );
  }
  return (
    `connect failed for MCP server '${name}': ${cause}. Check that the server URL is ` +
    "reachable and your credentials are valid."
  );
}

/**
 * Checks whether the MCP server has an auth block with an existing
 * OAuthGrant, and if the access token is expired, refreshes it using the
 * refresh token from the grant's managed environment (Go
 * refreshOAuthTokenIfNeeded) — the pre-flight that ensures the connect
 * workflow (and agent execution) always sees a fresh token.
 */
export async function refreshOAuthTokenIfNeeded(
  deps: McpServerConnectDeps,
  mcpServer: McpServer,
  callerOrg: string,
): Promise<void> {
  const auth = mcpServer.spec?.auth;
  if (auth === undefined) {
    return;
  }

  const mcpServerId = mcpServer.metadata?.id ?? "";

  // OSS mode: single user, empty identity_account_id. Org comes from the
  // caller's active org (matches how the grant was stored).
  let grant;
  try {
    grant = await deps.oauthGrants.find("", mcpServerId, callerOrg);
  } catch (error) {
    deps.logger.warn("Failed to load OAuth grant for pre-flight check (non-fatal)", {
      mcp_server_id: mcpServerId,
      error: error instanceof Error ? error.message : String(error),
    });
    return;
  }
  if (grant === undefined) {
    return;
  }

  if (grant.environmentId === "") {
    deps.logger.warn(
      "OAuth grant has no managed environment ID — user must re-authenticate via OAuth Connect",
      { mcp_server_id: mcpServerId },
    );
    return;
  }

  let refreshTokenValue: string;
  try {
    refreshTokenValue = await deps.managedEnv.readSecretValue(
      grant.environmentId,
      grant.refreshTokenEnvVar,
    );
  } catch (error) {
    // Silent skip, ported as-is (oss#863's second half): a failed
    // refresh-token read proceeds with the stale token instead of
    // failing fast with the re-authenticate message — which is why
    // refresh.ts's empty-token error is unreachable through this path.
    deps.logger.debug(
      "No refresh token found in managed environment (may not be OAuth-connected)",
      {
        mcp_server_id: mcpServerId,
        refresh_token_var: grant.refreshTokenEnvVar,
        managed_env_id: grant.environmentId,
        error: error instanceof Error ? error.message : String(error),
      },
    );
    return;
  }

  // For vendor OAuth, the client_secret and its token-endpoint auth
  // method come from the OAuthApp. For DCR, both are empty (public
  // client).
  let clientSecret = "";
  let tokenAuthMethod = "";
  if (grant.authMethod === "vendor_oauth") {
    try {
      ({ clientSecret, tokenAuthMethod } = await loadOAuthAppClientCredentials(
        deps,
        mcpServer,
      ));
    } catch (error) {
      deps.logger.warn("Failed to load OAuthApp client secret for refresh", {
        mcp_server_id: mcpServerId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  let result;
  try {
    result = await refreshTokenIfExpired(
      grant,
      refreshTokenValue,
      clientSecret,
      tokenAuthMethod,
      deps.logger,
    );
  } catch (error) {
    throw failedPreconditionError(
      error instanceof Error ? error.message : String(error),
    );
  }

  if (!result.refreshed) {
    return;
  }

  // Write refreshed tokens to the grant's managed environment.
  const tokenVars: { [key: string]: EnvironmentSpecValue } = {
    [grant.accessTokenEnvVar]: create(EnvironmentValueSchema, {
      value: result.newAccessToken,
      isSecret: true,
    }),
  };
  if (result.newRefreshToken !== refreshTokenValue) {
    tokenVars[grant.refreshTokenEnvVar] = create(EnvironmentValueSchema, {
      value: result.newRefreshToken,
      isSecret: true,
    });
  }

  try {
    await deps.managedEnv.updateSecrets(grant.environmentId, tokenVars);
  } catch (error) {
    throw internalError(
      error,
      "failed to update refreshed tokens in managed environment",
    );
  }

  try {
    await deps.oauthGrants.upsert({
      ...grant,
      accessTokenExpiresAt: result.newExpiresAt,
    });
  } catch (error) {
    deps.logger.warn("Failed to update OAuth grant after refresh (non-fatal)", {
      mcp_server_id: mcpServerId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Loads the decrypted client_secret and the token-endpoint auth method
 * from the referenced OAuthApp for vendor OAuth token refresh (Go
 * loadOAuthAppClientCredentials). The method is read LIVE (not
 * snapshotted on the grant) so an admin correcting a misconfigured
 * OAuthApp fixes refreshes immediately.
 *
 * Resolution goes through refresolution — the same lookup the initiate
 * path used when the grant was minted — so the refresh always runs
 * against the credentials the user actually signed in with (the old
 * slug-only scan could load a same-slug app from a different org,
 * stigmer/stigmer#584).
 */
export async function loadOAuthAppClientCredentials(
  deps: McpServerConnectDeps,
  mcpServer: McpServer,
): Promise<{ clientSecret: string; tokenAuthMethod: string }> {
  const ref = mcpServer.spec?.auth?.oauthAppRef;
  if (ref === undefined || ref.slug === "") {
    return { clientSecret: "", tokenAuthMethod: "" };
  }

  let app;
  try {
    app = await resolveOAuthAppRef(deps.store, ref, deps.logger);
  } catch (error) {
    throw new Error(
      `failed to list oauth apps: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (app === undefined) {
    throw new Error(`OAuthApp '${ref.slug}' not found`);
  }

  const tokenAuthMethod = tokenAuthMethodFromSpec(
    app.spec?.tokenEndpointAuthMethod ?? TokenEndpointAuthMethod.UNSPECIFIED,
  );

  let secret = app.spec?.clientSecret ?? "";
  if (deps.secretService.isEncrypted(secret)) {
    secret = deps.secretService.decrypt(secret);
  }
  return { clientSecret: secret, tokenAuthMethod };
}

/**
 * Maps the OAuthAppSpec enum onto the oauth package's RFC 8414 strings
 * (Go tokenAuthMethodFromSpec). UNSPECIFIED means Basic — every OAuthApp
 * created before the field existed authenticated via HTTP Basic.
 */
export function tokenAuthMethodFromSpec(
  method: TokenEndpointAuthMethod,
): string {
  if (method === TokenEndpointAuthMethod.CLIENT_SECRET_POST) {
    return TOKEN_AUTH_METHOD_POST;
  }
  return TOKEN_AUTH_METHOD_BASIC;
}

/**
 * Runs the connect workflow for a freshly applied MCP server and persists
 * its discovered capabilities + classifier tool-approvals (Go
 * StartBestEffortConnect). Apply launches it fire-and-forget: every
 * failure is logged, never propagated. Persistence is shared with the
 * synchronous connect path via persistConnectResult, so auto-connect and
 * manual connect store byte-identical results.
 *
 * A disconnected engine returns SILENTLY — byte parity with Go's
 * nil-temporalClient no-op (connect.go:1048). Servers that declare env
 * vars are skipped: creating an ExecutionContext requires the caller's
 * request context (for personal environment resolution), which a
 * background task does not have. If the server is deleted before the
 * workflow completes, persistence is skipped — expected for best-effort.
 */
export async function startBestEffortConnect(
  deps: McpServerConnectDeps,
  mcpServer: McpServer,
): Promise<void> {
  const engineState = deps.engineState();
  if (!engineState.connected) {
    return;
  }

  const envKeys = Object.keys(mcpServer.spec?.env ?? {}).length;
  if (envKeys > 0) {
    deps.logger.debug(
      "Skipping best-effort auto-connect: MCP server has env declarations (requires manual connect)",
      {
        mcp_server_id: mcpServer.metadata?.id ?? "",
        env_keys: envKeys,
      },
    );
    return;
  }

  const mcpServerId = mcpServer.metadata?.id ?? "";

  let run: ConnectRun;
  try {
    run = await engineState.engine.startOrAttachConnect(
      mcpServerId,
      { mcp_server_id: mcpServerId },
      CONNECT_TIMEOUT.ms,
    );
  } catch (error) {
    deps.logger.warn("Failed to start best-effort connect workflow (non-fatal)", {
      mcp_server_id: mcpServerId,
      error: error instanceof Error ? error.message : String(error),
    });
    return;
  }

  // Record CONNECTING like the other lanes so an observer of a freshly
  // applied server sees the auto-connect in progress rather than
  // nothing. Skipped when attached (the starting lane's record stands);
  // failures stay non-fatal like everything else on this path.
  if (!run.attached) {
    try {
      await persistConnectStarting(deps.store, mcpServerId, run.workflowId, "");
    } catch (error) {
      deps.logger.warn(
        "Failed to record CONNECTING for best-effort connect (non-fatal)",
        {
          mcp_server_id: mcpServerId,
          error: error instanceof Error ? error.message : String(error),
        },
      );
    }
  }

  const outcome = await run.result(
    CONNECT_TIMEOUT.ms + BEST_EFFORT_CONNECT_GET_BUFFER_MS,
  );
  if (!outcome.ok) {
    deps.logger.warn(
      "Best-effort connect workflow did not complete (non-fatal)",
      {
        workflow_id: run.workflowId,
        mcp_server_id: mcpServerId,
        failure_kind: outcome.failure.kind,
      },
    );
    await persistConnectFailure(
      deps.store,
      deps.logger,
      mcpServerId,
      internalError(
        new Error(`connect run failed: ${outcome.failure.kind}`),
        "best-effort connect did not complete",
      ),
    );
    return;
  }

  let persisted: McpServer;
  let toolApprovalCount: number;
  try {
    ({ persisted, toolApprovalCount } = await persistConnectResult(
      deps.store,
      mcpServerId,
      run.workflowId,
      outcome.output,
    ));
  } catch (error) {
    if (error instanceof ResourceNotFoundError) {
      deps.logger.info(
        "Skipping best-effort connect persistence: MCP server deleted before connect completed",
        { mcp_server_id: mcpServerId },
      );
      return;
    }
    deps.logger.warn("Failed to persist best-effort connect result (non-fatal)", {
      mcp_server_id: mcpServerId,
      error: error instanceof Error ? error.message : String(error),
    });
    return;
  }

  deps.logger.info("Best-effort auto-connect completed and stored", {
    workflow_id: run.workflowId,
    mcp_server_id: mcpServerId,
    tools: persisted.status?.discoveredCapabilities?.tools.length ?? 0,
    resource_templates:
      persisted.status?.discoveredCapabilities?.resourceTemplates.length ?? 0,
    tool_approvals: toolApprovalCount,
  });
}
