import { describe, it, expect } from "vitest";
import { create } from "@bufbuild/protobuf";
import {
  CursorAccountSyncSnapshotSchema,
  CursorMemberKeySchema,
  CursorMemberSpendSchema,
  CursorTeamMemberSchema,
} from "@stigmer/protos/ai/stigmer/platform/cursoraccount/v1/cursor_account_pb";
import {
  CursorAccountViewSchema,
  CursorMemberKeyState,
  CursorMemberKeyViewSchema,
  CursorTeamMemberViewSchema,
} from "@stigmer/protos/ai/stigmer/platform/cursoraccount/v1/io_pb";
import { deriveCoverage } from "../cursor-account-coverage";

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
