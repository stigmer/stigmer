// Verb-support matrix — which verbs each resource kind supports.
//
// This is CLI-specific policy (not stored in proto), ported verbatim from Go's
// types.verbSupport so both CLIs expose the same surface. Keep in lockstep.
//
//   | Kind         | apply | validate | get | list | delete | run | push | search | download |
//   |--------------|-------|----------|-----|------|--------|-----|------|--------|----------|
//   | Organization | Y     | -        | Y   | Y    | Y      | -   | -    | -      | -        |
//   | Agent        | Y     | Y        | Y   | Y    | Y      | Y   | -    | Y      | -        |
//   | Workflow     | Y     | Y        | Y   | Y    | Y      | Y   | -    | Y      | -        |
//   | Skill        | -     | -        | Y   | Y    | Y      | -   | Y    | -      | -        |
//   | McpServer    | Y     | Y        | Y   | Y    | Y      | -   | -    | -      | -        |
//   | Project      | Y*    | Y        | Y   | Y    | Y      | -   | -    | -      | -        |
//   | Execution    | -     | -        | Y   | Y    | Y**    | -   | -    | -      | Y        |
//
//   *  Project "apply" triggers SDK synthesis mode.
//   ** Execution "delete" maps to a cancel operation.

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
  [ApiResourceKind.project, new Set<Verb>([Verb.Apply, Verb.Validate, Verb.Get, Verb.List, Verb.Delete])],
  [ApiResourceKind.api_key, new Set<Verb>([Verb.Get, Verb.List, Verb.Delete])],
  // agent_execution is special — uses dedicated AgentExecutionQueryController
  // RPCs, not the unified SearchService. delete maps to cancel.
  [ApiResourceKind.agent_execution, new Set<Verb>([Verb.Get, Verb.List, Verb.Delete, Verb.Download])],
  [ApiResourceKind.identity_provider, new Set<Verb>([Verb.Apply, Verb.Get, Verb.List, Verb.Delete])],
  [ApiResourceKind.oauth_app, new Set<Verb>([Verb.Apply, Verb.Get, Verb.List, Verb.Delete])],
  [ApiResourceKind.environment, new Set<Verb>([Verb.Apply, Verb.Get, Verb.List, Verb.Delete])],
  // Enable/disable flows through `stigmer share agent`; the generic verbs
  // cover the declarative path (apply a manifest, inspect, tear down).
  [ApiResourceKind.agent_share, new Set<Verb>([Verb.Apply, Verb.Get, Verb.List, Verb.Delete])],
  // The provider install flow is console-driven and cloud-only; the generic
  // verbs cover the declarative path (apply a manifest, inspect, tear down).
  [ApiResourceKind.agent_channel, new Set<Verb>([Verb.Apply, Verb.Get, Verb.List, Verb.Delete])],
  // Secret fields round-trip as ***REDACTED***; applying a fetched manifest
  // preserves the stored secrets (the OAuthApp marker convention).
  [ApiResourceKind.channel_app, new Set<Verb>([Verb.Apply, Verb.Get, Verb.List, Verb.Delete])],
  // Record reads/writes are agent tools and record RPCs, not CLI verbs; the
  // generic verbs cover the declarative path (apply a manifest, inspect,
  // tear down — delete is guarded server-side for non-empty datastores).
  [ApiResourceKind.datastore, new Set<Verb>([Verb.Apply, Verb.Validate, Verb.Get, Verb.List, Verb.Delete])],
  [ApiResourceKind.agent_instance, new Set<Verb>([Verb.Apply, Verb.Get, Verb.List, Verb.Delete])],
  // No list: proto exposes getByWorkflow (requires workflow_id), not a generic list.
  [ApiResourceKind.workflow_instance, new Set<Verb>([Verb.Apply, Verb.Get, Verb.Delete])],
  [ApiResourceKind.session, new Set<Verb>([Verb.Apply, Verb.Get, Verb.List, Verb.Delete])],
]);

export function verbsForKind(kind: ApiResourceKind): ReadonlySet<Verb> {
  return VERB_SUPPORT.get(kind) ?? new Set<Verb>();
}
