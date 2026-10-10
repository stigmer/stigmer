/**
 * VaultValueController.fetchValues: hands a runner the values one
 * execution uses, opened from their vaults when its work starts. The only
 * read that answers plaintext, and nothing is stored behind it: a run
 * records where its values live (its source manifest, planned at create),
 * and this read opens exactly those entries as they are now
 * (domain/vault/resolve.ts).
 *
 * The gate. The method is skip-authorization because a permission cannot
 * tell a runner from the person it acts for; the authority is the runner
 * credential the server minted for the execution, presented as a Bearer
 * header. With the composed `authorizeExecutionValuesRead` capability the
 * edition owns the whole decision (the cloud's session and connect scope
 * rules). Without it, the open-source decision: an execution-scoped token
 * whose binding equals the requested execution, and a bound execution that
 * is live (runnerauth/bound-execution.ts: a run not terminal, or ended
 * within the grace; a connect's attempt row present and unexpired). A run
 * credential, which carries no clock, may bind only a run. Anything else
 * is refused with PERMISSION_DENIED: no lane answers redacted.
 *
 * What it opens. A run's manifest, every entry (VaultResolver.openRun). A
 * tools listing's attempt: a plan made now over the listing person's My
 * vault, for the one server listed (VaultResolver.openConnect). A refusal at
 * opening (an entry gone, a vault no longer usable, a tool moved, a
 * renewal refused) is FAILED_PRECONDITION with the resolver's message,
 * which the runner shows the person as the turn's failure.
 *
 * A composed decision answers whose credential this is; the bound
 * execution's liveness is required after it as well.
 *
 * Proven by __tests__/values.test.ts and the vault conformance suites.
 */
import type { HandlerContext } from "@connectrpc/connect";

import { PluginSchema } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import type { Plugin } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import { RunSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import type { Run } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import type {
  ExecutionValues,
  FetchExecutionValuesInput,
} from "@stigmer/protos/ai/stigmer/agentic/vault/v1/values_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { Logger } from "../../boot/logger.js";
import {
  failedPreconditionError,
  internalError,
  invalidArgumentError,
  permissionDeniedError,
} from "../../pipeline/errors.js";
import { parseBearerToken } from "../../pipeline/interceptors/auth.js";
import {
  bindsARun,
  loadBoundExecution,
} from "../../runnerauth/bound-execution.js";
import type { BoundExecution } from "../../runnerauth/bound-execution.js";
import type { RunnerCredentialProvider } from "../../runnerauth/runner-credential-provider.js";
import {
  isClockedToken,
  TOKEN_TYPE_EXECUTION_SCOPED,
} from "../../runnerauth/runnerauth.js";
import { ResourceNotFoundError } from "../../store/interface.js";
import type { Store } from "../../store/interface.js";

import type { VaultResolver } from "./resolve.js";

export interface ExecutionValuesDeps {
  readonly store: Store;
  readonly logger: Logger;
  /** Verifies the execution-scoped credential; may compose the whole decision. */
  readonly runnerAuth: RunnerCredentialProvider;
  readonly vaultResolver: VaultResolver;
  /** Unix milliseconds; injectable for the liveness arms. */
  readonly now?: () => number;
}

/** The one refusal every caller outside the gate gets, whatever the reason. */
const NOT_BOUND_MESSAGE =
  "only a runner credential bound to this live execution may fetch its values";

export async function fetchExecutionValues(
  deps: ExecutionValuesDeps,
  input: FetchExecutionValuesInput,
  ctx: HandlerContext,
): Promise<ExecutionValues> {
  const executionId = input.executionId;
  if (executionId === "") {
    throw invalidArgumentError("execution_id is required");
  }
  const token = parseBearerToken(ctx.requestHeader.get("authorization") ?? "");
  const bound = token === "" ? undefined : await boundExecutionFor(deps, token, executionId);
  if (bound === undefined) {
    throw permissionDeniedError(NOT_BOUND_MESSAGE);
  }

  switch (bound.kind) {
    case "agent-execution":
      return deps.vaultResolver.openRun(await loadRun(deps, executionId));
    case "mcp-connect":
      return openConnectValues(deps, executionId);
    /* v8 ignore next -- @preserve: the exhaustiveness guard over a closed union; no value reaches it */
    default: {
      const exhaustive: never = bound.kind;
      throw new Error(`unknown bound execution kind ${String(exhaustive)}`);
    }
  }
}

/**
 * The trust decision, shared with the connect lane's backfill check: the
 * execution `token` may read the values of, when it may (bound and live),
 * else undefined. The composed capability when present, the open-source
 * one otherwise, and in both cases a bound execution that is live. A composed decision answers
 * whose credential this is; it cannot know a run's phase, so a run that
 * ended past the grace (or a connect whose attempt is gone) is refused
 * here whatever it answered. A capability that throws is a composition
 * fault, logged and refused.
 */
export async function boundExecutionFor(
  deps: Pick<ExecutionValuesDeps, "store" | "logger" | "runnerAuth" | "now">,
  token: string,
  executionId: string,
): Promise<BoundExecution | undefined> {
  const authorize = deps.runnerAuth.authorizeExecutionValuesRead?.bind(deps.runnerAuth);
  if (authorize !== undefined) {
    let allowed: boolean;
    try {
      allowed = await authorize(token, executionId);
    } catch (error) {
      deps.logger.warn("Execution values read authorization failed; refusing", {
        error: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
    return allowed ? boundAndLive(deps, executionId) : undefined;
  }

  let bound: string;
  try {
    bound = deps.runnerAuth.verify(TOKEN_TYPE_EXECUTION_SCOPED, token);
  } catch {
    return undefined;
  }
  if (bound !== executionId) {
    deps.logger.warn("A runner credential asked for another execution's values; refusing", {
      tokenExecutionId: bound,
      executionId,
    });
    return undefined;
  }
  const execution = await boundAndLive(deps, executionId);
  return execution !== undefined && (isClockedToken(token) || bindsARun(execution.kind))
    ? execution
    : undefined;
}

/** The bound execution when it exists and is live (runnerauth/bound-execution.ts), else undefined. */
async function boundAndLive(
  deps: Pick<ExecutionValuesDeps, "store" | "now">,
  executionId: string,
): Promise<BoundExecution | undefined> {
  let execution: BoundExecution | undefined;
  try {
    execution = await loadBoundExecution(deps.store, executionId, (deps.now ?? Date.now)());
  } catch (error) {
    throw internalError(error, "failed to load the credential's execution");
  }
  return execution?.live === true ? execution : undefined;
}

async function loadRun(deps: ExecutionValuesDeps, runId: string): Promise<Run> {
  try {
    return await deps.store.getResource(ApiResourceKind.run, runId, RunSchema);
  } catch (error) {
    if (error instanceof ResourceNotFoundError) {
      throw permissionDeniedError(NOT_BOUND_MESSAGE);
    }
    throw internalError(error, "failed to load the run");
  }
}

/** A listing's values: a plan made now over the person's My vault, for the one server listed. */
async function openConnectValues(
  deps: ExecutionValuesDeps,
  connectId: string,
): Promise<ExecutionValues> {
  const now = Math.floor((deps.now ?? Date.now)() / 1000);
  const attempt = await deps.store.connectAttempts.findLive(connectId, now);
  if (attempt === undefined) {
    throw failedPreconditionError("this tools listing is over: list the tools again");
  }
  let plugin: Plugin;
  try {
    plugin = await deps.store.getResource(ApiResourceKind.plugin, attempt.pluginId, PluginSchema);
  } catch (error) {
    if (error instanceof ResourceNotFoundError) {
      throw failedPreconditionError(
        `plugin ${attempt.pluginId} no longer exists: its tools cannot be listed`,
      );
    }
    throw internalError(error, "failed to load the listing's plugin");
  }
  const entry = plugin.status?.mcpServers.find((server) => server.name === attempt.server);
  if (entry === undefined) {
    throw failedPreconditionError(
      `plugin ${plugin.metadata?.name ?? attempt.pluginId} no longer has a server named ${attempt.server}: its tools cannot be listed`,
    );
  }
  return deps.vaultResolver.openConnect({
    orgId: attempt.org,
    person: attempt.person === "" ? undefined : attempt.person,
    server: {
      pluginId: attempt.pluginId,
      pluginName: plugin.metadata?.name ?? "",
      pluginDigest: plugin.status?.digest ?? "",
      entry,
      env: plugin.status?.env ?? {},
    },
  });
}
