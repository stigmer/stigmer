/**
 * The IamPolicy list index (store/list-index.ts): `principal` is the key
 * the open-source adapter's `findByPrincipal` reads (resource-store.ts).
 * It is not a lane's index: the built-in authorizer reads a person's rows,
 * and the rows granted to each team they belong to, on every check and
 * every list batch (authorization/derived-tuples.ts), and without the key
 * each of those reads decodes the whole kind — a table that grows with
 * every member, organization and grant.
 *
 * The key is the principal's id alone: a key reads one string field, and
 * an id carries its kind's prefix (`ida_` for an account, `tm_` for a
 * team), so the index narrows to one principal and the adapter's
 * predicate on (kind, id) keeps the answer exact whatever the index
 * returns. A policy is not organization-scoped the way a lane's rows are,
 * so the read names no organization; the key table's lookup index leads
 * with the key, not the organization (the v6 migration of each driver).
 *
 * A change to `keys` bumps `revision` (boot/__tests__/list-indexes.test.ts
 * pins the pair).
 */
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { IamPolicySchema } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/api_pb";

import { declareListIndex, field } from "../../store/list-index.js";

export const iamPolicyListIndex = declareListIndex({
  kind: ApiResourceKind.iam_policy,
  schema: IamPolicySchema,
  revision: 1,
  keys: {
    principal: field("spec.principal.id"),
  },
});
