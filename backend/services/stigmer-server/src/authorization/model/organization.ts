/**
 * Transcript of fga/model/tenancy/organization.fga — the root of the
 * model: no parent, the four roles as a ladder (`owner ⊂ admin ⊂ member
 * ⊂ viewer`, each `[identity_account] or <the rung above>`), and every
 * `can_create_*` an organization gates.
 *
 * In open source the `[identity_account]` tuples of this type ARE the
 * IamPolicy rows: 2b's role lifecycle writes the creator's `owner` row and
 * the grant path writes every other role, so the tuple source reads them
 * from the IamPolicyStore and the derivation writes no owner tuple for
 * this kind (derived-tuples.ts). `guest` is the cloud's anonymous
 * share-link visitor; no open-source lane mints one (claim check C5), so
 * the relation resolves to nothing and `can_create_session: member or
 * guest` is `member` here — the transcript still carries the line.
 * `can_create_team` is carried the same way: open source serves no Team
 * kind, so nothing here asks it.
 */
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { OrganizationSchema } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";

import { computed, declareKind, direct, objectOf, union } from "./rewrite.js";

export const organizationDeclaration = declareKind({
  kind: ApiResourceKind.organization,
  schema: OrganizationSchema,
  source: "fga/model/tenancy/organization.fga",
  relations: [
    ["owner", direct(objectOf("identity_account"))],
    ["admin", union(direct(objectOf("identity_account")), computed("owner"))],
    ["member", union(direct(objectOf("identity_account")), computed("admin"))],
    ["viewer", union(direct(objectOf("identity_account")), computed("member"))],
    ["guest", direct(objectOf("identity_account"))],
    ["can_view", computed("viewer")],
    ["can_edit", computed("admin")],
    ["can_delete", computed("owner")],
    ["can_manage_members", computed("admin")],
    ["can_assign_roles", computed("owner")],
    ["can_create_agent", computed("admin")],
    ["can_create_workflow", computed("admin")],
    ["can_create_session", union(computed("member"), computed("guest"))],
    ["can_create_environment", computed("member")],
    ["can_create_skill", computed("admin")],
    ["can_create_plugin", computed("admin")],
    ["can_create_mcp_server", computed("admin")],
    ["can_create_idp", computed("admin")],
    ["can_create_identity_account", computed("admin")],
    ["can_create_oauth_app", computed("admin")],
    ["can_create_platform_client", computed("admin")],
    ["can_create_channel_app", computed("admin")],
    ["can_create_execution_in", union(computed("member"), computed("guest"))],
    ["can_create_agent_share", computed("admin")],
    ["can_create_agent_instance", computed("member")],
    ["can_create_team", computed("admin")],
    ["can_grant_access", computed("admin")],
    ["can_view_access", computed("viewer")],
    ["can_view_billing", computed("viewer")],
    ["can_manage_billing", computed("admin")],
  ],
});
