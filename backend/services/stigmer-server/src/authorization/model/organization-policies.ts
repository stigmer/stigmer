/**
 * An organization's policies, as derived rules on the organization type
 * (fga/model/tenancy/organization.fga):
 *
 *   - `agent_creation_open` on an organization:
 *     `organization:<org>#agent_creation_open@organization:<org>`, an edge
 *     from the organization to itself, while its `spec.policies` lets
 *     members create agents. It feeds
 *     `can_create_agent: admin or member from agent_creation_open`.
 *
 * A row that carries no policies reads as the defaults (members may create
 * agents), as the create chain writes them out for a new organization
 * (domain/organization/policies.ts); a row stored before policies existed
 * reads the same way. An edition that stores tuples
 * keeps the edge from `onOrganizationPoliciesChanged`
 * (extensions/resource-authorization.ts); open source derives it here.
 */
import { isMessage } from "@bufbuild/protobuf";

import { OrganizationSchema } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";

import type { DerivedRelation } from "./rewrite.js";

const ORGANIZATION_TYPE = "organization";

export const agentCreationOpen: DerivedRelation = (object, row) => {
  if (!isMessage(row, OrganizationSchema)) {
    return Promise.resolve([]);
  }
  const policies = row.spec?.policies;
  if (policies !== undefined && !policies.membersCanCreateAgents) {
    return Promise.resolve([]);
  }
  return Promise.resolve([
    {
      object,
      relation: "agent_creation_open",
      subject: {
        form: "object",
        object: { type: ORGANIZATION_TYPE, id: object.id },
      },
    },
  ]);
};
