// The full Stigmer proto registry for the docs YAML gate — the TS analogue
// of docs_yaml_gate.go's blank stub imports. Every resource package whose
// manifests may appear in docs must be listed; a missing entry means the
// gate reports "unknown kind" for that resource. The gate's own registry
// scan derives everything else (manifest kinds from protovalidate consts,
// variant types from discriminator options), so this list is the only
// hand-maintained piece.

import type { DescFile, DescMessage, Registry } from "@bufbuild/protobuf";
import { createRegistry } from "@bufbuild/protobuf";

import { file_ai_stigmer_agentic_agent_v1_api } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { file_ai_stigmer_agentic_agentchannel_v1_api } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/api_pb";
import { file_ai_stigmer_agentic_agentexecution_v1_api } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { file_ai_stigmer_agentic_agentinstance_v1_api } from "@stigmer/protos/ai/stigmer/agentic/agentinstance/v1/api_pb";
import { file_ai_stigmer_agentic_agentshare_v1_api } from "@stigmer/protos/ai/stigmer/agentic/agentshare/v1/api_pb";
import { file_ai_stigmer_agentic_artifact_v1_api } from "@stigmer/protos/ai/stigmer/agentic/artifact/v1/api_pb";
import { file_ai_stigmer_agentic_channelapp_v1_api } from "@stigmer/protos/ai/stigmer/agentic/channelapp/v1/api_pb";
import { file_ai_stigmer_agentic_environment_v1_api } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/api_pb";
import { file_ai_stigmer_agentic_executioncontext_v1_api } from "@stigmer/protos/ai/stigmer/agentic/executioncontext/v1/api_pb";
import { file_ai_stigmer_agentic_mcpserver_v1_api } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { file_ai_stigmer_agentic_memory_v1_api } from "@stigmer/protos/ai/stigmer/agentic/memory/v1/api_pb";
import { file_ai_stigmer_agentic_schedule_v1_api } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/api_pb";
import { file_ai_stigmer_agentic_session_v1_api } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { file_ai_stigmer_agentic_skill_v1_api } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/api_pb";
import { file_ai_stigmer_agentic_workflow_v1_enum } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/enum_pb";
import { file_ai_stigmer_agentic_workflow_v1_spec } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/spec_pb";
import { file_ai_stigmer_agentic_workflow_v1_api } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";
import { file_ai_stigmer_agentic_workflow_v1_tasks_agent_call } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/tasks/agent_call_pb";
import { file_ai_stigmer_agentic_workflow_v1_tasks_call_activity } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/tasks/call_activity_pb";
import { file_ai_stigmer_agentic_workflow_v1_tasks_common } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/tasks/common_pb";
import { file_ai_stigmer_agentic_workflow_v1_tasks_emit_event } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/tasks/emit_event_pb";
import { file_ai_stigmer_agentic_workflow_v1_tasks_eval } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/tasks/eval_pb";
import { file_ai_stigmer_agentic_workflow_v1_tasks_for } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/tasks/for_pb";
import { file_ai_stigmer_agentic_workflow_v1_tasks_fork } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/tasks/fork_pb";
import { file_ai_stigmer_agentic_workflow_v1_tasks_grpc_call } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/tasks/grpc_call_pb";
import { file_ai_stigmer_agentic_workflow_v1_tasks_http_call } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/tasks/http_call_pb";
import { file_ai_stigmer_agentic_workflow_v1_tasks_human_input } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/tasks/human_input_pb";
import { file_ai_stigmer_agentic_workflow_v1_tasks_listen } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/tasks/listen_pb";
import { file_ai_stigmer_agentic_workflow_v1_tasks_llm_call } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/tasks/llm_call_pb";
import { file_ai_stigmer_agentic_workflow_v1_tasks_notification } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/tasks/notification_pb";
import { file_ai_stigmer_agentic_workflow_v1_tasks_raise } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/tasks/raise_pb";
import { file_ai_stigmer_agentic_workflow_v1_tasks_run } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/tasks/run_pb";
import { file_ai_stigmer_agentic_workflow_v1_tasks_set } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/tasks/set_pb";
import { file_ai_stigmer_agentic_workflow_v1_tasks_switch } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/tasks/switch_pb";
import { file_ai_stigmer_agentic_workflow_v1_tasks_transform } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/tasks/transform_pb";
import { file_ai_stigmer_agentic_workflow_v1_tasks_try } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/tasks/try_pb";
import { file_ai_stigmer_agentic_workflow_v1_tasks_validate } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/tasks/validate_pb";
import { file_ai_stigmer_agentic_workflow_v1_tasks_wait } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/tasks/wait_pb";
import { file_ai_stigmer_agentic_workflowexecution_v1_api } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import { file_ai_stigmer_agentic_workflowinstance_v1_api } from "@stigmer/protos/ai/stigmer/agentic/workflowinstance/v1/api_pb";
import { file_ai_stigmer_iam_apikey_v1_api } from "@stigmer/protos/ai/stigmer/iam/apikey/v1/api_pb";
import { file_ai_stigmer_iam_iampolicy_v1_api } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/api_pb";
import { file_ai_stigmer_iam_identityaccount_v1_api } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import { file_ai_stigmer_iam_identityprovider_v1_api } from "@stigmer/protos/ai/stigmer/iam/identityprovider/v1/api_pb";
import { file_ai_stigmer_iam_invitation_v1_api } from "@stigmer/protos/ai/stigmer/iam/invitation/v1/api_pb";
import { file_ai_stigmer_iam_oauthapp_v1_api } from "@stigmer/protos/ai/stigmer/iam/oauthapp/v1/api_pb";
import { file_ai_stigmer_iam_platformclient_v1_api } from "@stigmer/protos/ai/stigmer/iam/platformclient/v1/api_pb";
import { file_ai_stigmer_tenancy_organization_v1_api } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";
import { file_ai_stigmer_tenancy_project_v1_api } from "@stigmer/protos/ai/stigmer/tenancy/project/v1/api_pb";

const ROOT_FILES: DescFile[] = [
  file_ai_stigmer_agentic_agent_v1_api,
  file_ai_stigmer_agentic_agentchannel_v1_api,
  file_ai_stigmer_agentic_agentexecution_v1_api,
  file_ai_stigmer_agentic_agentinstance_v1_api,
  file_ai_stigmer_agentic_agentshare_v1_api,
  file_ai_stigmer_agentic_artifact_v1_api,
  file_ai_stigmer_agentic_channelapp_v1_api,
  file_ai_stigmer_agentic_environment_v1_api,
  file_ai_stigmer_agentic_executioncontext_v1_api,
  file_ai_stigmer_agentic_mcpserver_v1_api,
  file_ai_stigmer_agentic_memory_v1_api,
  file_ai_stigmer_agentic_schedule_v1_api,
  file_ai_stigmer_agentic_session_v1_api,
  file_ai_stigmer_agentic_skill_v1_api,
  file_ai_stigmer_agentic_workflow_v1_enum,
  file_ai_stigmer_agentic_workflow_v1_spec,
  file_ai_stigmer_agentic_workflow_v1_api,
  file_ai_stigmer_agentic_workflow_v1_tasks_agent_call,
  file_ai_stigmer_agentic_workflow_v1_tasks_call_activity,
  file_ai_stigmer_agentic_workflow_v1_tasks_common,
  file_ai_stigmer_agentic_workflow_v1_tasks_emit_event,
  file_ai_stigmer_agentic_workflow_v1_tasks_eval,
  file_ai_stigmer_agentic_workflow_v1_tasks_for,
  file_ai_stigmer_agentic_workflow_v1_tasks_fork,
  file_ai_stigmer_agentic_workflow_v1_tasks_grpc_call,
  file_ai_stigmer_agentic_workflow_v1_tasks_http_call,
  file_ai_stigmer_agentic_workflow_v1_tasks_human_input,
  file_ai_stigmer_agentic_workflow_v1_tasks_listen,
  file_ai_stigmer_agentic_workflow_v1_tasks_llm_call,
  file_ai_stigmer_agentic_workflow_v1_tasks_notification,
  file_ai_stigmer_agentic_workflow_v1_tasks_raise,
  file_ai_stigmer_agentic_workflow_v1_tasks_run,
  file_ai_stigmer_agentic_workflow_v1_tasks_set,
  file_ai_stigmer_agentic_workflow_v1_tasks_switch,
  file_ai_stigmer_agentic_workflow_v1_tasks_transform,
  file_ai_stigmer_agentic_workflow_v1_tasks_try,
  file_ai_stigmer_agentic_workflow_v1_tasks_validate,
  file_ai_stigmer_agentic_workflow_v1_tasks_wait,
  file_ai_stigmer_agentic_workflowexecution_v1_api,
  file_ai_stigmer_agentic_workflowinstance_v1_api,
  file_ai_stigmer_iam_apikey_v1_api,
  file_ai_stigmer_iam_iampolicy_v1_api,
  file_ai_stigmer_iam_identityaccount_v1_api,
  file_ai_stigmer_iam_identityprovider_v1_api,
  file_ai_stigmer_iam_invitation_v1_api,
  file_ai_stigmer_iam_oauthapp_v1_api,
  file_ai_stigmer_iam_platformclient_v1_api,
  file_ai_stigmer_tenancy_organization_v1_api,
  file_ai_stigmer_tenancy_project_v1_api,
];

/** Transitive closure of the root files, dependency-first, deduplicated. */
export function allStigmerFiles(): DescFile[] {
  const seen = new Set<string>();
  const out: DescFile[] = [];
  const visit = (file: DescFile): void => {
    if (seen.has(file.proto.name)) return;
    seen.add(file.proto.name);
    for (const dep of file.dependencies) visit(dep);
    out.push(file);
  };
  for (const f of ROOT_FILES) visit(f);
  return out;
}

/** Registry over the full closure (for message lookups by type name). */
export function stigmerRegistry(): Registry {
  return createRegistry(...allStigmerFiles());
}

/** Every message in the closure, top-level and nested — the TS analogue of
 * protoregistry.GlobalTypes.RangeMessages over the linked stub packages. */
export function allStigmerMessages(): DescMessage[] {
  const out: DescMessage[] = [];
  const visitMessage = (msg: DescMessage): void => {
    out.push(msg);
    for (const nested of msg.nestedMessages) visitMessage(nested);
  };
  for (const file of allStigmerFiles()) {
    for (const msg of file.messages) visitMessage(msg);
  }
  return out;
}
