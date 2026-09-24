/**
 * The Enterprise team type as the tests evaluate it: a transcript of
 * fga/model/iam/team.fga in the shape of every open-source transcript
 * (`../model/*.ts`), and a model that is the built-in one plus that
 * declaration. Open source serves no team — the kind's tier is
 * enterprise, so `builtInModel` declares none — yet its transcripts
 * already name the team grant (`agent`'s `viewer` accepts
 * `team#member`), and the derived tuple source reads the grants made to
 * a person's teams. These fixtures let the source's tests and the list
 * scope's cost measurement evaluate that path over real rows without
 * declaring the kind in the edition that does not serve it.
 *
 * The membership line is the model's one intersection: a member is a
 * person granted the role AND still one of the organization's viewers, so
 * leaving the organization ends every team-derived grant with no cleanup.
 * Guests hold `organization#guest`, never viewer, so a guest is never a
 * member.
 */
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { TeamSchema } from "@stigmer/protos/ai/stigmer/iam/team/v1/api_pb";

import type { Model } from "../model/index.js";
import { builtInModel, newModel } from "../model/index.js";
import {
  computed,
  declareKind,
  direct,
  from,
  intersection,
  objectOf,
} from "../model/rewrite.js";

export const teamDeclaration = declareKind({
  kind: ApiResourceKind.team,
  schema: TeamSchema,
  source: "fga/model/iam/team.fga",
  relations: [
    ["organization", direct(objectOf("organization"))],
    [
      "member",
      intersection(
        direct(objectOf("identity_account")),
        from("viewer", "organization"),
      ),
    ],
    ["viewer", from("viewer", "organization")],
    ["can_view", computed("viewer")],
    ["can_edit", from("admin", "organization")],
    ["can_delete", from("admin", "organization")],
    ["can_grant_access", from("admin", "organization")],
    ["can_view_access", computed("viewer")],
  ],
});

/** The built-in declarations and the team type; the evaluator reaches them by kind and type, so their order carries nothing. */
export const enterpriseModel: Model = newModel([
  ...builtInModel.declarations,
  teamDeclaration,
]);
