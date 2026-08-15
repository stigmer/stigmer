import { describe, it, expect } from "vitest";
import { create } from "@bufbuild/protobuf";
import {
  CursorAccountSyncSnapshotSchema,
  CursorMemberKeySchema,
  CursorMemberSpendSchema,
  CursorTeamMemberSchema,
} from "@stigmer/protos/ai/stigmer/platform/cursoraccount/v1/cursor_account_pb";
import {
  CursorAccountSummarySchema,
  CursorAccountViewSchema,
  CursorMemberKeyState,
  CursorMemberKeyViewSchema,
  CursorTeamMemberViewSchema,
} from "@stigmer/protos/ai/stigmer/platform/cursoraccount/v1/io_pb";
import { CursorAccountSchema } from "@stigmer/protos/ai/stigmer/platform/cursoraccount/v1/cursor_account_pb";
import { deriveCoverage, derivePoolHealth } from "../cursor-account-coverage";

function keyView(keyId: string, state: CursorMemberKeyState) {
  return create(CursorMemberKeyViewSchema, {
    key: create(CursorMemberKeySchema, { keyId, boundEmail: `${keyId}@x.ai` }),
    state,
  });
}

describe("deriveCoverage", () => {
  it("groups keys by server-computed state and passes coverage-gap rows through", () => {
    const active = keyView("k-active", CursorMemberKeyState.member_key_active);
    const removed = keyView("k-removed", CursorMemberKeyState.member_key_owner_removed);
    const stranger = keyView("k-stranger", CursorMemberKeyState.member_key_owner_unknown);
    const gap = create(CursorTeamMemberViewSchema, {
      member: create(CursorTeamMemberSchema, { email: "uncovered@x.ai", role: "member" }),
      spend: create(CursorMemberSpendSchema, { includedSpendUsdMicros: BigInt(42_000) }),
    });

    const coverage = deriveCoverage(
      create(CursorAccountViewSchema, {
        snapshot: create(CursorAccountSyncSnapshotSchema, { accountId: "acc-1" }),
        keyViews: [active, removed, stranger],
        membersWithoutKeysViews: [gap],
      }),
    );

    expect(coverage.hasRoster).toBe(true);
    expect(coverage.onTeamWithKey).toEqual([active]);
    expect(coverage.onTeamWithoutKey).toEqual([gap]);
    // Both "left the team" and "never on it" resolve the same way (a
    // Cursor dashboard invite), so they share the category; the per-key
    // state still distinguishes their labels.
    expect(coverage.offTeamWithKey).toEqual([removed, stranger]);
    expect(coverage.unclassified).toEqual([]);
  });

  it("withholds classification before the first sync — owner-unknown is missing data, not off-team", () => {
    const key = keyView("k-1", CursorMemberKeyState.member_key_owner_unknown);

    const coverage = deriveCoverage(
      create(CursorAccountViewSchema, { keyViews: [key] }),
    );

    expect(coverage.hasRoster).toBe(false);
    expect(coverage.unclassified).toEqual([key]);
    expect(coverage.onTeamWithKey).toEqual([]);
    expect(coverage.onTeamWithoutKey).toEqual([]);
    expect(coverage.offTeamWithKey).toEqual([]);
  });

  it("handles the empty account (no keys, no roster) without inventing rows", () => {
    const coverage = deriveCoverage(create(CursorAccountViewSchema, {}));

    expect(coverage.hasRoster).toBe(false);
    expect(coverage.unclassified).toEqual([]);
    expect(coverage.onTeamWithKey).toEqual([]);
  });
});

describe("derivePoolHealth", () => {
  function summary(opts: {
    enabled?: boolean;
    enabledKeyCount: number;
    routableKeyCount: number;
    guardTrippedKeyCount?: number;
  }) {
    return create(CursorAccountSummarySchema, {
      account: create(CursorAccountSchema, {
        accountId: "acc",
        enabled: opts.enabled ?? true,
      }),
      enabledKeyCount: opts.enabledKeyCount,
      routableKeyCount: opts.routableKeyCount,
      guardTrippedKeyCount: opts.guardTrippedKeyCount ?? 0,
    });
  }

  it("reproduces the 2026-08-15 drain as a one-line fact", () => {
    // Four accounts with enabled keys but zero routable (guard-tripped or
    // owner-removed), one fresh account with a single routable key — the
    // fleet state the per-account enabled counts hid.
    const health = derivePoolHealth([
      summary({ enabledKeyCount: 1, routableKeyCount: 0, guardTrippedKeyCount: 1 }),
      summary({ enabledKeyCount: 10, routableKeyCount: 0 }),
      summary({ enabledKeyCount: 1, routableKeyCount: 0 }),
      summary({ enabledKeyCount: 0, routableKeyCount: 0 }),
      summary({ enabledKeyCount: 2, routableKeyCount: 1, guardTrippedKeyCount: 0 }),
    ]);

    expect(health.totalAccounts).toBe(5);
    expect(health.totalRoutableKeys).toBe(1);
    // The zero-key account is not "drained" — it never had capacity.
    expect(health.drainedAccounts).toBe(3);
    expect(health.guardTrippedKeys).toBe(1);
  });

  it("does not count disabled accounts as drained (disable means drain-by-choice)", () => {
    const health = derivePoolHealth([
      summary({ enabled: false, enabledKeyCount: 3, routableKeyCount: 0 }),
    ]);

    expect(health.drainedAccounts).toBe(0);
  });

  it("is all zeros for an empty list", () => {
    const health = derivePoolHealth([]);

    expect(health.totalAccounts).toBe(0);
    expect(health.totalRoutableKeys).toBe(0);
    expect(health.drainedAccounts).toBe(0);
    expect(health.guardTrippedKeys).toBe(0);
  });
});
