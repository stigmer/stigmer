/**
 * Transcript of fga/model/agentic/schedule.fga — a scheduled run's
 * definition, admin-owned like a blueprint and viewable by its owners and
 * explicit grantees. The sessions its fires create name it back through
 * `session#schedule`, a link the cloud writes and this edition does not
 * (session.ts); the schedule's own relations are unaffected. An explicit
 * grant may name an Enterprise team (`team#member`), which no open-source
 * tuple ever does.
 */
import { ScheduleSchema } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import {
  computed,
  declareKind,
  direct,
  from,
  objectOf,
  union,
  usersetOf,
} from "./rewrite.js";

export const scheduleDeclaration = declareKind({
  kind: ApiResourceKind.schedule,
  schema: ScheduleSchema,
  source: "fga/model/agentic/schedule.fga",
  relations: [
    ["organization", direct(objectOf("organization"))],
    [
      "owner",
      union(
        direct(objectOf("identity_account")),
        from("admin", "organization"),
      ),
    ],
    [
      "viewer",
      union(
        direct(objectOf("identity_account"), usersetOf("team", "member")),
        computed("owner"),
      ),
    ],
    ["can_view", computed("viewer")],
    ["can_edit", computed("owner")],
    ["can_delete", computed("owner")],
    ["can_grant_access", computed("owner")],
    ["can_view_access", computed("viewer")],
  ],
});
