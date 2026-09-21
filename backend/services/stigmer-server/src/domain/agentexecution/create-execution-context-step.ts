/**
 * The ExecutionContext builder — ports create_execution_context_step.go:
 * builds and persists an ExecutionContext with a fully-merged environment
 * for an agent execution. Shared by the create pipeline
 * (newCreateExecutionContextStep) and the recover pipeline
 * (lifecycle.ts's recreate step): recovery must rebuild the EC because
 * the failed run's workflow cleanup deleted it, and re-resolving from the
 * CURRENT agent/instance/environment configuration is the desired
 * semantics ("fix the API key, then recover").
 *
 * Resolution chain:
 *   - Path A (preResolvedInstanceId): agentInstanceLoader → agentLoader
 *   - Path B (session_id): sessionLoader → session.agent_instance_id →
 *     agentInstanceLoader → agentLoader; an EMPTY agent_instance_id is the
 *     built-in assistant (session/v1/spec.proto): no instance, no agent,
 *     no instance layers, and the session's own MCP servers are the whole
 *     tool set.
 *
 * Merge priority (lowest to highest): schedule/workflow-task
 * environment_refs (the share/channel/schedule/agent_call layering) →
 * instance environment_refs (via the environment RuntimeResolutionService
 * — decrypted, the RPC surface redacts, oss#405) → spec.runtime_env.
 *
 * Then ONE declaration rule for every shape: the run declares what its
 * agent declares and what its session's MCP servers declare, and the
 * least-privilege filter keeps exactly those keys. A session server rides
 * no agent instance, so its declared variables have no environment_refs
 * to arrive through; the ones still missing after the merge are resolved
 * the way the MCP connect lane resolves them — OAuth tokens from the
 * managed grant, the rest from the caller's personal environment, by
 * declared key only (domain/environment/personal.ts). The built-in
 * assistant is the case with no agent half, not an arm of its own.
 * Around that rule: the workspace-provisioning re-injection, and the
 * required-keys warning.
 */
import { create } from "@bufbuild/protobuf";

import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import type { McpServerUsage } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";
import type { AgentInstance } from "@stigmer/protos/ai/stigmer/agentic/agentinstance/v1/api_pb";
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { AgentExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { AgentExecutionSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/spec_pb";
import type { Environment } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/api_pb";
import type { EnvironmentList } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/io_pb";
import {
  EnvironmentSecretValueInputSchema,
  ListEnvironmentsRequestSchema,
} from "@stigmer/protos/ai/stigmer/agentic/environment/v1/io_pb";
import { EnvironmentValueSchema } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/spec_pb";
import type {
  EnvVarDeclaration,
  EnvironmentValue,
} from "@stigmer/protos/ai/stigmer/agentic/environment/v1/spec_pb";
import type { ExecutionContext } from "@stigmer/protos/ai/stigmer/agentic/executioncontext/v1/api_pb";
import { ExecutionContextSchema } from "@stigmer/protos/ai/stigmer/agentic/executioncontext/v1/api_pb";
import type { ExecutionValue } from "@stigmer/protos/ai/stigmer/agentic/executioncontext/v1/spec_pb";
import { ExecutionValueSchema } from "@stigmer/protos/ai/stigmer/agentic/executioncontext/v1/spec_pb";
import { McpServerSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import type { McpServer } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { ScheduleSchema } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/api_pb";
import type { Session } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { WorkflowSchema } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";
import type { Workflow } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";
import { WorkflowTaskKind } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/enum_pb";
import type { AgentCallTaskConfig } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/tasks/agent_call_pb";
import { WorkflowExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import { WorkflowInstanceSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowinstance/v1/api_pb";
import type { ApiResourceReference } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import { ApiResourceReferenceSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { MessageInitShape } from "@bufbuild/protobuf";

import { ConnectError } from "@connectrpc/connect";

import type { Logger } from "../../boot/logger.js";
import {
  filterByDeclaredKeys,
  mergeEnvironmentLayers,
  validateRequiredKeys,
} from "../../envmerge/envmerge.js";
import {
  failedPreconditionError,
  goWrappedStatusError,
} from "../../pipeline/errors.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import { findResourceBySlug } from "../../pipeline/steps/helpers.js";
import { ResourceNotFoundError } from "../../store/interface.js";
import type { OAuthGrant, Store } from "../../store/interface.js";
import {
  PERSONAL_LABEL_KEY,
  PERSONAL_LABEL_VALUE,
} from "../environment/constants.js";
import { resolveDeclaredFromPersonalEnvironment } from "../environment/personal.js";
import type { PersonalEnvironmentResolution } from "../environment/personal.js";
import type { RuntimeResolutionService } from "../environment/resolution/resolution.js";
import type { ManagedEnvironmentService } from "../mcpserver/oauth/managed-env.js";
import { refreshTokenIfExpired } from "../mcpserver/oauth/refresh.js";
import { unmarshalTaskConfig } from "../workflow/converter/unmarshal.js";

import { DEFAULT_INSTANCE_ID_KEY } from "./create-steps.js";

/**
 * The audit link stamped on every schedule-created execution by the run
 * starter — the environment-resolution key here. Pinned locally with its
 * lineage (Go scheduletemporal.ScheduleIDLabelKey; the schedule domain is
 * #22): the enabledtools/temporal-config precedent for pre-porting a
 * cross-domain constant the consumer needs first.
 */
export const SCHEDULE_ID_LABEL_KEY = "stigmer.ai/schedule-id";

/**
 * Workflow provenance labels, stamped by the workflow runner's CallAgent
 * activity on every execution it creates. Consumed as the
 * environment-resolution key — OSS has no caller tokens to carry a claim,
 * and this single-user edition has no trust boundary the labels could
 * widen (the DD-015 divergence posture).
 */
export const WORKFLOW_EXECUTION_ID_LABEL_KEY =
  "stigmer.ai/workflow-execution-id";
export const WORKFLOW_TASK_LABEL_KEY = "stigmer.ai/workflow-task";

/**
 * Environment variable keys the agent-runner needs for workspace
 * provisioning, re-injected after env_spec filtering when the session has
 * git_repo workspace entries (GITHUB_TOKEN is a session-level workspace
 * concern, not an agent-declared tool dependency).
 */
export const WORKSPACE_PROVISIONING_KEYS = ["GITHUB_TOKEN"];

// ---------------------------------------------------------------------------
// The narrow in-process edges the builder consumes (DD-002 lazy providers).
// ---------------------------------------------------------------------------

export interface AgentInstanceLoader {
  get(instanceId: string): Promise<AgentInstance>;
}
export interface SessionLoader {
  get(sessionId: string): Promise<Session>;
}
export interface EnvironmentReader {
  list(
    request: MessageInitShape<typeof ListEnvironmentsRequestSchema>,
  ): Promise<EnvironmentList>;
  getSecretValue(
    input: MessageInitShape<typeof EnvironmentSecretValueInputSchema>,
  ): Promise<EnvironmentValue>;
}
export interface ExecutionContextCreator {
  create(ec: ExecutionContext): Promise<ExecutionContext>;
}

export interface ExecutionContextBuilderDeps {
  readonly store: Store;
  readonly logger: Logger;
  readonly agentLoader: () => { get(agentId: string): Promise<Agent> };
  readonly agentInstanceLoader: () => AgentInstanceLoader;
  readonly sessionLoader: () => SessionLoader;
  readonly environmentReader: () => EnvironmentReader;
  readonly environmentResolution: RuntimeResolutionService;
  readonly executionContextCreator: () => ExecutionContextCreator;
  readonly managedEnvService: ManagedEnvironmentService;
  /** Test seam forwarded to the OAuth token-endpoint refresh. */
  readonly fetchImpl?: typeof fetch;
}

/**
 * CreateExecutionContext — the create pipeline's step: runs the shared
 * builder, then clears the consumed runtime_env from the execution — a
 * create-only concern (recover has no runtime_env to clear). Clearing
 * ensures secrets never appear in the persisted execution or in Temporal
 * workflow history.
 */
export function newCreateExecutionContextStep(
  deps: ExecutionContextBuilderDeps,
): PipelineStep<typeof AgentExecutionSchema> {
  return {
    name: "CreateExecutionContext",
    async execute(ctx) {
      const execution = ctx.newState;

      // Path A: the instance resolved by CreateDefaultInstanceIfNeeded,
      // when the request came in by agent_id. Empty for session-first
      // requests, which the builder resolves via the session (Path B).
      const resolved = ctx.get(DEFAULT_INSTANCE_ID_KEY);
      const preResolvedInstanceId =
        typeof resolved === "string" ? resolved : "";

      await buildAndPersistExecutionContext(
        deps,
        execution,
        preResolvedInstanceId,
      );

      if (Object.keys(execution.spec?.runtimeEnv ?? {}).length > 0) {
        deps.logger.debug(
          "Clearing runtime_env from execution (consumed into ExecutionContext)",
          {
            executionId: execution.metadata?.id ?? "",
            clearedEntries: Object.keys(execution.spec?.runtimeEnv ?? {})
              .length,
          },
        );
        const spec = (execution.spec ??= create(AgentExecutionSpecSchema));
        spec.runtimeEnv = {};
      }
    },
  };
}

/**
 * Resolves the environment for the execution and persists a fresh
 * ExecutionContext (Go buildAndPersist). preResolvedInstanceId
 * short-circuits instance resolution; "" resolves via the execution's
 * session_id (the only path recover needs). Failures throw — the create
 * pipeline surfaces them as-is; the wrapping context matches Go's %w
 * chains in the logged (never wire) message.
 */
export async function buildAndPersistExecutionContext(
  deps: ExecutionContextBuilderDeps,
  execution: AgentExecution,
  preResolvedInstanceId: string,
): Promise<void> {
  const executionId = execution.metadata?.id ?? "";
  const executionOrg = execution.metadata?.org ?? "";

  // 1. Resolve the target: the instance the run is bound to, and the
  // session when Path B loaded it on the way. An empty instance id with a
  // session is the built-in assistant.
  let target: ResolvedTarget;
  try {
    target = await resolveTarget(deps, execution, preResolvedInstanceId);
  } catch (error) {
    chainError("resolve agent instance", error);
  }
  const { agentInstanceId } = target;
  let session = target.session;

  // 2.–3. Load the instance (environment_refs + agent_id), then the
  // agent (env declarations) — in-process, full chain traversal. Load
  // failures keep the inner status code with Go's wrap prefix. Neither
  // exists for the built-in assistant.
  let instance: AgentInstance | undefined;
  let agentResource: Agent | undefined;
  let agentId = "";
  if (agentInstanceId !== "") {
    try {
      instance = await deps.agentInstanceLoader().get(agentInstanceId);
    } catch (error) {
      if (error instanceof ConnectError) {
        throw goWrappedStatusError(
          `load agent instance ${agentInstanceId}`,
          error,
        );
      }
      chainError(`load agent instance ${agentInstanceId}`, error);
    }
    agentId = instance.spec?.agentId ?? "";
    try {
      agentResource = await deps.agentLoader().get(agentId);
    } catch (error) {
      if (error instanceof ConnectError) {
        throw goWrappedStatusError(`load agent ${agentId}`, error);
      }
      chainError(`load agent ${agentId}`, error);
    }
  }

  // 3.5 The session, when Path A did not load it: its workspace entries
  // and its own MCP servers shape the environment below. A failed load is
  // non-fatal for an agent-bound run (the agent's declarations still
  // stand); the built-in assistant always arrives through Path B, so its
  // session is already in hand or the resolve above refused.
  const sessionId = execution.spec?.sessionId ?? "";
  if (session === undefined && sessionId !== "") {
    try {
      session = await deps.sessionLoader().get(sessionId);
    } catch (error) {
      deps.logger.warn(
        "Failed to load session for environment resolution (non-fatal)",
        {
          executionId,
          error: error instanceof Error ? error.message : String(error),
        },
      );
    }
  }
  const sessionMcpServers = await loadSessionMcpServers(
    deps,
    session,
    executionOrg,
  );

  // 4. Resolve environments from instance environment_refs.
  let environments = await resolveEnvironments(
    deps,
    instance?.spec?.environmentRefs ?? [],
  );

  // 4.5 Schedule-created executions: the schedule's own environment_refs
  // merge BELOW instance refs (lowest priority — the AgentShare/
  // AgentChannel layering, DD-017). This is how a tool-using agent
  // becomes schedulable: the schedule binds the credentials its
  // unattended runs need without touching the agent or its instance.
  const scheduleEnvironments = await resolveScheduleEnvironments(
    deps,
    execution,
  );
  if (scheduleEnvironments.length > 0) {
    environments = [...scheduleEnvironments, ...environments];
  }

  // 4.6 Workflow-created executions (agent_call): the task's own
  // environment_refs, same lowest-priority layering — fourth in the
  // share/channel/schedule lineage (issue #358 Phase 2). At most one of
  // 4.5/4.6 applies: an execution is created by a schedule fire or by a
  // workflow task, never both.
  const workflowEnvironments = await resolveWorkflowTaskEnvironments(
    deps,
    execution,
  );
  if (workflowEnvironments.length > 0) {
    environments = [...workflowEnvironments, ...environments];
  }

  // 5. Merge all layers.
  const merged = mergeEnvironmentLayers(
    environments,
    execution.spec?.runtimeEnv ?? {},
  );

  // 6. Least-privilege whitelist over the ONE declared set: the agent's
  // env united with the session servers' env (the module header's rule).
  // Empty declarations pass everything through.
  const declarations = unionDeclarations(
    agentResource?.spec?.env ?? {},
    sessionMcpServers,
  );
  const filterResult = filterByDeclaredKeys(merged, declarations);
  let filtered = filterResult.filtered;
  if (filterResult.excludedKeys.length > 0) {
    deps.logger.warn("Filtered env vars not declared by the agent or the session's servers", {
      executionId,
      agentId,
      excludedKeys: filterResult.excludedKeys,
    });
  }

  // 6.5 Re-inject workspace-provisioning keys excluded by the filter,
  // and fall back to the caller's personal environment for keys never in
  // the merge chain at all.
  if (session !== undefined) {
    filtered = injectWorkspaceProvisioningKeys(
      deps.logger,
      filtered,
      merged,
      session,
      executionId,
    );
    filtered = await injectFromPersonalEnvironment(
      deps,
      filtered,
      session,
      executionOrg,
      executionId,
    );
  }

  // 6.8 Inject OAuth tokens from managed environments — iterated
  // over the merged agent + session MCP usages so session-level servers
  // (added at runtime) get their tokens too. Refresh failures are FATAL
  // (FailedPrecondition): an expired token must prevent execution rather
  // than fail opaquely mid-run with a 401.
  const mergedMcpUsages = mergeAgentAndSessionMcpUsages(
    agentResource,
    session,
  );
  try {
    filtered = await injectMcpOAuthFromManagedEnvironment(
      deps,
      filtered,
      mergedMcpUsages,
      executionOrg,
      executionId,
    );
  } catch (error) {
    throw failedPreconditionError(
      error instanceof Error ? error.message : String(error),
    );
  }

  // 6.85 The session servers' declared variables the chain did not carry
  // (no instance layer ever could): the caller's personal environment, by
  // declared key. Non-fatal — the run fails at the tool with a clearer
  // error if a key is truly required, the posture of every fallback here.
  filtered = await injectSessionServerDeclaredFromPersonalEnvironment(
    deps,
    filtered,
    sessionMcpServers,
    executionOrg,
    executionId,
  );

  // 6.9 Warn on missing required declared vars — the downstream
  // execution fails with a clearer error if truly needed.
  const missingRequired = validateRequiredKeys(filtered, declarations);
  if (missingRequired.length > 0) {
    deps.logger.warn(
      "Required env vars missing after environment merge — execution may fail",
      { executionId, agentId, missingRequired },
    );
  }

  deps.logger.info("Merged environment layers for execution context", {
    executionId,
    mergedCount: merged.size,
    filteredCount: filtered.size,
    environmentRefsCount: instance?.spec?.environmentRefs.length ?? 0,
    builtInAssistant: agentInstanceId === "",
  });

  // 7. Build and persist the ExecutionContext through the in-process
  // client (the executioncontext create pipeline owns encryption,
  // ciphertext rejection, and indexing).
  const ec = create(ExecutionContextSchema, {
    apiVersion: "agentic.stigmer.ai/v1",
    kind: "ExecutionContext",
    metadata: {
      name: `exec-ctx-${executionId}`,
      org: executionOrg,
    },
    spec: {
      executionId,
      data: Object.fromEntries(filtered),
    },
  });
  let created: ExecutionContext;
  try {
    created = await deps.executionContextCreator().create(ec);
  } catch (error) {
    if (error instanceof ConnectError) {
      throw goWrappedStatusError(
        `create execution context for ${executionId}`,
        error,
      );
    }
    chainError(`create execution context for ${executionId}`, error);
  }

  deps.logger.info("Successfully created execution context", {
    executionContextId: created.metadata?.id ?? "",
    executionId,
    dataEntries: filtered.size,
  });
}

/**
 * Go's %w wrap chains, mirrored: the INNERMOST status boundary renders
 * through goWrappedStatusError ("prefix: rpc error: code = X desc = …");
 * every OUTER wrap prepends plain text while preserving the inner code —
 * exactly how nested fmt.Errorf("%s: %w") chains reach the wire through
 * the pipeline's errors.As branch (the #852 leak). Plain errors chain as
 * plain errors and land on the pipeline's Internal fallback, Go's
 * non-status path.
 */
function chainError(prefix: string, error: unknown): never {
  if (error instanceof ConnectError) {
    throw new ConnectError(`${prefix}: ${error.rawMessage}`, error.code);
  }
  throw new Error(
    `${prefix}: ${error instanceof Error ? error.message : String(error)}`,
  );
}

/**
 * The run's target (Go resolveAgentInstanceID, widened): Path A answers
 * the pre-resolved instance alone; Path B loads the session and answers
 * its instance, which is "" for the built-in assistant, together with the
 * session so the caller does not load it twice. A persisted execution
 * always carries session_id (lifecycle.ts recover), so the no-session arm
 * is an invariant, not a shape.
 */
interface ResolvedTarget {
  readonly agentInstanceId: string;
  readonly session: Session | undefined;
}

async function resolveTarget(
  deps: ExecutionContextBuilderDeps,
  execution: AgentExecution,
  preResolvedInstanceId: string,
): Promise<ResolvedTarget> {
  if (preResolvedInstanceId !== "") {
    return { agentInstanceId: preResolvedInstanceId, session: undefined };
  }
  const sessionId = execution.spec?.sessionId ?? "";
  if (sessionId === "") {
    throw new Error(
      "neither a pre-resolved instance id nor session_id on execution",
    );
  }
  let session: Session;
  try {
    session = await deps.sessionLoader().get(sessionId);
  } catch (error) {
    if (error instanceof ConnectError) {
      throw goWrappedStatusError(`load session ${sessionId}`, error);
    }
    throw new Error(
      `load session ${sessionId}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return { agentInstanceId: session.spec?.agentInstanceId ?? "", session };
}

/**
 * Loads the MCP servers a session declares on its own (spec.mcp_server_usages),
 * by slug in the usage's org or the execution's. A server that cannot be
 * found is skipped: the runner resolves the same usages for real and
 * refuses there with the tool's own error; this pass only needs the
 * declarations of the servers that exist.
 */
async function loadSessionMcpServers(
  deps: ExecutionContextBuilderDeps,
  session: Session | undefined,
  executionOrg: string,
): Promise<McpServer[]> {
  const servers: McpServer[] = [];
  for (const usage of session?.spec?.mcpServerUsages ?? []) {
    const slug = usage.mcpServerRef?.slug ?? "";
    const org = usage.mcpServerRef?.org || executionOrg;
    if (slug === "" || org === "") {
      continue;
    }
    let server: McpServer | undefined;
    try {
      server = await findResourceBySlug(
        deps.store,
        ApiResourceKind.mcp_server,
        McpServerSchema,
        slug,
        org,
      );
    } catch {
      continue;
    }
    if (server !== undefined) {
      servers.push(server);
    }
  }
  return servers;
}

/**
 * The one declared set of a run: the agent's env declarations united with
 * every session server's. On a key both declare, the agent's declaration
 * wins (it is the author's word for the run as a whole; the server's is
 * the tool's word for itself).
 */
function unionDeclarations(
  agentEnv: { readonly [key: string]: EnvVarDeclaration },
  sessionMcpServers: readonly McpServer[],
): { [key: string]: EnvVarDeclaration } {
  const union: { [key: string]: EnvVarDeclaration } = {};
  for (const server of sessionMcpServers) {
    Object.assign(union, server.spec?.env ?? {});
  }
  Object.assign(union, agentEnv);
  return union;
}

/**
 * Resolves the session servers' declared variables still missing after
 * the merge and the OAuth injection from the caller's personal
 * environment, by declared key. OAuth-target variables are left to the
 * managed grant (an absent grant is the sign-in the console asks for, not
 * a personal-environment lookup). Every failure is non-fatal here: a
 * missing key is logged and the run meets the tool's own error.
 */
async function injectSessionServerDeclaredFromPersonalEnvironment(
  deps: ExecutionContextBuilderDeps,
  filtered: Map<string, ExecutionValue>,
  sessionMcpServers: readonly McpServer[],
  executionOrg: string,
  executionId: string,
): Promise<Map<string, ExecutionValue>> {
  const wanted: { [key: string]: EnvVarDeclaration } = {};
  for (const server of sessionMcpServers) {
    const oauthKey = server.spec?.auth?.targetEnvVar ?? "";
    for (const [key, decl] of Object.entries(server.spec?.env ?? {})) {
      if (key === oauthKey || filtered.has(key)) {
        continue;
      }
      wanted[key] = decl;
    }
  }
  if (Object.keys(wanted).length === 0 || executionOrg === "") {
    return filtered;
  }

  let resolution: PersonalEnvironmentResolution;
  try {
    resolution = await resolveDeclaredFromPersonalEnvironment(
      deps.environmentReader(),
      deps.logger,
      executionOrg,
      wanted,
    );
  } catch (error) {
    deps.logger.warn(
      "Failed to resolve session servers' variables from the personal environment (non-fatal)",
      {
        executionId,
        error: error instanceof Error ? error.message : String(error),
      },
    );
    return filtered;
  }
  if (resolution.kind === "no-personal-environment") {
    deps.logger.debug(
      "No personal environment — session servers' declared variables stay unresolved",
      { executionId, keys: Object.keys(wanted).sort() },
    );
    return filtered;
  }
  if (resolution.missing.length > 0) {
    deps.logger.warn(
      "Session servers declare required variables the personal environment does not hold",
      { executionId, missing: [...resolution.missing].sort() },
    );
  }
  const entries = Object.entries(resolution.values);
  if (entries.length === 0) {
    return filtered;
  }
  const out = new Map(filtered);
  for (const [key, value] of entries) {
    out.set(key, value);
  }
  deps.logger.info(
    "Injected session servers' declared variables from the caller's personal environment",
    { executionId, keys: entries.map(([key]) => key).sort() },
  );
  return out;
}

/**
 * Fetches each referenced Environment in order via the runtime-resolution
 * service, NOT the GetByReference RPC: the RPC surface redacts secret
 * values (oss#405); this internal path returns them decrypted for the
 * execution-context merge. An unresolvable ref fails the create — an
 * authoring error must surface as a deterministic refusal, never a silent
 * run without credentials.
 */
async function resolveEnvironments(
  deps: ExecutionContextBuilderDeps,
  refs: ApiResourceReference[],
): Promise<Environment[]> {
  if (refs.length === 0) {
    return [];
  }
  const environments: Environment[] = [];
  for (const ref of refs) {
    try {
      environments.push(await deps.environmentResolution.resolveByReference(ref));
    } catch (error) {
      // The resolution service throws typed statuses (NotFound for a
      // deleted environment) — the inner code must reach the wire so a
      // caller-fixable authoring error never masquerades as a 500.
      if (error instanceof ConnectError) {
        throw goWrappedStatusError(
          `resolve environment ref (org=${ref.org}, slug=${ref.slug})`,
          error,
        );
      }
      chainError(
        `resolve environment ref (org=${ref.org}, slug=${ref.slug})`,
        error,
      );
    }
  }
  return environments;
}

/**
 * Resolves the environment_refs of the schedule that created this
 * execution (the stigmer.ai/schedule-id label). No label — the common
 * case — answers empty at the cost of one map lookup; a DELETED schedule
 * degrades to no schedule environments; an unresolvable REF fails the
 * create (Go resolveScheduleEnvironments).
 */
async function resolveScheduleEnvironments(
  deps: ExecutionContextBuilderDeps,
  execution: AgentExecution,
): Promise<Environment[]> {
  const scheduleId =
    execution.metadata?.labels[SCHEDULE_ID_LABEL_KEY] ?? "";
  if (scheduleId === "") {
    return [];
  }

  let schedule;
  try {
    schedule = await deps.store.getResource(
      ApiResourceKind.schedule,
      scheduleId,
      ScheduleSchema,
    );
  } catch (error) {
    if (error instanceof ResourceNotFoundError) {
      deps.logger.warn(
        "Schedule-labeled execution's schedule row is gone — running without schedule environments",
        { scheduleId, executionId: execution.metadata?.id ?? "" },
      );
      return [];
    }
    throw new Error(
      `load schedule ${scheduleId} for environment resolution: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const target = schedule.spec?.target;
  const refs =
    target?.case === "agent" ? (target.value.environmentRefs ?? []) : [];
  if (refs.length === 0) {
    return [];
  }

  // A manifest ref may omit the org (relative to the schedule's own —
  // the same-org invariant pins agent_ref.org == metadata.org).
  const resolved = refs.map((ref) =>
    ref.org === ""
      ? create(ApiResourceReferenceSchema, {
          kind: ref.kind,
          org: schedule.metadata?.org ?? "",
          slug: ref.slug,
        })
      : ref,
  );

  try {
    return await resolveEnvironments(deps, resolved);
  } catch (error) {
    chainError(`resolve schedule ${scheduleId} environment_refs`, error);
  }
}

/**
 * Resolves the environment_refs of the agent_call task that created this
 * execution (the workflow-provenance labels). Missing labels — every
 * non-workflow execution — answer empty; a deleted/renamed workflow
 * execution, workflow, or task degrades to no workflow environments; an
 * unresolvable REF fails the create (Go resolveWorkflowTaskEnvironments).
 */
async function resolveWorkflowTaskEnvironments(
  deps: ExecutionContextBuilderDeps,
  execution: AgentExecution,
): Promise<Environment[]> {
  const labels = execution.metadata?.labels ?? {};
  const workflowExecutionId = labels[WORKFLOW_EXECUTION_ID_LABEL_KEY] ?? "";
  const taskName = labels[WORKFLOW_TASK_LABEL_KEY] ?? "";
  if (workflowExecutionId === "" || taskName === "") {
    return [];
  }
  const executionId = execution.metadata?.id ?? "";

  let workflowExecution;
  try {
    workflowExecution = await deps.store.getResource(
      ApiResourceKind.workflow_execution,
      workflowExecutionId,
      WorkflowExecutionSchema,
    );
  } catch (error) {
    if (error instanceof ResourceNotFoundError) {
      deps.logger.warn(
        "Workflow-labeled execution's workflow execution row is gone — running without workflow environments",
        { workflowExecutionId, executionId },
      );
      return [];
    }
    throw new Error(
      `load workflow execution ${workflowExecutionId} for environment resolution: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  let workflowId = workflowExecution.spec?.workflowId ?? "";
  if (workflowId === "") {
    // Instance-first executions carry only the instance id.
    const instanceId = workflowExecution.spec?.workflowInstanceId ?? "";
    if (instanceId === "") {
      return [];
    }
    try {
      const instance = await deps.store.getResource(
        ApiResourceKind.workflow_instance,
        instanceId,
        WorkflowInstanceSchema,
      );
      workflowId = instance.spec?.workflowId ?? "";
    } catch (error) {
      if (error instanceof ResourceNotFoundError) {
        deps.logger.warn(
          "Workflow-labeled execution's instance row is gone — running without workflow environments",
          { workflowInstanceId: instanceId, executionId },
        );
        return [];
      }
      throw new Error(
        `load workflow instance ${instanceId} for environment resolution: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  if (workflowId === "") {
    return [];
  }

  let workflow: Workflow;
  try {
    workflow = await deps.store.getResource(
      ApiResourceKind.workflow,
      workflowId,
      WorkflowSchema,
    );
  } catch (error) {
    if (error instanceof ResourceNotFoundError) {
      deps.logger.warn(
        "Workflow-labeled execution's workflow row is gone — running without workflow environments",
        { workflowId, executionId },
      );
      return [];
    }
    throw new Error(
      `load workflow ${workflowId} for environment resolution: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const refs = agentCallTaskEnvironmentRefs(deps.logger, workflow, taskName);
  if (refs.length === 0) {
    return [];
  }

  // A ref may omit the org (relative form); resolution follows the
  // workflow's org — also the execution's billing org.
  const resolved = refs.map((ref) =>
    ref.org === ""
      ? create(ApiResourceReferenceSchema, {
          kind: ref.kind,
          org: workflow.metadata?.org ?? "",
          slug: ref.slug,
        })
      : ref,
  );

  try {
    return await resolveEnvironments(deps, resolved);
  } catch (error) {
    chainError(
      `resolve workflow ${workflowId} task "${taskName}" environment_refs`,
      error,
    );
  }
}

/**
 * Extracts the environment_refs of the named agent_call task. A missing/
 * renamed task, a non-agent_call task under that name, or an unparsable
 * config all answer empty — the binding no longer exists in the current
 * revision, the degrade-not-fail case (Go agentCallTaskEnvironmentRefs).
 */
export function agentCallTaskEnvironmentRefs(
  logger: Logger,
  workflow: Workflow,
  taskName: string,
): ApiResourceReference[] {
  for (const task of workflow.spec?.tasks ?? []) {
    if (task.name !== taskName || task.kind !== WorkflowTaskKind.agent_call) {
      continue;
    }
    let msg;
    try {
      msg = unmarshalTaskConfig(task.kind, task.taskConfig);
    } catch (error) {
      logger.warn(
        "agent_call task config no longer parses — running without workflow environments",
        {
          taskName,
          error: error instanceof Error ? error.message : String(error),
        },
      );
      return [];
    }
    const cfg = msg as AgentCallTaskConfig;
    return cfg.environmentRefs;
  }
  return [];
}

/**
 * Re-injects provisioning keys excluded by the declared-key filter, only
 * when the session actually has git_repo workspace entries (Go
 * injectWorkspaceProvisioningKeys; the copy-on-write is preserved so the
 * caller's maps are never mutated).
 */
function injectWorkspaceProvisioningKeys(
  logger: Logger,
  filtered: Map<string, ExecutionValue>,
  merged: Map<string, ExecutionValue>,
  session: Session,
  executionId: string,
): Map<string, ExecutionValue> {
  const hasGitRepo = (session.spec?.workspaceEntries ?? []).some(
    (entry) => entry.source?.source.case === "gitRepo",
  );
  if (!hasGitRepo) {
    return filtered;
  }

  let out = filtered;
  let injected = false;
  for (const key of WORKSPACE_PROVISIONING_KEYS) {
    if (out.has(key)) {
      continue;
    }
    const val = merged.get(key);
    if (val === undefined) {
      continue;
    }
    if (!injected) {
      out = new Map(out);
      injected = true;
    }
    out.set(key, val);
    logger.info(
      "Re-injected workspace-provisioning key after env_spec filter (session has git_repo entries)",
      { executionId, key },
    );
  }
  return out;
}

/**
 * The fallback for provisioning keys absent from the merge chain
 * entirely: looks up the caller's personal environment (org +
 * stigmer.ai/personal=true) and injects the decrypted secret. ALL
 * failures are non-fatal — the downstream git clone fails with a clear
 * auth error if the token is truly required (Go
 * injectFromPersonalEnvironment).
 */
async function injectFromPersonalEnvironment(
  deps: ExecutionContextBuilderDeps,
  filtered: Map<string, ExecutionValue>,
  session: Session,
  executionOrg: string,
  executionId: string,
): Promise<Map<string, ExecutionValue>> {
  const hasGitRepo = (session.spec?.workspaceEntries ?? []).some(
    (entry) => entry.source?.source.case === "gitRepo",
  );
  if (!hasGitRepo) {
    return filtered;
  }

  const missing = WORKSPACE_PROVISIONING_KEYS.filter(
    (key) => !filtered.has(key),
  );
  if (missing.length === 0) {
    return filtered;
  }

  let listResponse: EnvironmentList;
  try {
    listResponse = await deps.environmentReader().list(
      create(ListEnvironmentsRequestSchema, {
        org: executionOrg,
        labels: { [PERSONAL_LABEL_KEY]: PERSONAL_LABEL_VALUE },
      }),
    );
  } catch (error) {
    deps.logger.warn(
      "Failed to list personal environments for provisioning key injection (non-fatal)",
      {
        executionId,
        error: error instanceof Error ? error.message : String(error),
      },
    );
    return filtered;
  }
  if (listResponse.totalCount === 0 || listResponse.items.length === 0) {
    deps.logger.debug(
      "No personal environment found — skipping provisioning key injection from personal env",
      { executionId, org: executionOrg },
    );
    return filtered;
  }

  const personalEnv = listResponse.items[0] as Environment;
  const personalEnvId = personalEnv.metadata?.id ?? "";

  let out = filtered;
  let injected = false;
  for (const key of missing) {
    // The personal env's spec.data keys are present even when redacted,
    // so existence is checkable before the GetSecretValue call. Own-key
    // membership (Go map semantics — never the prototype chain).
    if (!Object.hasOwn(personalEnv.spec?.data ?? {}, key)) {
      continue;
    }
    let secretValue: EnvironmentValue;
    try {
      secretValue = await deps.environmentReader().getSecretValue(
        create(EnvironmentSecretValueInputSchema, {
          environmentId: personalEnvId,
          key,
        }),
      );
    } catch (error) {
      deps.logger.warn(
        "Failed to retrieve secret from personal environment (non-fatal)",
        {
          executionId,
          key,
          personalEnvId,
          error: error instanceof Error ? error.message : String(error),
        },
      );
      continue;
    }
    if (secretValue.value === "") {
      continue;
    }
    if (!injected) {
      out = new Map(out);
      injected = true;
    }
    out.set(
      key,
      create(ExecutionValueSchema, { value: secretValue.value, isSecret: true }),
    );
    deps.logger.info(
      "Injected workspace-provisioning key from caller's personal environment",
      { executionId, key, personalEnvId },
    );
  }
  return out;
}

/**
 * Combines MCP server usages from the agent and session, deduplicating by
 * slug with agent-level usages taking priority — so servers added at the
 * session level (e.g. via the UI at runtime) are included in OAuth token
 * injection too (Go mergeAgentAndSessionMcpUsages).
 */
export function mergeAgentAndSessionMcpUsages(
  agentResource: Agent | undefined,
  session: Session | undefined,
): McpServerUsage[] {
  const merged = new Map<string, McpServerUsage>();
  // Session usages first (lower priority).
  for (const usage of session?.spec?.mcpServerUsages ?? []) {
    const slug = usage.mcpServerRef?.slug ?? "";
    if (slug !== "") {
      merged.set(slug, usage);
    }
  }
  // Agent usages override (higher priority).
  for (const usage of agentResource?.spec?.mcpServerUsages ?? []) {
    const slug = usage.mcpServerRef?.slug ?? "";
    if (slug !== "") {
      merged.set(slug, usage);
    }
  }
  return [...merged.values()];
}

/**
 * Reads OAuth-managed access tokens from managed environments for MCP
 * servers with spec.auth: grant lookup by (identity="", server_id, org) —
 * OSS single-user — then inline pre-flight refresh if expired, then the
 * token read. Refresh failures THROW (fatal; the caller maps to
 * FailedPrecondition); read failures are non-fatal skips (Go
 * injectMcpOAuthFromManagedEnvironment).
 */
async function injectMcpOAuthFromManagedEnvironment(
  deps: ExecutionContextBuilderDeps,
  filtered: Map<string, ExecutionValue>,
  mcpServerUsages: McpServerUsage[],
  executionOrg: string,
  executionId: string,
): Promise<Map<string, ExecutionValue>> {
  if (mcpServerUsages.length === 0) {
    return filtered;
  }

  let out = filtered;
  let injected = false;
  for (const usage of mcpServerUsages) {
    const ref = usage.mcpServerRef;
    const slug = ref?.slug ?? "";
    if (slug === "") {
      continue;
    }
    let serverOrg = ref?.org ?? "";
    if (serverOrg === "") {
      serverOrg = executionOrg;
    }
    if (serverOrg === "") {
      continue;
    }

    let mcpServer;
    try {
      mcpServer = await findResourceBySlug(
        deps.store,
        ApiResourceKind.mcp_server,
        McpServerSchema,
        slug,
        serverOrg,
      );
    } catch {
      continue;
    }
    if (mcpServer === undefined || mcpServer.spec?.auth === undefined) {
      continue;
    }

    const mcpServerId = mcpServer.metadata?.id ?? "";
    const grant = await deps.store.oauthGrants
      .find("", mcpServerId, serverOrg)
      .catch(() => undefined);
    if (grant === undefined) {
      continue;
    }

    const oauthKey = grant.accessTokenEnvVar;
    if (oauthKey === "") {
      continue;
    }
    if (out.has(oauthKey)) {
      continue;
    }

    const managedEnvId = grant.environmentId;
    if (managedEnvId === "") {
      deps.logger.warn(
        "OAuth grant has no managed environment ID — skipping token injection",
        { mcpServerId, executionId },
      );
      continue;
    }

    // Inline pre-flight refresh if expired; failures are fatal — an
    // expired token must not be silently injected.
    let refreshResult;
    try {
      refreshResult = await inlineRefreshIfExpired(deps, grant, managedEnvId);
    } catch (error) {
      throw new Error(
        `OAuth token refresh failed for MCP server '${mcpServerId}': ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (refreshResult !== undefined && refreshResult.refreshed) {
      try {
        await deps.store.oauthGrants.upsert({
          ...grant,
          accessTokenExpiresAt: refreshResult.newExpiresAt,
        });
      } catch (error) {
        deps.logger.warn(
          "Failed to update OAuth grant after inline refresh (non-fatal)",
          {
            mcpServerId,
            error: error instanceof Error ? error.message : String(error),
          },
        );
      }
    }

    let tokenValue: string;
    try {
      tokenValue = await deps.managedEnvService.readSecretValue(
        managedEnvId,
        oauthKey,
      );
    } catch (error) {
      deps.logger.warn(
        "Failed to read OAuth token from managed environment (non-fatal)",
        {
          mcpServerId,
          oauthKey,
          managedEnvId,
          executionId,
          error: error instanceof Error ? error.message : String(error),
        },
      );
      continue;
    }
    if (tokenValue === "") {
      deps.logger.warn(
        "Failed to read OAuth token from managed environment (non-fatal)",
        { mcpServerId, oauthKey, managedEnvId, executionId },
      );
      continue;
    }

    if (!injected) {
      out = new Map(out);
      injected = true;
    }
    out.set(
      oauthKey,
      create(ExecutionValueSchema, { value: tokenValue, isSecret: true }),
    );
    deps.logger.info("Injected OAuth token from managed environment", {
      executionId,
      mcpServerId,
      oauthKey,
      managedEnvId,
    });
  }
  return out;
}

/**
 * Reads the refresh token from the managed environment and refreshes if
 * the access token is expired; undefined when the refresh token is
 * unavailable (Go inlineRefreshIfExpired). No client_secret resolution on
 * this path — DCR/public clients work without it, and vendor OAuth's
 * connect pre-flight (#19) owns the OAuthApp lookup; no secret means no
 * token-endpoint auth method either.
 */
async function inlineRefreshIfExpired(
  deps: ExecutionContextBuilderDeps,
  grant: OAuthGrant,
  managedEnvId: string,
): Promise<import("../mcpserver/oauth/refresh.js").RefreshResult | undefined> {
  let currentRefreshToken: string;
  try {
    currentRefreshToken = await deps.managedEnvService.readSecretValue(
      managedEnvId,
      grant.refreshTokenEnvVar,
    );
  } catch {
    return undefined;
  }
  if (currentRefreshToken === "") {
    return undefined;
  }

  const result = await refreshTokenIfExpired(
    grant,
    currentRefreshToken,
    "",
    "",
    deps.logger,
    deps.fetchImpl ?? fetch,
  );
  if (!result.refreshed) {
    return result;
  }

  const tokenVariables: { [key: string]: EnvironmentValue } = {
    [grant.accessTokenEnvVar]: create(EnvironmentValueSchema, {
      value: result.newAccessToken,
      isSecret: true,
    }),
  };
  if (result.newRefreshToken !== currentRefreshToken) {
    tokenVariables[grant.refreshTokenEnvVar] = create(EnvironmentValueSchema, {
      value: result.newRefreshToken,
      isSecret: true,
    });
  }
  try {
    await deps.managedEnvService.updateSecrets(managedEnvId, tokenVariables);
  } catch (error) {
    throw new Error(
      `failed to write refreshed tokens to managed environment: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return result;
}
