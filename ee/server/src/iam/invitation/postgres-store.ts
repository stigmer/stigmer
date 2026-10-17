/**
 * The Invitation store's Postgres adapter over `ee.iam_invitation`, which
 * the Enterprise schema chain creates (schema/enterprise-migrations.ts).
 *
 * The rows hold BYTEA payloads, so the redemption invariant (store.ts)
 * rides a SELECT ... FOR UPDATE transaction: the row lock serializes
 * concurrent redemptions and their releases identically.
 *
 * The list pages over the `(org, created_at DESC, id COLLATE "C" DESC)`
 * index through the keyset source every Enterprise list shares
 * (postgres/keyset.ts). `findIdsByOrg` rides the same index.
 */
import type { Pool } from "pg";
import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { timestampDate, TimestampSchema } from "@bufbuild/protobuf/wkt";

import type { Invitation } from "@stigmer/apis/ai/stigmer/iam/invitation/v1/api_pb";
import {
  InvitationRedemptionSchema,
  InvitationSchema,
} from "@stigmer/apis/ai/stigmer/iam/invitation/v1/api_pb";
import { InvitationState } from "@stigmer/apis/ai/stigmer/iam/invitation/v1/enum_pb";

import { pageOrgRows } from "../../postgres/keyset.js";
import { inTransaction } from "../../postgres/transaction.js";
import {
  ledgerSeconds,
  type InvitationStore,
  type RedemptionOutcome,
  type ReleaseOutcome,
} from "./store.js";

export function newInvitationStore(pool: Pool): InvitationStore {
  function decode(data: Buffer): Invitation {
    return fromBinary(InvitationSchema, new Uint8Array(data));
  }

  async function queryOne(
    where: string,
    params: ReadonlyArray<unknown>,
  ): Promise<Invitation | undefined> {
    const result = await pool.query<{ data: Buffer }>(
      `SELECT data FROM ee.iam_invitation ${where} LIMIT 1`,
      [...params],
    );
    return result.rows[0] !== undefined ? decode(result.rows[0].data) : undefined;
  }

  function writeParams(invitation: Invitation) {
    const createdAt = invitation.status?.audit?.specAudit?.createdAt;
    return [
      invitation.metadata?.id ?? "",
      Buffer.from(toBinary(InvitationSchema, invitation)),
      invitation.metadata?.org ?? "",
      invitation.status?.token ?? "",
      createdAt !== undefined ? timestampDate(createdAt) : new Date(),
    ];
  }

  /**
   * One transaction holding the invitation's row lock: `change` reads the
   * locked row and answers the row to write, or undefined to write nothing.
   */
  async function underRowLock<T>(
    invitationId: string,
    change: (invitation: Invitation | undefined) => { readonly write?: Invitation; readonly answer: T },
  ): Promise<T> {
    return inTransaction(pool, async (client) => {
      const locked = await client.query<{ data: Buffer }>(
        "SELECT data FROM ee.iam_invitation WHERE id = $1 FOR UPDATE",
        [invitationId],
      );
      const row = locked.rows[0];
      const { write, answer } = change(row === undefined ? undefined : decode(row.data));
      if (write === undefined) {
        return { commit: false, value: answer };
      }
      await client.query("UPDATE ee.iam_invitation SET data = $2 WHERE id = $1", [
        invitationId,
        Buffer.from(toBinary(InvitationSchema, write)),
      ]);
      return { commit: true, value: answer };
    });
  }

  return {
    async save(invitation): Promise<void> {
      await pool.query(
        `INSERT INTO ee.iam_invitation (id, data, org, token, created_at)
         VALUES ($1, $2, $3, $4, $5)`,
        writeParams(invitation),
      );
    },

    revoke(invitationId): Promise<Invitation | undefined> {
      return underRowLock<Invitation | undefined>(invitationId, (invitation) => {
        const status = invitation?.status;
        if (invitation === undefined || status === undefined || status.state === InvitationState.revoked) {
          return { answer: invitation };
        }
        status.state = InvitationState.revoked;
        return { write: invitation, answer: invitation };
      });
    },

    async deleteById(id): Promise<void> {
      await pool.query("DELETE FROM ee.iam_invitation WHERE id = $1", [id]);
    },

    findById(id) {
      return queryOne("WHERE id = $1", [id]);
    },

    findByToken(token) {
      return queryOne("WHERE token = $1", [token]);
    },

    pageByOrg(org, after, limit) {
      return pageOrgRows(pool, { table: "ee.iam_invitation", org, after, limit });
    },

    async findIdsByOrg(org): Promise<ReadonlyArray<string>> {
      const result = await pool.query<{ id: string }>(
        "SELECT id FROM ee.iam_invitation WHERE org = $1",
        [org],
      );
      return result.rows.map((row) => row.id);
    },

    async findAll(): Promise<ReadonlyArray<Invitation>> {
      const result = await pool.query<{ data: Buffer }>(
        "SELECT data FROM ee.iam_invitation ORDER BY created_at, id",
      );
      return result.rows.map((row) => decode(row.data));
    },

    recordRedemption(invitationId, identityAccountId, redeemedAt): Promise<RedemptionOutcome> {
      return underRowLock<RedemptionOutcome>(invitationId, (invitation) => {
        const status = invitation?.status;
        if (invitation === undefined || status === undefined) {
          return { answer: { kind: "refused" } }; // concurrently deleted
        }
        const maxRedemptions = invitation.spec?.maxRedemptions ?? 0;
        const persistedCount = status.redemptionCount;
        // The guard arms: still active AND
        // under max (0 = unlimited) — decided from the PERSISTED row.
        if (
          status.state !== InvitationState.active ||
          (maxRedemptions > 0 && persistedCount >= maxRedemptions)
        ) {
          return { answer: { kind: "refused" } };
        }
        status.redemptionCount = persistedCount + 1;
        status.redemptions.push(
          create(InvitationRedemptionSchema, {
            identityAccountId,
            redeemedAt: create(TimestampSchema, { seconds: ledgerSeconds(redeemedAt) }),
          }),
        );
        // The fully-redeemed latch: flips exactly when THIS increment
        // reaches the max.
        if (maxRedemptions > 0 && status.redemptionCount >= maxRedemptions) {
          status.state = InvitationState.fully_redeemed;
        }
        return { write: invitation, answer: { kind: "recorded", invitation } };
      });
    },

    releaseRedemption(invitationId, identityAccountId, redeemedAt): Promise<ReleaseOutcome> {
      return underRowLock<ReleaseOutcome>(invitationId, (invitation) => {
        const status = invitation?.status;
        const seconds = ledgerSeconds(redeemedAt);
        const index =
          status?.redemptions.findIndex(
            (entry) =>
              entry.identityAccountId === identityAccountId && entry.redeemedAt?.seconds === seconds,
          ) ?? -1;
        if (invitation === undefined || status === undefined || index < 0) {
          return { answer: { kind: "absent" } };
        }
        status.redemptions.splice(index, 1);
        status.redemptionCount = Math.max(0, status.redemptionCount - 1);
        const maxRedemptions = invitation.spec?.maxRedemptions ?? 0;
        // The latch returns only to the state it came from: a revoked row
        // stays revoked, and expiry is the row's own date.
        if (
          status.state === InvitationState.fully_redeemed &&
          maxRedemptions > 0 &&
          status.redemptionCount < maxRedemptions
        ) {
          status.state = InvitationState.active;
        }
        return { write: invitation, answer: { kind: "released" } };
      });
    },
  };
}
