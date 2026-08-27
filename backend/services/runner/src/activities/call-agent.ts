/**
 * CallAgent Temporal activity — creates a Stigmer AgentExecution via
 * the platform gRPC API and uses Temporal async completion.
 *
 * Flow:
 * 1. Extract Temporal task token (for async completion callback)
 * 2. Resolve runtime placeholders (${.secrets.*}, ${.env_vars.*})
 * 3. Resolve agent by slug → get agent ID and default instance
 * 4. Apply Session (idempotent get-or-create by slug)
 * 5. Create AgentExecution (callback token, parent workflow ID)
 * 6. Throw CompleteAsyncError — worker thread released
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
import { loadConfig, type Config } from "../config.js";
import { resolveObjectPlaceholders } from "../workflow-engine/resolve.js";
import type { AgentCallConfig } from "../workflow-engine/types.js";
import { startHeartbeat } from "../shared/heartbeat.js";
import { create, type JsonObject } from "@bufbuild/protobuf";
import { AgentExecutionSpecSchema, ExecutionConfigSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/spec_pb";
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
  appConfig: Config = loadConfig(),
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

  // The execution is always created in the workflow's org — the workflow
  // owner pays for the run. A cross-org agent reference ("org/slug") only
  // changes where the agent blueprint is looked up, never the billing org.
  const orgId = (runtimeEnv["__stigmer_org_id"] as string | undefined) ?? "";

  if (!orgId) {
    throw new Error(
      "call:agent requires an organization context. " +
      "Ensure '__stigmer_org_id' is in the workflow environment.",
    );
  }

  const client = new StigmerClient({
    endpoint: appConfig.stigmerBackendEndpoint,
    token: appConfig.stigmerToken,
    tokenRef: appConfig.stigmerTokenRef,
    // The child-execution create must authenticate as the RUNNER, not the
    // user: it stamps the workflow lineage labels, which cloud's
    // reserved-label guard and environment composer accept only from
    // runner-class callers. The client's credential-selection table routes
    // exactly that create to this credential; null (OSS/local, no mint)
    // falls through to the control-plane token unchanged. The refs live only
    // on the runner's INJECTED Config (loadConfig() rebuilds from env and
    // never carries them), which is why the factory passes it in.
    runnerTokenRef: appConfig.stigmerRunnerTokenRef,
  });

  const agentRef = parseAgentReference(resolved.agent, orgId);
  const agent = await client.getAgentByReference(
    create(ApiResourceReferenceSchema, agentRef),
  );

  const agentId = agent.metadata?.id ?? "";
  const defaultInstanceId = agent.status?.defaultInstanceId ?? "";
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

  const wfExecId = (resolved as unknown as Record<string, unknown>).__wfExecId as string | undefined
    ?? runtimeEnv["__stigmer_execution_id"] as string | undefined;
  const taskName = (resolved as unknown as Record<string, unknown>).__taskName as string | undefined;

  let sessionName: string;
  let executionName: string;

  if (wfExecId && taskName) {
    const taskKey = `${wfExecId}-${taskName}`;
    sessionName = `ses-wf-${taskKey}`;
    executionName = `aex-wf-${taskKey}-${shortUniqueId()}`;
  } else {
    console.warn(
      `[CallAgent] Missing workflow context for session naming: ` +
      `wfExecId=${wfExecId ?? "(missing)"}, taskName=${taskName ?? "(missing)"}. ` +
      `Using timestamp-based names — session will NOT be reused on retry.`,
    );
    sessionName = `wf-${extractSlug(resolved.agent)}-${Math.floor(Date.now() / 1000)}`;
    executionName = `aex-wf-${extractSlug(resolved.agent)}-${Date.now()}`;
  }

  console.log(
    `[CallAgent] session=${sessionName}, execution=${executionName}, ` +
    `wfExecId=${wfExecId ?? "(none)"}, task=${taskName ?? "(none)"}`,
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
        agentInstanceId: defaultInstanceId,
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

  const parentQueue = runtimeEnv["__stigmer_activity_task_queue"] as string | undefined;
  const activityTaskQueue = parentQueue?.startsWith("wfexec:") ? parentQueue : "";

  // Honest RunConfig → ExecutionConfig mapping (issue #358): every field
  // the author may set is forwarded to a field the runner enforces.
  // model_name replaces the agent's default outright; max_cost_usd feeds
  // the harness-generic cost guards (cost-cap middleware / cursor
  // cost-guard); max_tool_rounds feeds resolveRecursionLimit (native
  // harness only); service_tier and thinking_mode feed the cursor
  // harness's explicit variant selection (issues #357/#772). Zero/unset
  // means "no override" and is omitted.
  const runConfig = resolved.run_config;
  const hasModel = !!runConfig?.model_name;
  const hasCostCap = (runConfig?.max_cost_usd ?? 0) > 0;
  const hasToolRounds = (runConfig?.max_tool_rounds ?? 0) > 0;
  // Loader guarantees a canonical enum name; an unknown one here means the
  // loader and this mapping drifted — fail the task, never silently drop a
  // variant directive.
  const SERVICE_TIER_BY_NAME: Record<string, ServiceTier> = {
    SERVICE_TIER_STANDARD: ServiceTier.STANDARD,
    SERVICE_TIER_FAST: ServiceTier.FAST,
  };
  const serviceTier = runConfig?.service_tier
    ? SERVICE_TIER_BY_NAME[runConfig.service_tier]
    : undefined;
  if (runConfig?.service_tier && serviceTier === undefined) {
    throw new Error(
      `call:agent run_config.service_tier '${runConfig.service_tier}' has no proto mapping`,
    );
  }
  const hasServiceTier = serviceTier !== undefined;
  const THINKING_MODE_BY_NAME: Record<string, ThinkingMode> = {
    THINKING_MODE_DISABLED: ThinkingMode.DISABLED,
    THINKING_MODE_ENABLED: ThinkingMode.ENABLED,
  };
  const thinkingMode = runConfig?.thinking_mode
    ? THINKING_MODE_BY_NAME[runConfig.thinking_mode]
    : undefined;
  if (runConfig?.thinking_mode && thinkingMode === undefined) {
    throw new Error(
      `call:agent run_config.thinking_mode '${runConfig.thinking_mode}' has no proto mapping`,
    );
  }
  const hasThinkingMode = thinkingMode !== undefined;
  const hasOutputSchema = !!resolved.output?.schema;

  console.log(
    `[CallAgent] schema propagation diagnostic: ` +
    `hasOutputSchema=${hasOutputSchema}, ` +
    `hasModel=${hasModel}, hasCostCap=${hasCostCap}, hasToolRounds=${hasToolRounds}, ` +
    `hasServiceTier=${hasServiceTier}, ` +
    `configKeys=[${Object.keys(resolved).join(",")}], ` +
    `hasOutput=${resolved.output !== undefined}, ` +
    `outputKeys=${resolved.output ? JSON.stringify(Object.keys(resolved.output)) : "N/A"}, ` +
    `__taskName=${(resolved as any).__taskName ?? "MISSING"}, ` +
    `wfExecId=${wfExecId ?? "MISSING"}`,
  );

  const executionSpec = create(AgentExecutionSpecSchema, {
    sessionId,
    agentId,
    message: resolved.message,
    callbackToken: taskToken,
    parentWorkflowId,
    activityTaskQueue,
    runtimeEnv: runtimeEnvProto,
  });

  if (hasModel || hasCostCap || hasToolRounds || hasServiceTier || hasThinkingMode || hasOutputSchema) {
    const execConfig = create(ExecutionConfigSchema, {});
    if (hasModel) execConfig.modelName = runConfig!.model_name!;
    if (hasCostCap) execConfig.maxCostUsd = runConfig!.max_cost_usd!;
    if (hasToolRounds) execConfig.maxToolRounds = runConfig!.max_tool_rounds!;
    if (hasServiceTier) execConfig.serviceTier = serviceTier!;
    if (hasThinkingMode) execConfig.thinkingMode = thinkingMode!;
    if (hasOutputSchema) {
      execConfig.structuredOutputSchema = resolved.output!.schema as JsonObject;
    }
    executionSpec.executionConfig = execConfig;
  }

  // Workflow provenance labels: the server's CreateExecutionContextStep
  // keys the agent_call environment_refs resolution on these (the
  // schedule-label lineage). The cloud edition additionally gates the
  // branch on the trusted runner caller identity, so the labels are only
  // load-bearing inside that trust boundary.
  const labels: Record<string, string> = {};
  if (wfExecId && taskName) {
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
// merged environment (DD-018 D-4), which the task's environment_refs feed
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
