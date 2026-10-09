/**
 * McpServer connect (blocking lane) + the shared connect machinery —
 * ports pkg/domain/mcpserver/controller/connect.go: the Connect RPC,
 * prepareConnect (the caller's values through the vault resolver, the
 * ephemeral ExecutionContext, decrypt-lane token minting), the workflow
 * failure→gRPC mapping, and apply's best-effort auto-connect tail. The
 * async lane lives in start-connect.ts; the connect_status persistence
 * family in connect-status.ts.
 *
 * Discovery runs on the RUNNER: this module starts the runner's
 * stigmer/mcp-server/connect workflow through the engine seam
 * (engine.ts) and never registers a worker. Which runner serves it — the
 * shared queue's, or a connect sandbox provisioned for this connect alone
 * — is connect-sandbox.ts's decision (stigmer/stigmer#1474).
 *
 * Proven by mcpserver-connect.conformance.test.ts
 * (CONFORMANCE_TARGET=local-execution), __tests__/connect.test.ts and
 * __tests__/store-faults.test.ts.
 */
import type { OutboundFetch } from "@stigmer/outbound/egress";
import { create } from "@bufbuild/protobuf";
import type { MessageInitShape } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";

import type { ExecutionContext } from "@stigmer/protos/ai/stigmer/agentic/executioncontext/v1/api_pb";
import { ExecutionContextSchema } from "@stigmer/protos/ai/stigmer/agentic/executioncontext/v1/api_pb";
import type { ExecutionValue } from "@stigmer/protos/ai/stigmer/agentic/executioncontext/v1/spec_pb";
import type { McpServer } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { McpServerSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { McpServerCommandController } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/command_pb";
import type { ConnectInput } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/io_pb";
import { ConnectInputSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/io_pb";
import type { ApiResourceDeleteInputSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { Logger } from "../../boot/logger.js";
import type { Authorizer } from "../../extensions/authorizer.js";
import type { CallerIdentity } from "../../extensions/identity.js";
import { authorizeDirect } from "../../pipeline/steps/authorize.js";
import { refuseBoundElsewhere } from "../../pipeline/steps/refuse-bound-elsewhere.js";
import {
  failedPreconditionError,
  internalError,
  notFoundError,
  invalidArgumentError,
  unavailableError,
} from "../../pipeline/errors.js";
import type { RunnerCredentialProvider } from "../../runnerauth/runner-credential-provider.js";
import { TOKEN_TYPE_EXECUTION_SCOPED } from "../../runnerauth/runnerauth.js";
import type { SandboxLane } from "../../sandbox/lane.js";
import type { Store } from "../../store/interface.js";
import { ResourceNotFoundError } from "../../store/interface.js";
import { toolRequirements } from "../vault/resolve.js";
import type { VaultResolver } from "../vault/resolve.js";
import type { VaultService } from "../vault/service.js";
import { newConnectExecutionId } from "./connect-execution-id.js";
import { acquireConnectRoute } from "./connect-sandbox.js";
import type { ConnectRoute, ConnectRouteRequest } from "./connect-sandbox.js";
import {
  persistConnectFailure,
  persistConnectResult,
  persistConnectStarting,
} from "./connect-status.js";
import type {
  ConnectRun,
  ConnectRunFailure,
  ConnectWorkflowInput,
  McpServerConnectEngine,
  McpServerEngineStateProvider,
} from "./engine.js";

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
 * discovery. Sized from the runner's own bounds (issue #243): the 270s
 * stdio init allowance (STDIO_INIT_TIMEOUT_MS in
 * activities/discover-mcp-server.ts — a first run may download and
 * compile packages via npx/uvx/go run) + margin for tool listing and
 * persistence. Anything smaller makes the runner's
 * cold-start allowance — and its actionable timeout error — unreachable by
 * construction, which is exactly how the pre-#243 45s value killed every
 * heavy stdio connect.
 *
 * Deliberately NOT sized for the 600s discovery hard cap: a stdio server
 * slow enough to need it belongs on the async lane, where pollable
 * discovery is the cure, not a longer blocking wait.
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
 * budget-keeping (discovery hard-bounded at 600s by the activity's
 * startToCloseTimeout): one hour is a backstop several times that bound,
 * so it never fires before the runner's own, actionable timeout does.
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

/**
 * The ExecutionContext lifecycle surface for the ephemeral connect EC —
 * Go's downstream executioncontext client (create + delete).
 *
 * `create` takes the connecting caller and the composition creates the
 * row AS THAT PERSON (boot/inprocess.ts, the `asCaller` lane), never under the
 * internal class: the row's creator stamp is what
 * the runner-subject verifier resolves the connect's person from when
 * the runner presents the connect token under the built-in posture
 * (runnerauth/bound-execution.ts, the `mcp-connect` binding). A row
 * stamped `internal` would name nobody, and the credentialed connect
 * would be refused at identity on every enforcing self-host. `delete`
 * stays the server's own act: the row is the lane's, whoever asked.
 */
export interface ConnectExecutionContextClient {
  create(
    executionContext: MessageInitShape<typeof ExecutionContextSchema>,
    caller: CallerIdentity,
  ): Promise<ExecutionContext>;
  delete(
    input: MessageInitShape<typeof ApiResourceDeleteInputSchema>,
  ): Promise<ExecutionContext>;
}

/**
 * Dependencies of the connect slice — Go's optional
 * SetConnectDependencies fields, made REQUIRED constructor-style
 * parameters per the composition-root idiom (guidelines §4): "Temporal is
 * down" is the engine-state provider's modeled state, never a missing
 * dependency.
 */
export interface McpServerConnectDeps {
  readonly store: Store;
  readonly logger: Logger;
  /**
   * The composed authorization seam — every connect-family lane evaluates
   * its can_connect/can_view annotation (the Java handlers' bespoke
   * authorize steps carry the same config).
   */
  readonly authorizer: Authorizer;
  readonly engineState: McpServerEngineStateProvider;
  readonly executionContext: ConnectExecutionContextClient;
  readonly runnerAuth: RunnerCredentialProvider;
  /**
   * The vault door: sign-in status and disconnect read and remove the
   * caller's own connection at the server's address.
   */
  readonly vaults: VaultService;
  /**
   * The run credential resolver, lazily: a connect's values are the
   * caller's own runtime values, then the caller's My vault, matched to
   * the server's declarations and login key by the run rule (sign-ins
   * renewed on the way). A sign-in saved into a shared vault serves the
   * runs that use that vault, never connect.
   */
  readonly vaultResolver: VaultResolver;
  /**
   * The composed sandbox lane (sandbox/lane.ts): disabled, a connect runs
   * on the shared runner queue; enabled, every connect provisions its own
   * connect sandbox and always creates its ExecutionContext row, the
   * binding its sandbox's credential acts through (connect-sandbox.ts).
   */
  readonly sandboxLane: SandboxLane;
  /**
   * The ONE fetch this slice dials user-supplied URLs with: the MCP
   * endpoint probed at save time. Composed at the root under the edition's egress policy
   * (`drivers.outboundEgress`); no module here holds a `fetch` of its own.
   */
  readonly outboundFetch: OutboundFetch;
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
 * Connect — triggers server-side MCP discovery via the runner's Temporal
 * workflow, blocking until the
 * operation settles (Go Connect, connect.go:165).
 *
 * Lifecycle: prepareConnect → start-or-attach → record CONNECTING (the
 * same bookkeeping the async lane does, so observers see one consistent
 * record regardless of which lane ran) → block on the result → persist
 * capabilities + terminal phase atomically → delete
 * the ExecutionContext. Prefer startConnect for interactive clients: this
 * RPC's response can outlive browser transport limits.
 */
export async function connect(
  deps: McpServerConnectDeps,
  input: ConnectInput,
  identity: CallerIdentity,
): Promise<McpServer> {
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
  } catch (error) {
    if (error instanceof ResourceNotFoundError) {
      throw notFoundError("mcp_server", mcpServerId);
    }
    throw internalError(error, "failed to load mcp server");
  }

  // The annotation's can_connect check after the load and BEFORE the engine
  // check (the Java McpServerConnectHandler load-before-authorize order,
  // stigmer#224): a caller who may not connect this server learns nothing
  // about whether the engine is up.
  await authorizeDirect(
    McpServerCommandController.method.connect,
    deps.authorizer,
    identity,
    input,
  );
  refuseBoundElsewhere(identity, input.org);

  const engineState = deps.engineState();
  if (!engineState.connected) {
    throw failedPreconditionError(
      "connect is not available: Temporal not configured",
    );
  }

  const prepared = await prepareConnect(deps, mcpServer, input, identity);

  let route: ConnectRoute | undefined;
  try {
    route = await acquireConnectRouteFor(deps, mcpServerId, {
      connectExecutionId: prepared.executionId,
      org: input.org,
      caller: identity,
    });

    let run: ConnectRun;
    try {
      run = await engineState.engine.startOrAttachConnect(
        mcpServerId,
        prepared.workflowInput,
        CONNECT_TIMEOUT.ms,
        route.taskQueue,
      );
    } catch (error) {
      deps.logger.error("Failed to start MCP connect workflow", {
        mcp_server_id: mcpServerId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw internalError(error, "failed to start connect workflow");
    }

    // An attached run is served by the sandbox of the lane that started
    // it: this lane's own sandbox, if one was provisioned, is given back
    // now rather than held idle for the other lane's whole run.
    if (run.attached) {
      await route.release();
    }

    // Record the operation on connect_status. Skipped when attached: the
    // lane that started the run already recorded it, and overwriting
    // would reset its started_at. Best-effort — the blocking caller
    // learns the outcome from this RPC's response either way.
    if (!run.attached) {
      try {
        await persistConnectStarting(
          deps.store,
          mcpServerId,
          run.workflowId,
          "",
        );
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
      await persistConnectFailure(
        deps.store,
        deps.logger,
        mcpServerId,
        failure,
      );
      throw failure;
    }

    // Persist discovered capabilities (each tool's destructive_hint
    // included) and the terminal phase atomically. The
    // freshly-read, updated resource is returned to the caller.
    let persisted: McpServer;
    try {
      persisted = await persistConnectResult(
        deps.store,
        mcpServerId,
        run.workflowId,
        outcome.output,
      );
    } catch (error) {
      throw internalError(error, "failed to save mcp server after connect");
    }

    deps.logger.info("MCP server connect completed and stored", {
      mcp_server_id: mcpServerId,
      tools: persisted.status?.discoveredCapabilities?.tools.length ?? 0,
      resource_templates:
        persisted.status?.discoveredCapabilities?.resourceTemplates.length ?? 0,
    });

    return persisted;
  } finally {
    // Idempotent: a no-op when the attach arm already released it.
    await route?.release();
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
 * Resolves a connect's route (connect-sandbox.ts) for every lane alike: a
 * sandbox that cannot be provisioned is recorded on connect_status as the
 * connect's failure before the refusal propagates, so the server's page
 * says why instead of waiting on a run that was never started.
 */
export async function acquireConnectRouteFor(
  deps: McpServerConnectDeps,
  mcpServerId: string,
  request: ConnectRouteRequest,
): Promise<ConnectRoute> {
  try {
    return await acquireConnectRoute(deps.sandboxLane, deps.logger, request);
  } catch (error) {
    if (error instanceof ConnectError) {
      await persistConnectFailure(deps.store, deps.logger, mcpServerId, error);
    }
    throw error;
  }
}

/**
 * The caller-context half of a connect: the caller's values through the
 * vault resolver, ephemeral ExecutionContext creation, and decrypt-lane
 * token minting (Go prepareConnect).
 *
 * Both the blocking (connect) and async (startConnect) lanes run this
 * synchronously inside the RPC handler, because everything here needs the
 * caller's identity: the vault resolver reads the caller's own vault and
 * renews their sign-in, which a background task has no request context to
 * do (the same constraint that scopes startBestEffortConnect to env-less
 * servers).
 *
 * A connect's discovery runs on the runner with TWO credentials, and the
 * split is deliberate. The runner's own process credential reads the
 * McpServer's metadata — under the built-in posture that credential is
 * the operator's API key, and the operator is an organization admin
 * (deploy/helm/stigmer: the signed-in operator mints the runner's key),
 * whom the model makes an owner of every McpServer in the organization
 * (authorization/model/mcp_server.ts), so a member's private server is
 * readable. The connect token minted below reads the SECRETS: it is
 * bound to this connect's ExecutionContext, and under the built-in
 * posture the runner-subject verifier resolves its bearer to the person
 * that row was created by — which is why the row is created as `identity`
 * and not as the server.
 *
 * With a sandbox lane composed there is no operator key: the connect
 * sandbox's runner acts as the person on EVERY RPC of its discovery, with
 * a credential bound to this connect (connect-sandbox.ts). That binding
 * resolves through the ExecutionContext row, so on the lane the row is
 * always created, as `identity`, even for a server that declares no env
 * (an empty `data` map; stigmer/stigmer#1474). Such a binding-only row
 * carries nothing to read, so the workflow input names no context for it
 * and no payload token: the runner's discovery takes the same no-env path
 * it takes today. Without a lane an env-less connect still creates no row.
 */
export async function prepareConnect(
  deps: McpServerConnectDeps,
  mcpServer: McpServer,
  input: ConnectInput,
  identity: CallerIdentity,
): Promise<PreparedConnect> {
  const mcpServerId = mcpServer.metadata?.id ?? "";
  const callerOrg = input.org;
  // The connect resolves the caller's vault in this organization and
  // files its context there: a credential bound to another may not
  // (refuse-bound-elsewhere.ts).
  refuseBoundElsewhere(identity, callerOrg);

  const executionId = newConnectExecutionId(mcpServerId);

  const ecRow = await createConnectExecutionContext(
    deps,
    mcpServer,
    executionId,
    callerOrg,
    input.runtimeEnv,
    identity,
    deps.sandboxLane.enabled,
  );
  const ecResourceId = ecRow?.resourceId ?? "";

  const workflowInput: ConnectWorkflowInput = {
    mcp_server_id: mcpServerId,
  };
  if (ecRow === undefined || ecRow.bindingOnly) {
    return { workflowInput, ecResourceId, executionId };
  }
  const withContext: ConnectWorkflowInput = {
    ...workflowInput,
    execution_context_id: executionId,
  };

  // Mint the decrypt-lane token for the EC just created (oss#535) — see
  // the engine.ts ConnectWorkflowInput doc for why this rides the
  // payload. Minting failure degrades, not fails: discovery of a server
  // with declared credentials will refuse the redacted read with an
  // actionable error, and credential-less servers connect fine without
  // the token.
  if (deps.runnerAuth.isEnabled(TOKEN_TYPE_EXECUTION_SCOPED)) {
    try {
      const minted = deps.runnerAuth.mint(
        TOKEN_TYPE_EXECUTION_SCOPED,
        executionId,
        0,
      );
      return {
        workflowInput: {
          ...withContext,
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

  return { workflowInput: withContext, ecResourceId, executionId };
}

/**
 * The connect's ExecutionContext row, when one was created: its resource
 * id (for the settle's delete) and whether it is binding-only — created on
 * the sandbox lane for a connect with nothing to carry (prepareConnect's
 * header).
 */
interface ConnectExecutionContextRow {
  readonly resourceId: string;
  readonly bindingOnly: boolean;
}

/**
 * Builds and persists an ephemeral ExecutionContext for the connect
 * activity (Go createConnectExecutionContext).
 *
 * The values come from the vault resolver (domain/vault/resolve.ts):
 * runtime_env first as the call's own one-time values, then the caller's
 * vaults, matched to the server's declarations and login key, so a value
 * the server does not declare is not delivered; a required key nothing
 * holds refuses the connect with FailedPrecondition naming it.
 * When nothing resolves it creates no row and returns undefined, unless
 * `bindingRowRequired`: the
 * sandbox lane's connect needs the row as its credential's binding, so it
 * is created with empty `data` and reported binding-only.
 *
 * The row is created as `caller`, the person connecting (see the
 * ConnectExecutionContextClient doc): its creator stamp is the connect
 * token's person under the built-in posture.
 */
async function createConnectExecutionContext(
  deps: McpServerConnectDeps,
  mcpServer: McpServer,
  executionId: string,
  callerOrg: string,
  runtimeEnv: { [key: string]: ExecutionValue },
  caller: CallerIdentity,
  bindingRowRequired: boolean,
): Promise<ConnectExecutionContextRow | undefined> {
  // A server that declares nothing and takes no login, called with no
  // values of its own, has nothing to resolve.
  const nothingToResolve =
    Object.keys(runtimeEnv).length === 0 &&
    toolRequirements(mcpServer).length === 0;
  const resolved = nothingToResolve
    ? new Map<string, ExecutionValue>()
    : await deps.vaultResolver.resolveForConnect({
        orgId: callerOrg,
        caller,
        server: mcpServer,
        ownValues: new Map(Object.entries(runtimeEnv)),
      });
  const ecData: { [key: string]: ExecutionValue } = Object.fromEntries(resolved);
  deps.logger.info("Resolved values for connect ExecutionContext", {
    execution_id: executionId,
    runtime_env_count: Object.keys(runtimeEnv).length,
    resolved_count: resolved.size,
  });

  const bindingOnly = Object.keys(ecData).length === 0;
  if (bindingOnly && !bindingRowRequired) {
    return undefined;
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
      caller,
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

  return { resourceId, bindingOnly };
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
 * Runs the connect workflow for a freshly applied MCP server and persists
 * its discovered capabilities (Go
 * StartBestEffortConnect). Apply launches it fire-and-forget: every
 * failure is logged, never propagated. Persistence is shared with the
 * synchronous connect path via persistConnectResult, so auto-connect and
 * manual connect store byte-identical results.
 *
 * A disconnected engine returns SILENTLY — byte parity with Go's
 * nil-temporalClient no-op (connect.go:1048). Servers that need any value
 * are skipped: a declared env var, or a login key (auth.target_env_var, or
 * the variable a Bearer header names), the same requirements the run's
 * resolver derives (toolRequirements). Resolving them reads the connecting
 * person's own vaults, and may renew their sign-in, which an apply does
 * not stand for. If the
 * server is deleted before the workflow completes, persistence is skipped
 * — expected for best-effort.
 *
 * `applier` is the caller whose apply fired this connect. Without a
 * sandbox lane it is unused: the shared runner's own credential reads the
 * server, exactly as before. With one, the connect runs in a connect
 * sandbox acting as the applier (connect-sandbox.ts), so the lane first
 * creates the binding-only ExecutionContext row as the applier
 * (prepareConnect) and deletes it when the run settles.
 */
export async function startBestEffortConnect(
  deps: McpServerConnectDeps,
  mcpServer: McpServer,
  applier: CallerIdentity,
): Promise<void> {
  const engineState = deps.engineState();
  if (!engineState.connected) {
    return;
  }

  const needed = toolRequirements(mcpServer).length;
  if (needed > 0) {
    deps.logger.debug(
      "Skipping best-effort auto-connect: MCP server needs env values or a login (requires manual connect)",
      {
        mcp_server_id: mcpServer.metadata?.id ?? "",
        needed_keys: needed,
      },
    );
    return;
  }

  const mcpServerId = mcpServer.metadata?.id ?? "";
  const org = mcpServer.metadata?.org ?? "";

  let prepared: PreparedConnect | undefined;
  let route: ConnectRoute | undefined;
  try {
    if (deps.sandboxLane.enabled) {
      prepared = await prepareConnect(
        deps,
        mcpServer,
        create(ConnectInputSchema, { mcpServerId, org }),
        applier,
      );
      route = await acquireConnectRouteFor(deps, mcpServerId, {
        connectExecutionId: prepared.executionId,
        org,
        caller: applier,
      });
    }
    await runBestEffortConnect(
      deps,
      engineState.engine,
      mcpServer,
      prepared?.workflowInput ?? { mcp_server_id: mcpServerId },
      route,
    );
  } catch (error) {
    deps.logger.warn("Best-effort connect could not start (non-fatal)", {
      mcp_server_id: mcpServerId,
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    await route?.release();
    if (prepared !== undefined && prepared.ecResourceId !== "") {
      await deleteConnectExecutionContext(
        deps,
        prepared.ecResourceId,
        prepared.executionId,
      );
    }
  }
}

/**
 * The run half of the best-effort connect: start or attach, record
 * CONNECTING, await, and persist the outcome. Every arm is non-fatal and
 * returns. The caller owns the route (undefined: the shared runner queue)
 * and the ExecutionContext; an attach gives the route's sandbox back at
 * once, since the other lane's run is served by its own.
 */
async function runBestEffortConnect(
  deps: McpServerConnectDeps,
  engine: McpServerConnectEngine,
  mcpServer: McpServer,
  workflowInput: ConnectWorkflowInput,
  route: ConnectRoute | undefined,
): Promise<void> {
  const mcpServerId = mcpServer.metadata?.id ?? "";

  let run: ConnectRun;
  try {
    run = await engine.startOrAttachConnect(
      mcpServerId,
      workflowInput,
      CONNECT_TIMEOUT.ms,
      route?.taskQueue ?? { kind: "runner" },
    );
  } catch (error) {
    deps.logger.warn(
      "Failed to start best-effort connect workflow (non-fatal)",
      {
        mcp_server_id: mcpServerId,
        error: error instanceof Error ? error.message : String(error),
      },
    );
    return;
  }

  // Record CONNECTING like the other lanes so an observer of a freshly
  // applied server sees the auto-connect in progress rather than
  // nothing. Skipped when attached (the starting lane's record stands);
  // failures stay non-fatal like everything else on this path.
  if (run.attached) {
    await route?.release();
  } else {
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
    // The same mapping the blocking lane and the async settle apply, so
    // the page of a freshly applied server says what the runner found
    // ("requires OAuth", "Missing Cursor credential") rather than that a
    // background task did not complete. ConnectStatus promises the lanes
    // record alike; this arm once recorded a generic sentence instead.
    const failure = mapConnectFailure(
      deps.logger,
      mcpServer,
      run.workflowId,
      outcome.failure,
      CONNECT_TIMEOUT,
    );
    await persistConnectFailure(deps.store, deps.logger, mcpServerId, failure);
    return;
  }

  let persisted: McpServer;
  try {
    persisted = await persistConnectResult(
      deps.store,
      mcpServerId,
      run.workflowId,
      outcome.output,
    );
  } catch (error) {
    if (error instanceof ResourceNotFoundError) {
      deps.logger.info(
        "Skipping best-effort connect persistence: MCP server deleted before connect completed",
        { mcp_server_id: mcpServerId },
      );
      return;
    }
    deps.logger.warn(
      "Failed to persist best-effort connect result (non-fatal)",
      {
        mcp_server_id: mcpServerId,
        error: error instanceof Error ? error.message : String(error),
      },
    );
    return;
  }

  deps.logger.info("Best-effort auto-connect completed and stored", {
    workflow_id: run.workflowId,
    mcp_server_id: mcpServerId,
    tools: persisted.status?.discoveredCapabilities?.tools.length ?? 0,
    resource_templates:
      persisted.status?.discoveredCapabilities?.resourceTemplates.length ?? 0,
  });
}
