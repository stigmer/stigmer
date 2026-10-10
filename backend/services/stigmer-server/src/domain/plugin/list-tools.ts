/**
 * PluginCommandController.listTools — lists the tools one of a plugin's MCP
 * servers offers now, as the caller, and stores nothing. It is how a person
 * checks a server from its plugin's page (and `stigmer connect plugin`):
 * sign in first when the server needs it, then see what it offers and which
 * tools its maker marks destructive.
 *
 * The listing runs on a RUNNER, never in this server: the server's address
 * or local program is reached from where the organization's turns run.
 * This module starts the runner's connect workflow (the wire name
 * `stigmer/mcp-server/connect`) through the engine seam (tools/engine.ts)
 * and waits for its answer. Which runner serves it — the shared queue's,
 * or a connect sandbox provisioned for this listing alone — is
 * tools/sandbox.ts's decision (stigmer/stigmer#1474).
 *
 * The caller's values. A server that reads a key or takes a login is
 * planned over the caller's My vault first, so a listing missing a required
 * key is refused naming it before anything starts (the runner's fetch plans
 * it again and opens it). The listing records a connect attempt
 * (tools/attempt.ts) that binds the runner credential minted for it to the
 * caller and this one server, and ends it when the listing settles.
 *
 * Every listing runs under a workflow id of its own: two people listing one
 * server each get their own run, read with their own vault.
 *
 * Proven by __tests__/list-tools.test.ts and
 * plugin-tools.conformance.test.ts (CONFORMANCE_TARGET=local-execution).
 */
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";

import { PluginSchema } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import type { Plugin } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import { PluginCommandController } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/command_pb";
import {
  ListPluginToolsOutputSchema,
  PluginToolSchema,
} from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/io_pb";
import type {
  ListPluginToolsInput,
  ListPluginToolsOutput,
} from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/io_pb";
import type { McpServerEntry } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/status_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { Logger } from "../../boot/logger.js";
import type { Authorizer } from "../../extensions/authorizer.js";
import type { CallerIdentity } from "../../extensions/identity.js";
import {
  failedPreconditionError,
  internalError,
  invalidArgumentError,
  notFoundError,
  unavailableError,
} from "../../pipeline/errors.js";
import { authorizeDirect } from "../../pipeline/steps/authorize.js";
import { refuseBoundElsewhere } from "../../pipeline/steps/refuse-bound-elsewhere.js";
import type { RunnerCredentialProvider } from "../../runnerauth/runner-credential-provider.js";
import { TOKEN_TYPE_EXECUTION_SCOPED } from "../../runnerauth/runnerauth.js";
import type { SandboxLane } from "../../sandbox/lane.js";
import type { Store } from "../../store/interface.js";
import { ResourceNotFoundError } from "../../store/interface.js";
import { runPersonOfCaller, toolNameOf, toolRequirements } from "../vault/resolve.js";
import type { PluginServer, VaultResolver } from "../vault/resolve.js";
import { endConnectAttempt, recordConnectAttempt } from "./tools/attempt.js";
import type { PluginToolsEngineStateProvider, ToolsRunFailure, ToolsWorkflowInput } from "./tools/engine.js";
import { newConnectExecutionId } from "./tools/execution-id.js";
import { acquireConnectRoute } from "./tools/sandbox.js";
import type { ConnectRoute } from "./tools/sandbox.js";

/**
 * The listing workflow's WorkflowRunTimeout: the runner's 270 s allowance
 * for a local program's first start (a first run may download and compile
 * packages through npx, uvx or go run) plus margin for the listing itself.
 * Anything smaller makes the runner's own, actionable timeout unreachable.
 * It is also the bound on "no runner ever picked up the task", so a listing
 * against a dead runner waits the full budget before DEADLINE_EXCEEDED.
 */
export const LIST_TOOLS_TIMEOUT = { ms: 420_000, label: "7m0s" } as const;

/** Added to the budget to bound the handler's wait on the result: a backstop only. */
export const LIST_TOOLS_GET_BUFFER_MS = 15_000;

export interface PluginToolsDeps {
  readonly store: Store;
  readonly logger: Logger;
  /** Evaluates the RPC's annotation (can_view on the plugin). */
  readonly authorizer: Authorizer;
  readonly engineState: PluginToolsEngineStateProvider;
  /** Mints the listing's runner credential. */
  readonly runnerAuth: RunnerCredentialProvider;
  /** The run credential resolver: a listing's values come from the caller's My vault, by the run rule. */
  readonly vaultResolver: VaultResolver;
  /** The composed sandbox lane: disabled, a listing runs on the shared runner queue. */
  readonly sandboxLane: SandboxLane;
}

export async function listTools(
  deps: PluginToolsDeps,
  input: ListPluginToolsInput,
  identity: CallerIdentity,
): Promise<ListPluginToolsOutput> {
  if (input.pluginId === "" || input.server === "") {
    throw invalidArgumentError("plugin_id and server are required");
  }
  if (input.org === "") {
    throw invalidArgumentError("org is required to list a server's tools");
  }

  let plugin: Plugin;
  try {
    plugin = await deps.store.getResource(ApiResourceKind.plugin, input.pluginId, PluginSchema);
  } catch (error) {
    if (error instanceof ResourceNotFoundError) {
      throw notFoundError("plugin", input.pluginId);
    }
    throw internalError(error, "failed to load plugin");
  }
  // The annotation's can_view after the load and before anything else: a
  // caller who may not see the plugin learns nothing about its servers or
  // whether the engine is up.
  await authorizeDirect(PluginCommandController.method.listTools, deps.authorizer, identity, input);
  // The listing reads the caller's vault in this organization and records
  // its attempt there: a credential bound to another may not.
  refuseBoundElsewhere(identity, input.org);

  const entry = plugin.status?.mcpServers.find((server) => server.name === input.server);
  if (entry === undefined) {
    throw notFoundError(`MCP server of plugin '${plugin.metadata?.slug ?? ""}'`, input.server);
  }
  const server: PluginServer = {
    pluginId: input.pluginId,
    pluginName: plugin.metadata?.name ?? "",
    pluginDigest: plugin.status?.digest ?? "",
    entry,
    env: plugin.status?.env ?? {},
  };

  const engineState = deps.engineState();
  if (!engineState.connected) {
    throw failedPreconditionError("listing a server's tools is not available: Temporal not configured");
  }

  const person = runPersonOfCaller(identity);
  const needsValues = toolRequirements(server).length > 0;
  if (needsValues) {
    await deps.vaultResolver.planConnect({ orgId: input.org, person, server });
  }

  const executionId = newConnectExecutionId(input.pluginId);
  try {
    await recordConnectAttempt(deps.store, deps.logger, {
      id: executionId,
      org: input.org,
      createdBy: identity.identityId,
      person,
      pluginId: input.pluginId,
      server: input.server,
      ttlMs: LIST_TOOLS_TIMEOUT.ms + LIST_TOOLS_GET_BUFFER_MS,
    });
  } catch (error) {
    throw internalError(error, "failed to record the tools listing");
  }

  let route: ConnectRoute | undefined;
  try {
    route = await acquireConnectRoute(deps.sandboxLane, deps.logger, {
      connectExecutionId: executionId,
      org: input.org,
      caller: identity,
    });
    const workflowInput = withCredential(deps, executionId, needsValues, {
      plugin_id: input.pluginId,
      server: input.server,
    });
    let run;
    try {
      run = await engineState.engine.startListing(
        executionId,
        workflowInput,
        LIST_TOOLS_TIMEOUT.ms,
        route.taskQueue,
      );
    } catch (error) {
      deps.logger.error("Failed to start a plugin tools listing", {
        plugin_id: input.pluginId,
        server: input.server,
        error: error instanceof Error ? error.message : String(error),
      });
      throw internalError(error, "failed to start the tools listing");
    }
    const outcome = await run.result(LIST_TOOLS_TIMEOUT.ms + LIST_TOOLS_GET_BUFFER_MS);
    if (!outcome.ok) {
      throw mapListingFailure(deps.logger, server, run.workflowId, outcome.failure);
    }
    return create(ListPluginToolsOutputSchema, {
      tools: (outcome.output.tools ?? []).map((tool) =>
        create(PluginToolSchema, {
          name: tool.name ?? "",
          description: tool.description ?? "",
          destructive: tool.destructiveHint === true,
        }),
      ),
    });
  } finally {
    await route?.release();
    await endConnectAttempt(deps.store, deps.logger, executionId);
  }
}

/**
 * The workflow input with the listing's attempt and, when the server reads
 * values, the runner credential bound to it. A minting failure degrades,
 * not fails: the fetch then refuses with an actionable error.
 */
function withCredential(
  deps: PluginToolsDeps,
  executionId: string,
  needsValues: boolean,
  input: ToolsWorkflowInput,
): ToolsWorkflowInput {
  if (!needsValues) {
    return input;
  }
  const withAttempt: ToolsWorkflowInput = { ...input, execution_context_id: executionId };
  if (!deps.runnerAuth.isEnabled(TOKEN_TYPE_EXECUTION_SCOPED)) {
    return withAttempt;
  }
  try {
    const minted = deps.runnerAuth.mint(TOKEN_TYPE_EXECUTION_SCOPED, executionId, 0);
    return { ...withAttempt, execution_context_token: minted.token };
  } catch (error) {
    deps.logger.warn("Failed to mint the listing's runner credential — the runner cannot fetch its values", {
      execution_id: executionId,
      error: error instanceof Error ? error.message : String(error),
    });
    return withAttempt;
  }
}

/**
 * Maps a classified listing failure to the gRPC status: the runner's own
 * user-facing message as FAILED_PRECONDITION (the server, its address or
 * its login refused), the budget that fired as DEADLINE_EXCEEDED, a run
 * Temporal lost as UNAVAILABLE, anything else as INTERNAL carrying the
 * runner's classified text (a configuration problem the person debugs).
 */
export function mapListingFailure(
  logger: Logger,
  server: PluginServer,
  workflowId: string,
  failure: ToolsRunFailure,
): ConnectError {
  const name = toolNameOf(server.pluginName, server.entry.name);
  logger.error("Plugin tools listing failed", {
    workflow_id: workflowId,
    plugin_id: server.pluginId,
    server: server.entry.name,
    failure_kind: failure.kind,
  });
  switch (failure.kind) {
    case "application":
      return failedPreconditionError(listingFailureMessage(name, server.entry, failure.message));
    case "timeout":
      return new ConnectError(
        `listing the tools of ${name} did not complete within the ${LIST_TOOLS_TIMEOUT.label} budget — ` +
          "if this repeats, check that your runner is running and healthy",
        Code.DeadlineExceeded,
      );
    case "service-not-found":
      return unavailableError(`listing the tools of ${name} is temporarily unavailable`);
    case "other":
      return new ConnectError(listingFailureMessage(name, server.entry, failure.message), Code.Internal);
    default: {
      const exhaustive: never = failure;
      throw new Error(`unhandled listing failure ${String(exhaustive)}`);
    }
  }
}

/**
 * A transport-aware failure message. The runner classifies a sign-in
 * challenge into a self-contained sentence ("requires OAuth"), which is
 * passed through as it is. A local program fails on a missing command or
 * its arguments; a server at an address on reachability or its login.
 */
export function listingFailureMessage(name: string, entry: McpServerEntry, cause: string): string {
  if (cause.includes("requires OAuth")) {
    return cause;
  }
  if (entry.transport.case === "stdio") {
    return (
      `listing the tools of ${name} failed: ${cause}. It is a local program the runner starts — ` +
      "check that the command is installed and its arguments and variables are right"
    );
  }
  return (
    `listing the tools of ${name} failed: ${cause}. Check that the server's address is ` +
    "reachable and your sign-in or key is valid"
  );
}
