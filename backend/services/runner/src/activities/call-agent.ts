/**
 * CallAgent Temporal activity — creates a Stigmer AgentExecution via
 * the platform gRPC API and uses Temporal async completion.
 *
 * Flow:
 * 1. Extract Temporal task token (for async completion callback)
 * 2. Resolve runtime placeholders (${.secrets.*}, ${.env_vars.*})
 * 3. Resolve agent by slug → get agent ID and default instance
 * 4. Create Session (harness, runner affinity)
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

import { Context, CompleteAsyncError } from "@temporalio/activity";
import { ConnectError, Code } from "@connectrpc/connect";
import { StigmerClient } from "../client/stigmer-client.js";
import { loadConfig } from "../config.js";
import { resolveObjectPlaceholders } from "../workflow-engine/resolve.js";
import type { AgentCallConfig } from "../workflow-engine/types.js";
import { startHeartbeat } from "../shared/heartbeat.js";
import { create } from "@bufbuild/protobuf";
import { AgentExecutionSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/spec_pb";
import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { SessionSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/spec_pb";
import { Harness } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";
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

  const orgId = resolved.org
    ?? (runtimeEnv["__stigmer_org_id"] as string | undefined)
    ?? "";

  if (!orgId) {
    throw new Error(
      "call:agent requires an organization context. " +
      "Set 'org' in the task config or ensure '__stigmer_org_id' is in the workflow environment.",
    );
  }

  const appConfig = loadConfig();
  const client = new StigmerClient({
    endpoint: appConfig.stigmerBackendEndpoint,
    token: appConfig.stigmerToken,
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

  const wfExecId = runtimeEnv["__stigmer_execution_id"] as string | undefined;
  const taskName = (resolved as unknown as Record<string, unknown>).__taskName as string | undefined;

  let sessionName: string;
  let executionName: string;

  if (wfExecId && taskName) {
    const taskKey = `${wfExecId}-${taskName}`;
    sessionName = `ses-wf-${taskKey}`;
    executionName = `aex-wf-${taskKey}`;
  } else {
    sessionName = `wf-${extractSlug(resolved.agent)}-${Math.floor(Date.now() / 1000)}`;
    executionName = `aex-wf-${extractSlug(resolved.agent)}-${Date.now()}`;
  }

  const harness = resolveHarness(resolved.harness);

  let sessionId: string;
  try {
    const session = await client.createSession(
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
          subject: "Auto-created session",
        }),
      }),
    );
    sessionId = session?.metadata?.id ?? "";
  } catch (err) {
    if (err instanceof ConnectError && err.code === Code.AlreadyExists) {
      const existingId = extractExistingResourceId(err);
      if (existingId) {
        sessionId = existingId;
      } else {
        throw new Error(
          `Session '${sessionName}' already exists but its ID could not be resolved. ` +
          `This may occur during workflow recovery for task '${taskName ?? "unknown"}'.`,
        );
      }
    } else {
      throw err;
    }
  }

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

  // Task-config-level env takes precedence over auto-forwarded values
  if (resolved.env) {
    for (const [key, value] of Object.entries(resolved.env)) {
      executionRuntimeEnv[key] = { value: String(value), isSecret: false };
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

  const hasModel = !!resolved.config?.model;
  const hasOutputSchema = !!resolved.output?.schema;

  let executionConfig: Record<string, unknown> | undefined;
  if (hasModel || hasOutputSchema) {
    executionConfig = {};
    if (hasModel) executionConfig.modelName = resolved.config!.model;
    if (hasOutputSchema) executionConfig.structuredOutputSchema = resolved.output!.schema;
  }

  const executionSpec = create(AgentExecutionSpecSchema, {
    sessionId,
    agentId,
    message: resolved.message,
    callbackToken: taskToken,
    parentWorkflowId,
    activityTaskQueue,
    runtimeEnv: runtimeEnvProto,
    ...(executionConfig ? { executionConfig: executionConfig as any } : {}),
  });

  try {
    await client.createAgentExecution(
      create(AgentExecutionSchema, {
        apiVersion: "agentic.stigmer.ai/v1",
        kind: "AgentExecution",
        metadata: create(ApiResourceMetadataSchema, {
          name: executionName,
          org: orgId,
        }),
        spec: executionSpec,
      }),
    );
  } catch (err) {
    if (err instanceof ConnectError && err.code === Code.AlreadyExists) {
      const retryName = `${executionName}-r${Date.now()}`;
      await client.createAgentExecution(
        create(AgentExecutionSchema, {
          apiVersion: "agentic.stigmer.ai/v1",
          kind: "AgentExecution",
          metadata: create(ApiResourceMetadataSchema, {
            name: retryName,
            org: orgId,
          }),
          spec: executionSpec,
        }),
      );
    } else {
      throw err;
    }
  }

  throw new CompleteAsyncError();
}

/**
 * Extracts the existing resource ID from an ALREADY_EXISTS error message.
 *
 * Both the OSS Go server and the cloud Java server include the existing
 * resource ID in their duplicate-check error messages using the pattern
 * `(id: <resource_id>)`. Returns undefined if the pattern is not found.
 */
function extractExistingResourceId(err: ConnectError): string | undefined {
  const match = err.message.match(/\(id:\s*(\S+)\)/);
  return match?.[1];
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

export function createCallAgentActivities() {
  return {
    CallAgent: async (
      config: AgentCallConfig,
      runtimeEnv: Record<string, unknown>,
      parentWorkflowId: string,
    ): Promise<void> => {
      const hb = startHeartbeat(15_000, () => ({ phase: "creating_agent_execution" }));
      try {
        return await callAgentAction(config, runtimeEnv, parentWorkflowId);
      } finally {
        hb.stop();
      }
    },
  };
}
