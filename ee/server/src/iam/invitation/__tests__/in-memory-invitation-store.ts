/**
 * An in-memory InvitationStore for the lane's unit suite: the Postgres
 * store's contract over a Map, with the redemption's guard kept (active and
 * under the limit, decided from the stored row), the release's rules kept
 * (one entry matching the person and the whole-second instant, the latch
 * reopened only from fully_redeemed), and two scripted faults: a lost
 * last-slot race, which the Postgres store answers the same way
 * (`refused`), and a release that throws. A host's own suites pin its
 * adapter to what this one promises; `storedInvitation` shapes a row as a
 * create writes one.
 */
import { clone, create, toBinary } from "@bufbuild/protobuf";
import { timestampFromDate, TimestampSchema } from "@bufbuild/protobuf/wkt";

import { ApiResourceMetadataSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";
import {
  ApiResourceAuditInfoSchema,
  ApiResourceAuditSchema,
} from "@stigmer/protos/ai/stigmer/commons/apiresource/status_pb";
import type { Invitation } from "@stigmer/protos/ai/stigmer/iam/invitation/v1/api_pb";
import {
  InvitationRedemptionSchema,
  InvitationSchema,
  InvitationStatusSchema,
} from "@stigmer/protos/ai/stigmer/iam/invitation/v1/api_pb";
import { InvitationState } from "@stigmer/protos/ai/stigmer/iam/invitation/v1/enum_pb";
import { InvitationSpecSchema } from "@stigmer/protos/ai/stigmer/iam/invitation/v1/spec_pb";
import { IamRole } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";

import type { ListIndexCursor, ListIndexRow } from "@stigmer/server";

import { pageNewestFirst } from "../../../__test-utils__/in-memory-keyset.js";
import {
  ledgerSeconds,
  type InvitationStore,
  type RedemptionOutcome,
  type ReleaseOutcome,
} from "../store.js";

export class InMemoryInvitationStore implements InvitationStore {
  readonly rows = new Map<string, Invitation>();
  /** When set, the next redemption loses its slot race to another redeemer. */
  loseNextRace = false;
  /** When set, the next release throws this fault. */
  failNextRelease: Error | undefined;

  save(invitation: Invitation): Promise<void> {
    this.rows.set(invitation.metadata?.id ?? "", clone(InvitationSchema, invitation));
    return Promise.resolve();
  }

  revoke(invitationId: string): Promise<Invitation | undefined> {
    const row = this.rows.get(invitationId);
    if (row?.status !== undefined && row.status.state !== InvitationState.revoked) {
      row.status.state = InvitationState.revoked;
    }
    return Promise.resolve(row === undefined ? undefined : clone(InvitationSchema, row));
  }

  deleteById(id: string): Promise<void> {
    this.rows.delete(id);
    return Promise.resolve();
  }

  findById(id: string): Promise<Invitation | undefined> {
    const row = this.rows.get(id);
    return Promise.resolve(row === undefined ? undefined : clone(InvitationSchema, row));
  }

  findByToken(token: string): Promise<Invitation | undefined> {
    const row = [...this.rows.values()].find((entry) => entry.status?.token === token);
    return Promise.resolve(row === undefined ? undefined : clone(InvitationSchema, row));
  }

  pageByOrg(
    org: string,
    after: ListIndexCursor | undefined,
    limit: number | undefined,
  ): Promise<ReadonlyArray<ListIndexRow>> {
    const entries = [...this.rows.values()]
      .filter((entry) => entry.metadata?.org === org)
      .map((entry) => ({
        id: entry.metadata?.id ?? "",
        data: toBinary(InvitationSchema, entry),
        createdAt: entry.status?.audit?.specAudit?.createdAt,
      }));
    return Promise.resolve(pageNewestFirst(entries, after, limit));
  }

  findIdsByOrg(org: string): Promise<ReadonlyArray<string>> {
    return Promise.resolve(
      [...this.rows.values()]
        .filter((entry) => entry.metadata?.org === org)
        .map((entry) => entry.metadata?.id ?? ""),
    );
  }

  findAll(): Promise<ReadonlyArray<Invitation>> {
    return Promise.resolve([...this.rows.values()].map((entry) => clone(InvitationSchema, entry)));
  }

  recordRedemption(
    invitationId: string,
    identityAccountId: string,
    redeemedAt: Date,
  ): Promise<RedemptionOutcome> {
    const row = this.rows.get(invitationId);
    if (row === undefined || this.loseNextRace) {
      if (row?.status !== undefined && this.loseNextRace) {
        // The racer that won took the last slot.
        row.status.redemptionCount = row.spec?.maxRedemptions ?? row.status.redemptionCount;
        row.status.state = InvitationState.fully_redeemed;
      }
      this.loseNextRace = false;
      return Promise.resolve({ kind: "refused" });
    }
    const status = row.status;
    const max = row.spec?.maxRedemptions ?? 0;
    if (
      status === undefined ||
      status.state !== InvitationState.active ||
      (max > 0 && status.redemptionCount >= max)
    ) {
      return Promise.resolve({ kind: "refused" });
    }
    status.redemptionCount += 1;
    status.redemptions.push(
      create(InvitationRedemptionSchema, {
        identityAccountId,
        redeemedAt: create(TimestampSchema, { seconds: ledgerSeconds(redeemedAt) }),
      }),
    );
    if (max > 0 && status.redemptionCount >= max) {
      status.state = InvitationState.fully_redeemed;
    }
    return Promise.resolve({ kind: "recorded", invitation: clone(InvitationSchema, row) });
  }

  releaseRedemption(
    invitationId: string,
    identityAccountId: string,
    redeemedAt: Date,
  ): Promise<ReleaseOutcome> {
    const fault = this.failNextRelease;
    if (fault !== undefined) {
      this.failNextRelease = undefined;
      return Promise.reject(fault);
    }
    const status = this.rows.get(invitationId)?.status;
    const seconds = ledgerSeconds(redeemedAt);
    const index =
      status?.redemptions.findIndex(
        (entry) => entry.identityAccountId === identityAccountId && entry.redeemedAt?.seconds === seconds,
      ) ?? -1;
    if (status === undefined || index < 0) {
      return Promise.resolve({ kind: "absent" });
    }
    status.redemptions.splice(index, 1);
    status.redemptionCount = Math.max(0, status.redemptionCount - 1);
    const max = this.rows.get(invitationId)?.spec?.maxRedemptions ?? 0;
    if (status.state === InvitationState.fully_redeemed && max > 0 && status.redemptionCount < max) {
      status.state = InvitationState.active;
    }
    return Promise.resolve({ kind: "released" });
  }
}

/** The row's creation instant as the Postgres store renders a cursor: UTC, microseconds. */
/** A stored invitation as the create chain shapes one: an active link with its token and creation time. */
export function storedInvitation(fields: {
  id: string;
  org: string;
  token: string;
  maxRedemptions?: number;
  createdAt?: Date;
}): Invitation {
  const stamp = timestampFromDate(fields.createdAt ?? new Date("2026-09-26T10:00:00Z"));
  return create(InvitationSchema, {
    apiVersion: "iam.stigmer.ai/v1",
    kind: "Invitation",
    metadata: create(ApiResourceMetadataSchema, {
      id: fields.id,
      org: fields.org,
      name: fields.id,
    }),
    spec: create(InvitationSpecSchema, {
      role: IamRole.member,
      maxRedemptions: fields.maxRedemptions ?? 0,
      expiresAt: timestampFromDate(new Date("2026-10-26T10:00:00Z")),
    }),
    status: create(InvitationStatusSchema, {
      token: fields.token,
      state: InvitationState.active,
      redemptionCount: 0,
      audit: create(ApiResourceAuditSchema, {
        specAudit: create(ApiResourceAuditInfoSchema, {
          createdAt: stamp,
          updatedAt: stamp,
        }),
      }),
    }),
  });
}
