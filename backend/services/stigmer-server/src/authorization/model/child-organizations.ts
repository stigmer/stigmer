/**
 * The parent and child organization edges, as derived rules on the
 * organization type (fga/model/tenancy/organization.fga):
 *
 *   - `parent_org` on a child: `organization:<child>#parent_org@
 *     organization:<parent>`, from the child's own `spec.parent_org`. It
 *     feeds `parent_admin: admin from parent_org`, the parent's admins'
 *     management of the child.
 *   - `child_org` on a parent: `organization:<parent>#child_org@
 *     organization:<child>` for every child, from the organization list
 *     index (`RowLoader.childOrganizations`). It feeds
 *     `child_org_viewer: viewer from child_org`, the audience of a
 *     blueprint shared at visibility_child_orgs.
 *
 * The edges are not `kind_meta` facts (an organization's scope is its own,
 * and the reverse edge has no parent-link shape), so an edition that
 * stores tuples writes both once, when the child is created
 * (`onChildOrganizationLinked`, extensions/resource-authorization.ts), and
 * open source derives them here from the same fields when a check asks.
 * `spec.parent_org` is fixed at create, so the two never disagree.
 */
import { isMessage } from "@bufbuild/protobuf";

import { OrganizationSchema } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";

import type { Tuple } from "../tuples.js";
import type { DerivedRelation } from "./rewrite.js";

const ORGANIZATION_TYPE = "organization";

export const parentOrg: DerivedRelation = (object, row) => {
  if (!isMessage(row, OrganizationSchema)) {
    return Promise.resolve([]);
  }
  const parent = row.spec?.parentOrg ?? "";
  if (parent === "") {
    return Promise.resolve([]);
  }
  return Promise.resolve([
    {
      object,
      relation: "parent_org",
      subject: {
        form: "object",
        object: { type: ORGANIZATION_TYPE, id: parent },
      },
    },
  ]);
};

export const childOrg: DerivedRelation = async (object, _row, loader) =>
  (await loader.childOrganizations(object.id)).map(
    (child): Tuple => ({
      object,
      relation: "child_org",
      subject: {
        form: "object",
        object: { type: ORGANIZATION_TYPE, id: child },
      },
    }),
  );
