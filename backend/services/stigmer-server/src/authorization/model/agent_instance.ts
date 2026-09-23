/**
 * Transcript of fga/model/agentic/agent_instance.fga — a person's
 * configuration of an agent: owner-only in every write (no admin arm,
 * unlike the blueprint), readable through its own visibility axis or, for
 * the system-managed default instance, through the blueprint's whole
 * viewer set (`viewer from default_of`; default-of.ts). `agent` is the
 * parent link written on every instance for tracking and walked by
 * nothing; `default_of` is the derived link written on the default
 * instance alone.
 */
import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentInstanceSchema } from "@stigmer/protos/ai/stigmer/agentic/agentinstance/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { defaultOfBlueprint } from "./default-of.js";
import {
  computed,
  declareKind,
  direct,
  from,
  objectOf,
  union,
  usersetOf,
} from "./rewrite.js";

export const agentInstanceDeclaration = declareKind({
  kind: ApiResourceKind.agent_instance,
  schema: AgentInstanceSchema,
  source: "fga/model/agentic/agent_instance.fga",
  relations: [
    ["organization", direct(objectOf("organization"))],
    ["agent", direct(objectOf("agent"))],
    ["default_of", direct(objectOf("agent"))],
    ["owner", direct(objectOf("identity_account"))],
    [
      "viewer",
      union(
        direct(
          objectOf("identity_account"),
          usersetOf("organization", "member"),
          usersetOf("organization", "viewer"),
        ),
        computed("owner"),
        from("viewer", "default_of"),
      ),
    ],
    ["can_view", computed("viewer")],
    ["can_execute", computed("can_view")],
    ["can_edit", computed("owner")],
    ["can_delete", computed("owner")],
    ["can_grant_access", computed("owner")],
    ["can_view_access", computed("viewer")],
  ],
  derived: [
    [
      "default_of",
      defaultOfBlueprint({
        kind: ApiResourceKind.agent,
        schema: AgentSchema,
        defaultInstanceIdOf: (agent) => agent.status?.defaultInstanceId ?? "",
      }),
    ],
  ],
});
