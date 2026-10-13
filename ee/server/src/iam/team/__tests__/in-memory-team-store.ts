/**
 * An in-memory TeamStore for the unit suites: the same outcomes the
 * Postgres store answers (a slug taken within an organization, newest
 * first per organization), so the chains and the gate are exercised
 * without a database. A host's adapter is pinned over its real table in
 * its own suites.
 */
import { clone, create, toBinary } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";

import { ApiResourceMetadataSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";
import {
  ApiResourceAuditInfoSchema,
  ApiResourceAuditSchema,
  ApiResourceAuditStatusSchema,
} from "@stigmer/protos/ai/stigmer/commons/apiresource/status_pb";
import type { Team } from "@stigmer/protos/ai/stigmer/iam/team/v1/api_pb";
import { TeamSchema } from "@stigmer/protos/ai/stigmer/iam/team/v1/api_pb";

import type { GuardedRead } from "@stigmer/server";

import type { TeamInsertOutcome, TeamStore } from "../store.js";

/** Whether two stored forms are the same bytes, as the Postgres swap compares them. */
function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((byte, index) => byte === right[index]);
}

export class InMemoryTeamStore implements TeamStore {
  private readonly rows = new Map<string, Team>();
  /** Ids in insertion order, the newest last. */
  private readonly order: string[] = [];

  insert(team: Team): Promise<TeamInsertOutcome> {
    const org = team.metadata?.org ?? "";
    const slug = team.metadata?.slug ?? "";
    for (const held of this.rows.values()) {
      if (held.metadata?.org === org && held.metadata?.slug === slug) {
        return Promise.resolve({ kind: "slug-taken" });
      }
    }
    const id = team.metadata?.id ?? "";
    this.rows.set(id, clone(TeamSchema, team));
    this.order.push(id);
    return Promise.resolve({ kind: "inserted" });
  }

  readForWrite(id: string): Promise<GuardedRead<Team> | undefined> {
    const held = this.rows.get(id);
    return Promise.resolve(
      held === undefined
        ? undefined
        : { row: clone(TeamSchema, held), bytes: toBinary(TeamSchema, held) },
    );
  }

  swap(id: string, expectedBytes: Uint8Array, next: Team): Promise<boolean> {
    const held = this.rows.get(id);
    if (held === undefined || !sameBytes(toBinary(TeamSchema, held), expectedBytes)) {
      return Promise.resolve(false);
    }
    this.rows.set(id, clone(TeamSchema, next));
    return Promise.resolve(true);
  }

  modifyById(id: string, modify: (team: Team) => void): Promise<Team | undefined> {
    const held = this.rows.get(id);
    if (held === undefined) {
      return Promise.resolve(undefined);
    }
    const team = clone(TeamSchema, held);
    modify(team);
    this.rows.set(id, clone(TeamSchema, team));
    return Promise.resolve(team);
  }

  findById(id: string): Promise<Team | undefined> {
    return Promise.resolve(this.copy(this.rows.get(id)));
  }

  findByIds(ids: ReadonlyArray<string>): Promise<ReadonlyArray<Team>> {
    return Promise.resolve(
      ids.flatMap((id) => {
        const team = this.copy(this.rows.get(id));
        return team === undefined ? [] : [team];
      }),
    );
  }

  listByOrg(org: string): Promise<ReadonlyArray<Team>> {
    return Promise.resolve(
      [...this.order]
        .reverse()
        .map((id) => this.rows.get(id))
        .filter((team): team is Team => team?.metadata?.org === org)
        .map((team) => clone(TeamSchema, team)),
    );
  }

  findIdsByOrg(org: string): Promise<ReadonlyArray<string>> {
    return Promise.resolve(
      this.order.filter((id) => this.rows.get(id)?.metadata?.org === org),
    );
  }

  findAll(): Promise<ReadonlyArray<Team>> {
    return Promise.resolve(
      this.order
        .map((id) => this.rows.get(id))
        .filter((team): team is Team => team !== undefined)
        .map((team) => clone(TeamSchema, team)),
    );
  }

  deleteById(id: string): Promise<void> {
    this.rows.delete(id);
    const index = this.order.indexOf(id);
    if (index >= 0) {
      this.order.splice(index, 1);
    }
    return Promise.resolve();
  }

  private copy(team: Team | undefined): Team | undefined {
    return team === undefined ? undefined : clone(TeamSchema, team);
  }
}

/** A stored team as the create chain shapes one. */
export function storedTeam(fields: {
  id: string;
  org: string;
  slug: string;
  name?: string;
  createdAt?: Date;
}): Team {
  const stamp = timestampFromDate(fields.createdAt ?? new Date("2026-09-24T10:00:00Z"));
  return create(TeamSchema, {
    apiVersion: "iam.stigmer.ai/v1",
    kind: "Team",
    metadata: create(ApiResourceMetadataSchema, {
      id: fields.id,
      org: fields.org,
      slug: fields.slug,
      name: fields.name ?? fields.slug,
    }),
    status: create(ApiResourceAuditStatusSchema, {
      audit: create(ApiResourceAuditSchema, {
        specAudit: create(ApiResourceAuditInfoSchema, {
          createdAt: stamp,
          updatedAt: stamp,
        }),
      }),
    }),
  });
}
