// The full Stigmer proto registry for the docs YAML gate — the TS analogue
// of docs_yaml_gate.go's blank stub imports. Every resource package whose
// manifests may appear in docs must be listed; a missing entry means the
// gate reports "unknown kind" for that resource. The gate's own registry
// scan derives everything else (manifest kinds from protovalidate consts),
// so this list is the only hand-maintained piece.

import type { DescFile, DescMessage, Registry } from "@bufbuild/protobuf";
import { createRegistry } from "@bufbuild/protobuf";

import { file_ai_stigmer_agentic_agent_v1_api } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { file_ai_stigmer_agentic_agentchannel_v1_api } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/api_pb";
import { file_ai_stigmer_agentic_agentrun_v1_api } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/api_pb";
import { file_ai_stigmer_agentic_agentshare_v1_api } from "@stigmer/protos/ai/stigmer/agentic/agentshare/v1/api_pb";
import { file_ai_stigmer_agentic_channelapp_v1_api } from "@stigmer/protos/ai/stigmer/agentic/channelapp/v1/api_pb";
import { file_ai_stigmer_agentic_environment_v1_api } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/api_pb";
import { file_ai_stigmer_agentic_executioncontext_v1_api } from "@stigmer/protos/ai/stigmer/agentic/executioncontext/v1/api_pb";
import { file_ai_stigmer_agentic_mcpserver_v1_api } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { file_ai_stigmer_agentic_memory_v1_api } from "@stigmer/protos/ai/stigmer/agentic/memory/v1/api_pb";
import { file_ai_stigmer_agentic_plugin_v1_api } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import { file_ai_stigmer_agentic_schedule_v1_api } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/api_pb";
import { file_ai_stigmer_agentic_session_v1_api } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { file_ai_stigmer_agentic_skill_v1_api } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/api_pb";
import { file_ai_stigmer_billing_license_v1_api } from "@stigmer/protos/ai/stigmer/billing/license/v1/api_pb";
import { file_ai_stigmer_billing_plan_v1_api } from "@stigmer/protos/ai/stigmer/billing/plan/v1/api_pb";
import { file_ai_stigmer_billing_subscription_v1_api } from "@stigmer/protos/ai/stigmer/billing/subscription/v1/api_pb";
import { file_ai_stigmer_iam_apikey_v1_api } from "@stigmer/protos/ai/stigmer/iam/apikey/v1/api_pb";
import { file_ai_stigmer_iam_iampolicy_v1_api } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/api_pb";
import { file_ai_stigmer_iam_identityaccount_v1_api } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import { file_ai_stigmer_iam_identityprovider_v1_api } from "@stigmer/protos/ai/stigmer/iam/identityprovider/v1/api_pb";
import { file_ai_stigmer_iam_invitation_v1_api } from "@stigmer/protos/ai/stigmer/iam/invitation/v1/api_pb";
import { file_ai_stigmer_iam_oauthapp_v1_api } from "@stigmer/protos/ai/stigmer/iam/oauthapp/v1/api_pb";
import { file_ai_stigmer_iam_platformclient_v1_api } from "@stigmer/protos/ai/stigmer/iam/platformclient/v1/api_pb";
import { file_ai_stigmer_iam_team_v1_api } from "@stigmer/protos/ai/stigmer/iam/team/v1/api_pb";
import { file_ai_stigmer_tenancy_organization_v1_api } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";

const ROOT_FILES: DescFile[] = [
  file_ai_stigmer_agentic_agent_v1_api,
  file_ai_stigmer_agentic_agentchannel_v1_api,
  file_ai_stigmer_agentic_agentrun_v1_api,
  file_ai_stigmer_agentic_agentshare_v1_api,
  file_ai_stigmer_agentic_channelapp_v1_api,
  file_ai_stigmer_agentic_environment_v1_api,
  file_ai_stigmer_agentic_executioncontext_v1_api,
  file_ai_stigmer_agentic_mcpserver_v1_api,
  file_ai_stigmer_agentic_memory_v1_api,
  file_ai_stigmer_agentic_plugin_v1_api,
  file_ai_stigmer_agentic_schedule_v1_api,
  file_ai_stigmer_agentic_session_v1_api,
  file_ai_stigmer_agentic_skill_v1_api,
  file_ai_stigmer_billing_license_v1_api,
  file_ai_stigmer_billing_plan_v1_api,
  file_ai_stigmer_billing_subscription_v1_api,
  file_ai_stigmer_iam_apikey_v1_api,
  file_ai_stigmer_iam_iampolicy_v1_api,
  file_ai_stigmer_iam_identityaccount_v1_api,
  file_ai_stigmer_iam_identityprovider_v1_api,
  file_ai_stigmer_iam_invitation_v1_api,
  file_ai_stigmer_iam_oauthapp_v1_api,
  file_ai_stigmer_iam_platformclient_v1_api,
  file_ai_stigmer_iam_team_v1_api,
  file_ai_stigmer_tenancy_organization_v1_api,
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
