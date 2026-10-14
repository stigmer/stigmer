/**
 * The access history's retention on the self-hosted Enterprise server,
 * composed and driven end to end over real Postgres: the operator's window
 * (`STIGMER_ACCESS_HISTORY_RETENTION_DAYS`, handed to the composition as
 * the entry hands it) is declared by the license unit, and the library's
 * retention runner ages the library's own history out, with no Enterprise
 * source of its own. The history is read on the wire; the table and its
 * heads are read raw.
 *
 * Entries cannot be made old by waiting, so the story spans boots over one
 * database: a server records Acme's changes and Doomed's (an organization
 * then deleted and purged), stops; the oldest are back-dated by SQL; a
 * server with a 30-day window starts, and its first pass runs at start.
 *   - every entry older than the window goes, in every organization, the
 *     deleted one included; the heads stay;
 *   - a tool reads where the kept history starts and how long it is kept,
 *     on every page, and the follow read from 0 starts at the oldest kept;
 *   - the next change continues the numbering;
 *   - a licensed server with no window removes nothing and says so.
 *
 * Postgres comes from TEST_DATABASE_URL (unset: skipped by name outside a
 * test gate).
 */
import { createClient } from "@connectrpc/connect";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { GrantCommandController } from "@stigmer/protos/ai/stigmer/iam/grant/v1/command_pb";
import { GrantQueryController } from "@stigmer/protos/ai/stigmer/iam/grant/v1/query_pb";
import { OrganizationCommandController } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/command_pb";
import type { Transport } from "@connectrpc/connect";

import {
  provisionEnterpriseDatabase,
  TEST_DATABASE_URL,
  type ProvisionedEnterpriseDatabase,
} from "../../__test-utils__/enterprise-postgres.js";
import { startLoopbackIssuer, type LoopbackIssuer } from "../../__test-utils__/loopback-issuer.js";
import { newTestSigner, writeTicket } from "../../license/__tests__/test-tickets.js";
import {
  bootEnterprise,
  createOrganization,
  grant,
  licenseClaims,
  ref,
  signIn,
  testClock,
  transportTo,
  type BootedServer,
  type Person,
} from "./enterprise-harness.js";

const ISSUED = new Date("2026-10-01T00:00:00Z");
const DAY_MS = 24 * 60 * 60 * 1000;
/** Long before any window: an entry stamped here is older than every one. */
const LONG_AGO = "2000-01-01T00:00:00.000Z";
/** A test that boots a server waits for it, as the suite's own setup does. */
const BOOTS = 120_000;

describe.skipIf(TEST_DATABASE_URL === undefined)("the access history's retention on a licensed server", () => {
  const signer = newTestSigner();
  const clock = testClock(new Date(ISSUED.getTime() + DAY_MS));
  const licenseKey = writeTicket(signer, licenseClaims({ issuedAt: ISSUED, days: 365, graceDays: 30 }));
  let issuer: LoopbackIssuer;
  let db: ProvisionedEnterpriseDatabase;
  let booted: BootedServer | undefined;
  let alice: Person;
  let acme = "";
  let doomed = "";

  async function boot(accessHistoryRetentionDays: number | undefined): Promise<BootedServer> {
    return bootEnterprise({
      issuer,
      licenseKey,
      ring: signer.ring,
      clock: clock.read,
      databaseUrl: db.databaseUrl,
      pool: db.pool,
      ...(accessHistoryRetentionDays === undefined ? {} : { accessHistoryRetentionDays }),
    });
  }

  /** Alice's transport to the running server. */
  function asAlice(): Transport {
    return transportTo(booted?.port ?? 0, alice.token);
  }

  async function sequencesOf(org: string): Promise<number[]> {
    const rows = await db.pool.query<{ sequence: string }>(
      `SELECT sequence FROM grant_history WHERE org = $1 ORDER BY sequence`,
      [org],
    );
    return rows.rows.map((row) => Number(row.sequence));
  }

  async function headOf(org: string): Promise<number | undefined> {
    const rows = await db.pool.query<{ last_sequence: string }>(
      `SELECT last_sequence FROM grant_history_heads WHERE org = $1`,
      [org],
    );
    const head = rows.rows[0];
    return head === undefined ? undefined : Number(head.last_sequence);
  }

  beforeAll(async () => {
    issuer = await startLoopbackIssuer();
    db = await provisionEnterpriseDatabase();
    booted = await boot(30);
    alice = await signIn(booted, issuer, "operator|alice");
    acme = await createOrganization(alice, "acme");
    const raj = await signIn(booted, issuer, "operator|raj");
    const mia = await signIn(booted, issuer, "operator|mia");
    const grants = createClient(GrantCommandController, alice.transport);
    await grants.create(grant(ref("identity_account", raj.accountId), "member", ref("organization", acme)));
    await grants.create(grant(ref("identity_account", mia.accountId), "member", ref("organization", acme)));

    doomed = await createOrganization(alice, "doomed");
    await createClient(OrganizationCommandController, alice.transport).delete({ value: doomed });
    const running = booted;
    await vi.waitFor(
      async () => {
        await running.server.organizationPurge.runPass();
        expect(await running.server.store.organizationDeletions.isDeleting(doomed)).toBe(false);
      },
      { timeout: 30_000 },
    );
    await booted.close();
    booted = undefined;
  }, 120_000);

  afterAll(async () => {
    await booted?.close();
    await db?.drop();
    await issuer?.close();
  });

  it("removes at start every entry older than the window, in every organization, a deleted one included, and keeps the heads", async () => {
    const acmeBefore = await sequencesOf(acme);
    const doomedBefore = await sequencesOf(doomed);
    expect(acmeBefore.length).toBeGreaterThanOrEqual(3);
    expect(doomedBefore.length).toBeGreaterThan(0);
    await db.pool.query(
      `UPDATE grant_history SET occurred_at = $1
       WHERE (org = $2 AND sequence <= 2) OR org = $3`,
      [LONG_AGO, acme, doomed],
    );

    booted = await boot(30);

    await vi.waitFor(
      async () => {
        expect(await sequencesOf(doomed)).toEqual([]);
        expect(await sequencesOf(acme)).toEqual(acmeBefore.filter((sequence) => sequence > 2));
      },
      { timeout: 30_000 },
    );
    expect(await headOf(acme)).toBe(acmeBefore.at(-1));
    expect(await headOf(doomed)).toBe(doomedBefore.at(-1));
  }, BOOTS);

  it("says on every page how long the history is kept and where the kept history starts", async () => {
    const query = createClient(GrantQueryController, asAlice());
    const follow = await query.listAccessHistory({ org: acme, afterSequence: 0n });
    expect(follow.entries[0]?.sequence).toBe(3n);
    expect(follow.oldestSequence).toBe(3n);
    expect(follow.retentionDays).toBe(30);

    // A tool that held entry 1 learns entry 2 was removed, not missed.
    const resumed = await query.listAccessHistory({ org: acme, afterSequence: 1n });
    expect(resumed.entries[0]?.sequence).toBe(3n);
    expect(resumed.oldestSequence).toBe(3n);

    const newest = await query.listAccessHistory({ org: acme, pageSize: 1 });
    expect(newest.oldestSequence).toBe(3n);
    expect(newest.retentionDays).toBe(30);
  });

  it("continues the numbering after the removal", async () => {
    const head = (await headOf(acme)) ?? 0;
    const lee = await signIn(booted as BootedServer, issuer, "operator|lee");
    await createClient(GrantCommandController, asAlice()).create(
      grant(ref("identity_account", lee.accountId), "member", ref("organization", acme)),
    );
    const newest = await createClient(GrantQueryController, asAlice()).listAccessHistory({
      org: acme,
      pageSize: 1,
    });
    expect(newest.entries[0]?.sequence).toBe(BigInt(head + 1));
  }, BOOTS);

  it("removes nothing on a licensed server with no window, and says it keeps the history for good", async () => {
    await booted?.close();
    booted = undefined;
    const kept = await sequencesOf(acme);
    await db.pool.query(`UPDATE grant_history SET occurred_at = $1 WHERE org = $2`, [LONG_AGO, acme]);

    booted = await boot(undefined);

    const page = await createClient(GrantQueryController, asAlice()).listAccessHistory({
      org: acme,
      afterSequence: 0n,
    });
    expect(page.retentionDays).toBe(0);
    expect(page.oldestSequence).toBe(3n);
    expect(await sequencesOf(acme)).toEqual(kept);
  }, BOOTS);
});
