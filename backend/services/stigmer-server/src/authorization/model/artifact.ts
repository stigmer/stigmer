/**
 * Transcript of fga/model/agentic/artifact.fga — an organization's shared
 * output: read by its creator and by every organization viewer (`viewer
 * from organization`, no visibility tuple involved — the kind has no
 * visibility axis), edited by the organization's admins alone (the
 * creator does NOT edit through `owner`), and with no `can_delete` line
 * at all. The wire annotates only `can_view` and `can_edit` on it.
 */
import { ArtifactSchema } from "@stigmer/protos/ai/stigmer/agentic/artifact/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import {
  computed,
  declareKind,
  direct,
  from,
  objectOf,
  union,
} from "./rewrite.js";

export const artifactDeclaration = declareKind({
  kind: ApiResourceKind.artifact,
  schema: ArtifactSchema,
  source: "fga/model/agentic/artifact.fga",
  relations: [
    ["organization", direct(objectOf("organization"))],
    ["owner", direct(objectOf("identity_account"))],
    [
      "viewer",
      union(
        direct(objectOf("identity_account")),
        from("viewer", "organization"),
      ),
    ],
    ["can_view", union(computed("owner"), computed("viewer"))],
    ["can_edit", from("admin", "organization")],
  ],
});
