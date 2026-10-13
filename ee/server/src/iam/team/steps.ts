/**
 * The Team chains' own steps: the reads the OSS chain steps need done over
 * the composition's table (`ee.iam_team`) because the library's
 * versions read its Store. Each keeps the OSS step's name and copy, so a
 * failure log and a refusal read the same whichever edition served it:
 *
 *   CheckDuplicate   the org-scoped slug check before a create persists
 *                    (`@stigmer/server`'s `pipeline/steps/duplicate.ts` copy)
 *   LoadExisting     the update's stored row, under EXISTING_RESOURCE_KEY,
 *                    for the OSS BuildUpdateState
 *   LoadByReference  the reference read's row, under TARGET_RESOURCE_KEY,
 *                    for the OSS AuthorizeResolvedTarget; a miss is
 *                    NOT_FOUND only to the organization's viewers, who see
 *                    every team there, and `get`'s denial to anyone else
 *                    (reference-miss.ts)
 *   LoadTarget       a read or delete by id, under TARGET_RESOURCE_KEY
 */
import type { DescMessage, MessageShape } from "@bufbuild/protobuf";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { ApiResourceReferenceSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import type { Team, TeamSchema } from "@stigmer/protos/ai/stigmer/iam/team/v1/api_pb";
import { TeamQueryController } from "@stigmer/protos/ai/stigmer/iam/team/v1/query_pb";
import { IamPermission } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";
import type {
  Authorizer,
  NameHolder,
  NameTable,
  PipelineStep,
  RequestContext,
} from "@stigmer/server";
import {
  alreadyExistsError,
  EXISTING_RESOURCE_KEY,
  internalError,
  invalidArgumentError,
  nameTakenError,
  notFoundError,
  portHolder,
  resolveName,
  resolveNameEntry,
  TARGET_RESOURCE_KEY,
} from "@stigmer/server";

import { deniedCopyOf, refuseMissUnlessOrganizationBar } from "../reference-miss.js";
import type { TeamStore } from "./store.js";

/** The kind's display name in refusal copy, as the OSS steps render it. */
export const TEAM_DISPLAY_NAME = "Team";

/**
 * The team a slug names in an organization: the server's one name table
 * (@stigmer/server `resolveName`), then this table by id.
 */
export async function findTeamByName(
  names: NameTable,
  teams: Pick<TeamStore, "findById">,
  org: string,
  slug: string,
): Promise<Team | undefined> {
  const id = await resolveName(names, ApiResourceKind.team, org, slug);
  return id === undefined ? undefined : teams.findById(id);
}

/** A team holds its name while its row exists. */
export function teamNameHolder(teams: Pick<TeamStore, "findById">): NameHolder {
  return portHolder((id) => teams.findById(id));
}

/**
 * The org-scoped slug check, before a create persists; ClaimName is the
 * guarantee. A slug a renamed team still answers to is refused with the
 * library's SLUG_RESERVED (`nameTakenError`); a current holder keeps the
 * duplicate copy.
 */
export function newCheckDuplicateTeamStep(
  names: NameTable,
  teams: Pick<TeamStore, "findById">,
): PipelineStep<typeof TeamSchema> {
  return {
    name: "CheckDuplicate",
    async execute(ctx: RequestContext<typeof TeamSchema>): Promise<void> {
      const metadata = ctx.newState.metadata;
      const slug = metadata?.slug ?? "";
      if (slug === "") {
        throw internalError(
          new Error("resource slug is empty"),
          "duplicate check",
        );
      }
      const entry = await resolveNameEntry(names, ApiResourceKind.team, metadata?.org ?? "", slug);
      const existing = entry === undefined ? undefined : await teams.findById(entry.id);
      if (entry !== undefined && existing !== undefined) {
        throw entry.state === "previous" ? nameTakenError(ApiResourceKind.team, entry) : duplicateTeamError(existing);
      }
    },
  };
}

/** The OSS org-scoped duplicate copy, naming the held team. */
export function duplicateTeamError(existing: Team): Error {
  const metadata = existing.metadata;
  return alreadyExistsError(
    TEAM_DISPLAY_NAME,
    `slug '${metadata?.slug ?? ""}' in org '${metadata?.org ?? ""}' (id: ${metadata?.id ?? ""})`,
  );
}

/** The update's stored row, for the OSS BuildUpdateState. */
export function newLoadExistingTeamStep(
  teams: Pick<TeamStore, "findById">,
): PipelineStep<typeof TeamSchema> {
  return {
    name: "LoadExisting",
    async execute(ctx: RequestContext<typeof TeamSchema>): Promise<void> {
      const id = ctx.input.metadata?.id ?? "";
      if (id === "") {
        throw invalidArgumentError("resource id is required for update");
      }
      ctx.set(EXISTING_RESOURCE_KEY, await requireTeam(teams, id));
    },
  };
}

/**
 * The reference read's row, for the OSS AuthorizeResolvedTarget. A miss
 * asks the organization's `can_view` (a team's viewers are its
 * organization's viewers, `team.fga`) before it answers NOT_FOUND; anyone
 * else gets the refusal `get` answers a team they may not see.
 */
export function newLoadTeamByReferenceStep(
  names: NameTable,
  teams: Pick<TeamStore, "findById">,
  authorizer: Authorizer,
): PipelineStep<typeof ApiResourceReferenceSchema> {
  const deniedMessage = deniedCopyOf(TeamQueryController.method.get);
  return {
    name: "LoadByReference",
    async execute(
      ctx: RequestContext<typeof ApiResourceReferenceSchema>,
    ): Promise<void> {
      const ref = ctx.input;
      if (ref.slug === "" && ref.id === "") {
        throw invalidArgumentError("slug or id is required in reference");
      }
      if (
        ref.kind !== ApiResourceKind.api_resource_kind_unknown &&
        ref.kind !== ApiResourceKind.team
      ) {
        throw invalidArgumentError(
          `kind mismatch: expected team, got ${ApiResourceKind[ref.kind] ?? String(ref.kind)}`,
        );
      }
      if (ref.org === "") {
        throw invalidArgumentError(`org is required for ${TEAM_DISPLAY_NAME} lookup`);
      }
      const team = await findByHeldReference(names, teams, ApiResourceKind.team, ref);
      if (team === undefined) {
        await refuseMissUnlessOrganizationBar(authorizer, ctx.callerIdentity, {
          organization: ref.org,
          permission: IamPermission.can_view,
          deniedMessage,
        });
        throw notFoundError(TEAM_DISPLAY_NAME, ref.slug !== "" ? ref.slug : ref.id);
      }
      ctx.set(TARGET_RESOURCE_KEY, team);
    },
  };
}

/** A read by id, for `get` and `delete`; `idOf` names the request's id field. */
export function newLoadTeamStep<Desc extends DescMessage>(
  teams: Pick<TeamStore, "findById">,
  idOf: (input: MessageShape<Desc>) => string,
): PipelineStep<Desc> {
  return {
    name: "LoadTarget",
    async execute(ctx: RequestContext<Desc>): Promise<void> {
      const id = idOf(ctx.input);
      if (id === "") {
        throw invalidArgumentError("resource id is required");
      }
      ctx.set(TARGET_RESOURCE_KEY, await requireTeam(teams, id));
    },
  };
}

/** The row a load step stashed under `key`; the chain guarantees it. */
export function teamAt(
  ctx: { get(key: string): unknown },
  key: string,
): Team {
  const team = ctx.get(key) as Team | undefined;
  if (team === undefined) {
    throw internalError(
      new Error(`no team under ${key}`),
      "team chain lost its loaded resource",
    );
  }
  return team;
}

async function requireTeam(
  teams: Pick<TeamStore, "findById">,
  id: string,
): Promise<Team> {
  const team = await teams.findById(id);
  if (team === undefined) {
    throw notFoundError(TEAM_DISPLAY_NAME, id);
  }
  return team;
}

/**
 * The team a reference request names: by its id, the row in the
 * reference's organization; else by its org and slug through the name
 * table. Beside an id the slug is not looked up: the lane authorizes the
 * row only after this finds it, so asking the name table here would tell a
 * caller with no standing on the organization whether it holds a name
 * (findByReference in @stigmer/server says the same).
 */
async function findByHeldReference<Row extends { metadata?: { org: string; slug: string } }>(
  names: NameTable,
  rows: { findById(id: string): Promise<Row | undefined> },
  kind: ApiResourceKind,
  ref: { readonly org: string; readonly id: string; readonly slug: string },
): Promise<Row | undefined> {
  if (ref.id === "") {
    const id = await resolveName(names, kind, ref.org, ref.slug);
    return id === undefined ? undefined : rows.findById(id);
  }
  const row = await rows.findById(ref.id);
  return row === undefined || (row.metadata?.org ?? "") !== ref.org ? undefined : row;
}
