/**
 * The principal display driver (`drivers.principalDisplay`): how an access
 * list names a grantee that is not a person. The core asks once per
 * principal kind a list holds, which includes kinds this driver knows
 * nothing about (an organization's viewer userset is a principal on every
 * org-visible resource); it answers for teams and returns nothing for
 * every other kind, so those keep the core's fallback shape.
 *
 * A team is named by its display name and handle. Member counts are not
 * carried: a count per team per access list would be a read per team on
 * every list, and the console does not show one.
 */
import { create } from "@bufbuild/protobuf";

import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { ApiResourceRefView } from "@stigmer/apis/ai/stigmer/iam/grant/v1/io_pb";
import { ApiResourceRefViewSchema } from "@stigmer/apis/ai/stigmer/iam/grant/v1/io_pb";
import type { PrincipalDisplay } from "@stigmer/server";

import { TEAM_KIND_NAME } from "./removal.js";
import type { TeamStore } from "./store.js";

const NOTHING: ReadonlyMap<string, ApiResourceRefView> = new Map();

export function newTeamPrincipalDisplay(
  teams: Pick<TeamStore, "findByIds">,
): PrincipalDisplay {
  return {
    async resolve(kind, ids): Promise<ReadonlyMap<string, ApiResourceRefView>> {
      if (kind !== ApiResourceKind.team || ids.length === 0) {
        return NOTHING;
      }
      const views = new Map<string, ApiResourceRefView>();
      for (const team of await teams.findByIds(ids)) {
        const id = team.metadata?.id ?? "";
        views.set(
          id,
          create(ApiResourceRefViewSchema, {
            kind: TEAM_KIND_NAME,
            id,
            name: team.metadata?.name ?? "",
            slug: team.metadata?.slug ?? "",
          }),
        );
      }
      return views;
    },
  };
}
