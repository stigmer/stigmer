/**
 * CallAgent Temporal activity — creates a Stigmer AgentExecution via
 * the platform gRPC API and uses Temporal async completion.
 *
 * Flow:
 * 1. Extract Temporal task token (for async completion callback)
 * 2. Resolve runtime placeholders (${.secrets.*}, ${.env_vars.*})
 * 3. Resolve the agent by reference, for its id and its env declarations;
 *    a row missing its id, organization or slug is refused
 * 4. Apply the Session on the agent's reference (idempotent get-or-create
 *    by name); the server pins the agent's current version on create and
 *    keeps that pin when a retry re-applies the same reference
 * 5. Create the AgentExecution in that session, linked to the workflow run
 *    by `parent` (workflow execution id, the workflow to signal, the task
 *    token), carrying the step's settings as the turn's request
 *    (`spec.run_config`, never an approval mode) and its output schema
 * 6. Throw CompleteAsyncError — worker thread released
 *
 * The session names the agent itself, never a stand-in: a step that names
 * an agent runs that agent or fails, and never falls back to the built-in
 * assistant. The `parent` link is what lets the platform complete this
 * activity, and what the server derives the child's dispatch queue from
 * (the workflow run's own sandbox), so a call with no workflow execution
 * id fails here rather than creating a turn nothing would ever wait on.
 * The link's three values come from the runner's own run, never from
 * workflow data: the workflow execution id and the workflow to signal
 * are the engine's own (its execution id and its Temporal workflow id),
 * and the callback token is this activity's own task token. The server
 * honours the link only from the runner it vouches for that workflow run.
 *
 * The platform completes this activity asynchronously via the token
 * when the agent execution workflow finishes.
 *
 * Activity contract:
 *   Name:   "CallAgent"
 *   Input:  (config, runtimeEnv, parentWorkflowId)
 *   Output: (completed asynchronously by platform)
 */

import { randomUUID } from "node:crypto";
import { Context, CompleteAsyncError } from "@temporalio/activity";
import { StigmerClient } from "../client/stigmer-client.js";
import type { Config } from "../config.js";
import { resolveObjectPlaceholders } from "../workflow-engine/resolve.js";
import type { AgentCallConfig, AgentCallRunConfig } from "../workflow-engine/types.js";
import { startHeartbeat } from "../shared/heartbeat.js";
import { create, type JsonObject } from "@bufbuild/protobuf";
import {
  AgentExecutionSpecSchema,
  WorkflowParentSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/spec_pb";
import { RunConfigSchema, type RunConfig } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/invocation_pb";
import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { SessionSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/spec_pb";
import { Harness, ExecutionTarget } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";
import { ServiceTier, ThinkingMode } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import {
  WorkspaceEntrySchema,
  WorkspaceSourceSchema,
  GitRepoSourceSchema,
  type WorkspaceEntry,
} from "@stigmer/protos/ai/stigmer/agentic/session/v1/workspace_pb";
import { AgentExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ExecutionValueSchema } from "@stigmer/protos/ai/stigmer/agentic/executioncontext/v1/spec_pb";
import type { ExecutionValue } from "@stigmer/protos/ai/stigmer/agentic/executioncontext/v1/spec_pb";
import { ApiResourceMetadataSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";
import { ApiResourceReferenceSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

export async function callAgentAction(
  config: AgentCallConfig,
  runtimeEnv: Record<string, unknown>,
  parentWorkflowId: string,
  appConfig: Config,
): Promise<void> {
  const taskToken = Context.current().info.taskToken;

  const resolved = resolveObjectPlaceholders(config, runtimeEnv) as AgentCallConfig;

  if (!resolved.agent) {
    throw new Error(
      "call:agent: 'agent' resolved to empty after placeholder substitution. " +
      "If using ${.secrets.X} or ${.env_vars.X}, ensure the referenced key " +
      "exists in the workflow's env block and is provisioned in the environment.",
    );
  }

  if (!resolved.message) {
    throw new Error(
      "call:agent: 'message' resolved to empty after placeholder substitution. " +
      "The agent requires a non-empty prompt message.",
    );
  }

  // The child is always created in the organization the workflow
  // execution runs in, which pays for the run; that is the workflow's own
  // unless a person ran it from another organization by id. A bare slug
  // names an agent of that same organization. An "org/slug" reference
  // only changes where the agent blueprint is looked up, never the
  // billing organization.
  const orgId = (runtimeEnv["__stigmer_org_id"] as string | undefined) ?? "";

  if (!orgId) {
    throw new Error(
      "call:agent requires an organization context. " +
      "Ensure '__stigmer_org_id' is in the workflow environment.",
    );
  }

  const wfExecId = (resolved as unknown as Record<string, unknown>).__wfExecId as string | undefined
    || runtimeEnv["__stigmer_execution_id"] as string | undefined;
  const taskName = (resolved as unknown as Record<string, unknown>).__taskName as string | undefined;

  if (!wfExecId) {
    throw new Error(
      `call:agent '${resolved.agent}' has no workflow execution id ` +
      `(neither the task's '__wfExecId' nor '__stigmer_execution_id' in the workflow environment): ` +
      `the agent's turn must be linked to the workflow run that waits for it, ` +
      `and an unlinked turn could never complete this step.`,
    );
  }

  const client = new StigmerClient({
    endpoint: appConfig.stigmerBackendEndpoint,
    tokenRef: appConfig.stigmerTokenRef,
    // The child-execution create must authenticate as the RUNNER, not the
    // user: it carries the `parent` link and stamps the workflow lineage
    // labels, which the server's vouch and cloud's reserved-label guard and
    // environment composer accept only from runner-class callers. The
    // client's credential-selection table routes exactly that create to
    // this credential; null (OSS/local, no mint) falls through to the
    // control-plane token unchanged. The refs are the runner's injected
    // Config's (config.ts header), which is why the factory passes it in.
    runnerTokenRef: appConfig.stigmerRunnerTokenRef,
  });

  const agentRef = parseAgentReference(resolved.agent, orgId);
  const agent = await client.getAgentByReference(
    create(ApiResourceReferenceSchema, agentRef),
  );

  const agentId = agent.metadata?.id ?? "";
  const agentEnvKeys = Object.keys(agent.spec?.env ?? {});
  const workflowEnvKeys = Object.keys(runtimeEnv).filter(k => !k.startsWith("__stigmer_"));
  console.log(
    `[CallAgent] agent=${resolved.agent} agentId=${agentId} ` +
    `agentEnvDecls=[${agentEnvKeys.join(",")}] ` +
    `workflowEnvKeys=[${workflowEnvKeys.join(",")}]`,
  );

  if (!agentId) {
    throw new Error(`Agent '${resolved.agent}' resolved but has no metadata.id`);
  }
  // The session below names the agent by its org and slug, and a session
  // whose agent reference carries an empty slug is the built-in assistant
  // (session/v1/spec.proto): a row missing either is refused here, so the
  // step runs the agent it names or fails.
  if (!agent.metadata?.org) {
    throw new Error(`Agent '${resolved.agent}' resolved but has no metadata.org`);
  }
  if (!agent.metadata?.slug) {
    throw new Error(`Agent '${resolved.agent}' resolved but has no metadata.slug`);
  }

  let sessionName: string;
  let executionName: string;

  if (taskName) {
    const taskKey = `${wfExecId}-${taskName}`;
    sessionName = `ses-wf-${taskKey}`;
    executionName = `aex-wf-${taskKey}-${shortUniqueId()}`;
  } else {
    console.warn(
      `[CallAgent] Missing task name for session naming: wfExecId=${wfExecId}. ` +
      `Using timestamp-based names — session will NOT be reused on retry.`,
    );
    sessionName = `wf-${extractSlug(resolved.agent)}-${Math.floor(Date.now() / 1000)}`;
    executionName = `aex-wf-${extractSlug(resolved.agent)}-${Date.now()}`;
  }

  console.log(
    `[CallAgent] session=${sessionName}, execution=${executionName}, ` +
    `wfExecId=${wfExecId}, task=${taskName ?? "(none)"}`,
  );

  const harness = resolveHarness(resolved.harness);
  const executionTarget = resolveExecutionTarget(
    runtimeEnv["__stigmer_execution_target"] as number | undefined,
  );

  const session = await client.applySession(
    create(SessionSchema, {
      apiVersion: "agentic.stigmer.ai/v1",
      kind: "Session",
      metadata: create(ApiResourceMetadataSchema, {
        name: sessionName,
        org: orgId,
      }),
      spec: create(SessionSpecSchema, {
        // The agent the reference resolved to, in its own organization:
        // the task's grammar names no version, so the server pins the
        // agent's current version when it creates the session and keeps
        // that pin when a retry re-applies the same reference.
        agentRef: create(ApiResourceReferenceSchema, {
          kind: ApiResourceKind.agent,
          org: agent.metadata?.org ?? "",
          slug: agent.metadata?.slug ?? "",
          version: "",
        }),
        harness,
        executionTarget,
        subject: "Auto-created session",
        workspaceEntries: buildWorkspaceEntries(resolved.workspace_entries),
      }),
    }),
  );
  const sessionId = session?.metadata?.id ?? "";

  const executionRuntimeEnv: Record<string, { value: string; isSecret: boolean }> = {};

  // Automatic intersection forwarding: forward workflow env vars that match the
  // child agent's declared spec.env keys. This avoids requiring workflow authors
  // to manually re-declare every env var on every agent_call task.
  const agentEnvDecls = agent.spec?.env ?? {};
  for (const [key, decl] of Object.entries(agentEnvDecls)) {
    if (key in runtimeEnv && runtimeEnv[key] != null) {
      executionRuntimeEnv[key] = {
        value: String(runtimeEnv[key]),
        isSecret: decl.isSecret ?? false,
      };
    }
  }

  const intersectionKeys = Object.keys(executionRuntimeEnv);
  const skippedKeys = agentEnvKeys.filter(k => !(k in executionRuntimeEnv));
  if (skippedKeys.length > 0) {
    console.warn(
      `[CallAgent] agent declares env keys not present in workflow env: [${skippedKeys.join(",")}]`,
    );
  }

  // Task-config-level env takes precedence over auto-forwarded values.
  // The agent's declared secret marking survives the override: a key the
  // agent declares secret stays secret no matter which channel supplied
  // the value, so an explicit task-level `env:` entry cannot downgrade
  // redaction (issue #358 — the override used to hardcode isSecret:false).
  if (resolved.env) {
    for (const [key, value] of Object.entries(resolved.env)) {
      executionRuntimeEnv[key] = {
        value: String(value),
        isSecret: agentEnvDecls[key]?.isSecret ?? false,
      };
    }
  }

  const finalKeys = Object.keys(executionRuntimeEnv);
  const overrideKeys = finalKeys.filter(k => !intersectionKeys.includes(k));
  console.log(
    `[CallAgent] env forwarding: intersection=${intersectionKeys.length} ` +
    `taskOverrides=${overrideKeys.length} total=${finalKeys.length} ` +
    `keys=[${finalKeys.join(",")}]`,
  );

  const runtimeEnvProto: Record<string, ExecutionValue> = {};
  for (const [key, val] of Object.entries(executionRuntimeEnv)) {
    runtimeEnvProto[key] = create(ExecutionValueSchema, {
      value: val.value,
      isSecret: val.isSecret,
    });
  }

  // The step's settings travel to the child turn as its request
  // (`spec.run_config`), field for field: zero or empty means "not set at
  // this layer" and is carried as such, never filled in here. The settings
  // the turn RUNS WITH are resolved once by the control plane at create
  // (backend/services/stigmer-server/src/domain/agentexecution/resolve-run-config.ts):
  // the step's settings are the turn's layer, and the agent's defaults and
  // caps apply beneath it, so a step's bound can lower the agent's cap but
  // never raise it. The runner's guards read that resolution
  // (`status.run_config`), not this request.
  //
  // No approval mode is written: it is a fact of the lane the server
  // records. A workflow step is INTERACTIVE, and its parent workflow takes
  // the approval request.
  const stepRunConfig = resolved.run_config;
  const runConfig = stepRunConfig === undefined ? undefined : toRunConfig(stepRunConfig);
  const outputSchema = resolved.output?.schema;

  console.log(
    `[CallAgent] run settings: ` +
    `hasRunConfig=${runConfig !== undefined}, ` +
    `hasOutputSchema=${outputSchema !== undefined}, ` +
    `configKeys=[${Object.keys(resolved).join(",")}], ` +
    `task=${taskName ?? "(none)"}, ` +
    `wfExecId=${wfExecId}`,
  );

  const executionSpec = create(AgentExecutionSpecSchema, {
    target: { case: "sessionId", value: sessionId },
    message: resolved.message,
    parent: create(WorkflowParentSchema, {
      workflowExecutionId: wfExecId,
      signalWorkflowId: parentWorkflowId,
      callbackToken: taskToken,
    }),
    runtimeEnv: runtimeEnvProto,
    ...(runConfig !== undefined ? { runConfig } : {}),
    ...(outputSchema !== undefined ? { structuredOutputSchema: outputSchema as JsonObject } : {}),
  });

  // Workflow provenance labels: the server's CreateExecutionContextStep
  // keys the agent_call environment_refs resolution on these (the
  // schedule-label lineage). The cloud edition additionally gates the
  // branch on the trusted runner caller identity, so the labels are only
  // load-bearing inside that trust boundary. The execution-id label and
  // the `parent` link carry the same id, which the server requires.
  const labels: Record<string, string> = {};
  if (taskName) {
    labels["stigmer.ai/workflow-execution-id"] = wfExecId;
    labels["stigmer.ai/workflow-task"] = taskName;
  }

  await client.createAgentExecution(
    create(AgentExecutionSchema, {
      apiVersion: "agentic.stigmer.ai/v1",
      kind: "AgentExecution",
      metadata: create(ApiResourceMetadataSchema, {
        name: executionName,
        org: orgId,
        labels,
      }),
      spec: executionSpec,
    }),
  );

  throw new CompleteAsyncError();
}

// buildWorkspaceEntries maps the task's git-only workspace entries onto the
// shared session WorkspaceEntry proto. Provisioning credentials are NOT the
// runner's concern here: the provisioner resolves GITHUB_TOKEN from the
// merged environment, which the task's environment_refs feed
// via server-side resolution.
function buildWorkspaceEntries(
  entries: AgentCallConfig["workspace_entries"],
): WorkspaceEntry[] {
  if (!entries || entries.length === 0) return [];
  return entries.map((entry) =>
    create(WorkspaceEntrySchema, {
      name: entry.name ?? "",
      source: create(WorkspaceSourceSchema, {
        source: {
          case: "gitRepo",
          value: create(GitRepoSourceSchema, {
            url: entry.source.git_repo.url,
            branch: entry.source.git_repo.branch ?? "",
          }),
        },
      }),
    }),
  );
}

function parseAgentReference(
  agentStr: string,
  defaultOrg: string,
): { org: string; slug: string; kind: ApiResourceKind } {
  if (agentStr.includes("/")) {
    const [org, slug] = agentStr.split("/", 2);
    return { org, slug, kind: ApiResourceKind.agent };
  }
  return { org: defaultOrg, slug: agentStr, kind: ApiResourceKind.agent };
}

function extractSlug(agentStr: string): string {
  return agentStr.includes("/") ? agentStr.split("/", 2)[1] : agentStr;
}

function shortUniqueId(): string {
  return randomUUID().replace(/-/g, "").slice(0, 8);
}

function resolveHarness(harnessStr?: string): Harness {
  if (!harnessStr) return Harness.NATIVE;

  switch (harnessStr.toUpperCase()) {
    case "HARNESS_NATIVE":
    case "NATIVE":
      return Harness.NATIVE;
    case "HARNESS_CURSOR":
    case "CURSOR":
      return Harness.CURSOR;
    default:
      return Harness.NATIVE;
  }
}

function resolveExecutionTarget(target?: number): ExecutionTarget {
  if (target === 1) return ExecutionTarget.LOCAL;
  if (target === 2) return ExecutionTarget.CLOUD;
  return ExecutionTarget.UNSPECIFIED;
}

export function createCallAgentActivities(appConfig: Config) {
  return {
    CallAgent: async (
      config: AgentCallConfig,
      runtimeEnv: Record<string, unknown>,
      parentWorkflowId: string,
    ): Promise<void> => {
      const hb = startHeartbeat(15_000, () => ({ phase: "creating_agent_execution" }));
      try {
        return await callAgentAction(config, runtimeEnv, parentWorkflowId, appConfig);
      } finally {
        hb.stop();
      }
    },
  };
}

const SERVICE_TIER_BY_NAME: Readonly<Record<string, ServiceTier | undefined>> = {
  SERVICE_TIER_STANDARD: ServiceTier.STANDARD,
  SERVICE_TIER_FAST: ServiceTier.FAST,
};

const THINKING_MODE_BY_NAME: Readonly<Record<string, ThinkingMode | undefined>> = {
  THINKING_MODE_DISABLED: ThinkingMode.DISABLED,
  THINKING_MODE_ENABLED: ThinkingMode.ENABLED,
};

/**
 * The step's run_config as the proto message, every field carried as the
 * author wrote it (zero or empty stays "not set"). The loader guarantees a
 * canonical enum name for the tier and thinking mode; an unknown one here
 * means the loader and this mapping drifted, so the task fails rather than
 * silently dropping a variant directive.
 */
export function toRunConfig(step: AgentCallRunConfig): RunConfig {
  const serviceTier = step.service_tier ? SERVICE_TIER_BY_NAME[step.service_tier] : ServiceTier.UNSPECIFIED;
  if (serviceTier === undefined) {
    throw new Error(`call:agent run_config.service_tier '${step.service_tier}' has no proto mapping`);
  }
  const thinkingMode = step.thinking_mode ? THINKING_MODE_BY_NAME[step.thinking_mode] : ThinkingMode.UNSPECIFIED;
  if (thinkingMode === undefined) {
    throw new Error(`call:agent run_config.thinking_mode '${step.thinking_mode}' has no proto mapping`);
  }
  return create(RunConfigSchema, {
    modelName: step.model_name ?? "",
    maxCostUsd: step.max_cost_usd ?? 0,
    maxToolRounds: step.max_tool_rounds ?? 0,
    maxToolResultChars: step.max_tool_result_chars ?? 0,
    serviceTier,
    thinkingMode,
  });
}
