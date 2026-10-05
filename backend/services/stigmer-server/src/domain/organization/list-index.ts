/**
 * The organization list index (store/list-index.ts): `parent_org` is the
 * key every read of an organization's children goes through, so none of
 * them decodes the whole kind:
 *
 *   - listChildOrgs pages a parent's children (pipeline/steps/list-page.ts);
 *   - the delete refuses a parent that still has children;
 *   - the built-in evaluator derives a parent's `child_org` edges from it
 *     on every check that walks `child_org_viewer` (authorization/model/
 *     child-organizations.ts), which is every read of a blueprint shared
 *     with child organizations;
 *   - a composition reads a parent's children through
 *     `ComposedServices.childOrganizations` (children.ts).
 *
 * An organization belongs to no organization (its `metadata.org` is
 * empty), so every read names the key alone, as the IamPolicy index's
 * principal reads do; the key table's lookup index leads with the key.
 * An organization with no parent derives an empty key, which no read
 * asks for.
 *
 * A change to `keys` bumps `revision` (boot/__tests__/list-indexes.test.ts
 * pins the pair).
 */
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { OrganizationSchema } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";

import { declareListIndex, field } from "../../store/list-index.js";

export const organizationListIndex = declareListIndex({
  kind: ApiResourceKind.organization,
  schema: OrganizationSchema,
  revision: 1,
  keys: {
    parent_org: field("spec.parent_org"),
  },
});
