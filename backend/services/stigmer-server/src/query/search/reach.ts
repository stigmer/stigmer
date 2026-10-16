/**
 * Where search finds each searchable kind's candidates: its reach. Every
 * kind `searchIndexedKinds` (criteria.ts) serves declares one, and the
 * handler builds the kind's allowlist from it (handler.ts):
 *
 *   - `organization`: an organization's blueprints (agent, skill,
 *     plugin). The candidates are the searched organizations' rows, read
 *     through the kind's list index and offered to the list read scope's
 *     restrict verb in one call, the run summary's idiom
 *     (domain/run/usage.ts). A person reaches these rows only inside an
 *     organization they belong to, or one whose parent shares them, so
 *     the searched organizations bound the candidates, and the cost is
 *     those organizations' rows, never the kind's across every tenant.
 *   - `person`: what a person makes for themselves (session, run). A busy
 *     organization holds thousands of conversations the searcher may not
 *     read, so these keep the scope's enumeration of what the person may
 *     read (`ListReadScope.authorizedResourceIds`).
 *   - `directory`: organizations themselves. The candidates are the ids
 *     the organization directory lists for the caller, which it has
 *     already checked.
 *
 * A record keyed by every searchable kind would be the compiler's check,
 * but the searchable set is derived from `kind_meta` at run time, so the
 * check is a test instead: __tests__/reach.test.ts fails when a
 * searchable kind declares no reach, and `searchReachOf` throws for one
 * rather than leave its kind unrestricted.
 */
import { fromBinary } from "@bufbuild/protobuf";

import { AgentSchema } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/api_pb";
import { PluginSchema } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/api_pb";
import { SkillSchema } from "@stigmer/apis/ai/stigmer/agentic/skill/v1/api_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { agentListIndex } from "../../domain/agent/list-index.js";
import { pluginListIndex } from "../../domain/plugin/list-index.js";
import { skillListIndex } from "../../domain/skill/list-index.js";
import type { ScopedListResource } from "../../extensions/list-read-scope.js";
import { kindEnumName } from "../../pipeline/apiresource-meta.js";
import type { ListIndexDeclaration } from "../../store/list-index.js";

/** A kind whose candidates are the searched organizations' rows. */
export interface OrganizationReach {
  readonly reach: "organization";
  /** The kind's list index, read once per searched organization. */
  readonly index: ListIndexDeclaration;
  /** A row's bytes as the resource the restrict verb is offered. */
  readonly decode: (data: Uint8Array) => ScopedListResource;
}

/** A kind whose candidates are what the person may read, enumerated. */
export interface PersonReach {
  readonly reach: "person";
}

/** Organizations: the ids the organization directory lists. */
export interface DirectoryReach {
  readonly reach: "directory";
}

export type SearchReach = OrganizationReach | PersonReach | DirectoryReach;

const REACH: ReadonlyMap<ApiResourceKind, SearchReach> = new Map<
  ApiResourceKind,
  SearchReach
>([
  [
    ApiResourceKind.agent,
    {
      reach: "organization",
      index: agentListIndex,
      decode: (data) => fromBinary(AgentSchema, data),
    },
  ],
  [
    ApiResourceKind.skill,
    {
      reach: "organization",
      index: skillListIndex,
      decode: (data) => fromBinary(SkillSchema, data),
    },
  ],
  [
    ApiResourceKind.plugin,
    {
      reach: "organization",
      index: pluginListIndex,
      decode: (data) => fromBinary(PluginSchema, data),
    },
  ],
  [ApiResourceKind.session, { reach: "person" }],
  [ApiResourceKind.run, { reach: "person" }],
  [ApiResourceKind.organization, { reach: "directory" }],
]);

/** The reach `kind` declares; throws for a kind that declares none. */
export function searchReachOf(kind: ApiResourceKind): SearchReach {
  const reach = REACH.get(kind);
  if (reach === undefined) {
    throw new Error(
      `searchable kind '${kindEnumName(kind)}' declares no reach (query/search/reach.ts)`,
    );
  }
  return reach;
}
