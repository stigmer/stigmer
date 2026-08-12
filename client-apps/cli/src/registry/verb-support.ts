// Verb-support matrix — which verbs each resource kind supports.
//
// This is CLI-specific policy (not stored in proto), and it is a PROMISE:
// `stigmer list types` prints it, the docs type tables are written from it,
// and the command layer gates on it before dispatch. The conformance test in
// registry.test.ts holds every promised apply/get/list/delete verb to an
// actual dispatch entry — and every dispatch entry back to a promise — so a
// verb listed here either works or fails CI. "Advertised but not
// implemented" (stigmer/stigmer#353) is a rejected state, not a backlog;
// verbs deliberately withheld pending a real ops story are recorded in
// stigmer/stigmer#354, not here.

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { Verb } from "./verbs.js";

export const VERB_SUPPORT: ReadonlyMap<ApiResourceKind, ReadonlySet<Verb>> = new Map([
  [ApiResourceKind.organization, new Set<Verb>([Verb.Apply, Verb.Get, Verb.List, Verb.Delete])],
  [
    ApiResourceKind.agent,
    new Set<Verb>([Verb.Apply, Verb.Validate, Verb.Get, Verb.List, Verb.Delete, Verb.Run, Verb.Search]),
  ],
  [
    ApiResourceKind.workflow,
    new Set<Verb>([Verb.Apply, Verb.Validate, Verb.Get, Verb.List, Verb.Delete, Verb.Run, Verb.Search]),
  ],
  [ApiResourceKind.skill, new Set<Verb>([Verb.Get, Verb.List, Verb.Delete, Verb.Push])],
  [ApiResourceKind.mcp_server, new Set<Verb>([Verb.Apply, Verb.Validate, Verb.Get, Verb.List, Verb.Delete])],
  // Project apply is the stigmer.yaml declarative/synthesis track, not
  // `apply -f project.yaml` — resolveHandlerForKind carries the teaching
  // refusal, and the conformance test documents it as a special case.
  [ApiResourceKind.project, new Set<Verb>([Verb.Apply, Verb.Validate, Verb.Get, Verb.List, Verb.Delete])],
  [ApiResourceKind.api_key, new Set<Verb>([Verb.Get, Verb.List, Verb.Delete])],
  // agent_execution is special — uses dedicated AgentExecutionQueryController
  // RPCs, not the unified SearchService. delete maps to cancel.
  [ApiResourceKind.agent_execution, new Set<Verb>([Verb.Get, Verb.List, Verb.Delete, Verb.Download])],
  // IAM apps are configured declaratively; read/ops verbs are deliberately
  // not promised (never wired, no demand — stigmer/stigmer#354). To add one:
  // dispatch entry + this line, in the same change.
  [ApiResourceKind.identity_provider, new Set<Verb>([Verb.Apply])],
  [ApiResourceKind.oauth_app, new Set<Verb>([Verb.Apply])],
  [ApiResourceKind.environment, new Set<Verb>([Verb.Apply, Verb.Get, Verb.List, Verb.Delete])],
  // Enable/disable flows through `stigmer share agent`, which is the whole
  // read/ops surface today; only the declarative apply path is promised
  // (stigmer/stigmer#354 records the narrowing).
  [ApiResourceKind.agent_share, new Set<Verb>([Verb.Apply])],
  // The provider install flow is console-driven and cloud-only; the generic
  // verbs cover the declarative path (apply a manifest, inspect, tear down).
  [ApiResourceKind.agent_channel, new Set<Verb>([Verb.Apply, Verb.Get, Verb.List, Verb.Delete])],
  // Secret fields round-trip as ***REDACTED***; applying a fetched manifest
  // preserves the stored secrets (the OAuthApp marker convention).
  [ApiResourceKind.channel_app, new Set<Verb>([Verb.Apply, Verb.Get, Verb.List, Verb.Delete])],
  // Firing is the platform's job (Temporal Schedules); the generic verbs
  // cover the declarative path, and get/list surface the state the dedicated
  // `stigmer schedule` commands act on — spec.enabled (the owner's switch)
  // versus status.paused_reason (the platform's failure latch).
  [ApiResourceKind.schedule, new Set<Verb>([Verb.Apply, Verb.Get, Verb.List, Verb.Delete])],
  [ApiResourceKind.agent_instance, new Set<Verb>([Verb.Apply, Verb.Get, Verb.List, Verb.Delete])],
  // No list: proto exposes getByWorkflow (requires workflow_id), not a generic list.
  [ApiResourceKind.workflow_instance, new Set<Verb>([Verb.Apply, Verb.Get, Verb.Delete])],
  // Sessions are runtime conversation state with no CLI read/ops story yet;
  // get/list/delete are deliberately not promised (stigmer/stigmer#354).
  [ApiResourceKind.session, new Set<Verb>([Verb.Apply])],
]);

export function verbsForKind(kind: ApiResourceKind): ReadonlySet<Verb> {
  return VERB_SUPPORT.get(kind) ?? new Set<Verb>();
}
