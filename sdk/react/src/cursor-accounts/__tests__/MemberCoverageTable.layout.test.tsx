// Layout-contract regression suite for the coverage table's column
// budget (stigmer#929). Runs in a real Chromium via
// `vitest.a11y.config.ts` — the defect this pins was a grid-track
// collapse (fixed tracks starving the flexible member column until
// emails rendered one character per line), which only a real layout
// engine can resolve.
//
// The contract has two halves:
//
// 1. At the settings-page canvas (both client apps render settings in
//    `max-w-3xl`, ~720px of content), the table fits WITHOUT horizontal
//    scroll and the member column keeps enough width to render typical
//    emails whole.
// 2. In a narrower host (the SDK component is embeddable at any width,
//    DD-004), the grid's min-width guard turns crushing into horizontal
//    scrolling — the member column never collapses.
//
// Like the provider layout suite (DD-019), this renders against the
// SHIPPED stylesheet (`dist/styles.css`, built by `npm run build:libs`),
// so the contract is verified on the artifact consumers actually load.

import "../../../dist/styles.css";

import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import type { Stigmer } from "@stigmer/sdk";
import {
  CursorAccountSchema,
  CursorAccountSyncSnapshotSchema,
  CursorMemberKeySchema,
  CursorMemberSpendSchema,
  CursorTeamMemberSchema,
} from "@stigmer/protos/ai/stigmer/platform/cursoraccount/v1/cursor_account_pb";
import {
  CursorAccountViewSchema,
  CursorMemberKeyViewSchema,
  CursorMemberKeyState,
  CursorTeamMemberViewSchema,
} from "@stigmer/protos/ai/stigmer/platform/cursoraccount/v1/io_pb";
import { StigmerProvider } from "../../provider";
import { deriveCoverage } from "../cursor-account-coverage";
import type { useCursorMemberKeyActions } from "../useCursorMemberKeyActions";
import { MemberCoverageTable } from "../MemberCoverageTable";

afterEach(cleanup);

// A minimal client: the provider eagerly fetches registries on mount;
// a null credential keeps that non-blocking and off the network.
function makeClient(): Stigmer {
  return {
    baseUrl: "https://example.test",
    getAuthCredential: async () => null,
    fetch: (async () => {
      throw new Error("network disabled in test");
    }) as unknown as typeof globalThis.fetch,
  } as unknown as Stigmer;
}

// The table renders actions through this hook's return; layout never
// invokes them, so rejecting stubs are honest.
const stubActions: ReturnType<typeof useCursorMemberKeyActions> = {
  addKey: () => Promise.reject(new Error("unused in layout test")),
  removeKey: () => Promise.reject(new Error("unused in layout test")),
  setKeyEnabled: () => Promise.reject(new Error("unused in layout test")),
  isSubmitting: false,
  error: null,
  clearError: () => {},
};

/**
 * A view shaped like the account that exposed #929: all three coverage
 * categories populated, real-length emails, a key with both a Cursor
 * key name and an operator label (the widest identity cell).
 */
function fixtureView() {
  const spend = (email: string) =>
    create(CursorMemberSpendSchema, {
      email,
      autoPercentUsed: 12.4,
      apiPercentUsed: 100,
      includedSpendUsdMicros: 201550000n,
      overageSpendUsdMicros: 0n,
    });

  return create(CursorAccountViewSchema, {
    account: create(CursorAccountSchema, {
      accountId: "acc-layout",
      displayName: "layout team",
      adminApiKey: "***REDACTED***",
      enabled: true,
      teamInviteLink: "https://cursor.com/team-invite/layout",
    }),
    snapshot: create(CursorAccountSyncSnapshotSchema, {
      accountId: "acc-layout",
      syncedAt: timestampFromDate(new Date("2026-08-28T10:00:00Z")),
      members: [
        create(CursorTeamMemberSchema, {
          userId: "u1",
          email: "timothy@leftbin.com",
          name: "Timothy M",
          role: "owner",
        }),
        create(CursorTeamMemberSchema, {
          userId: "u2",
          email: "amelia@leftbin.com",
          name: "Amelia F",
          role: "member",
        }),
      ],
    }),
    keyViews: [
      create(CursorMemberKeyViewSchema, {
        key: create(CursorMemberKeySchema, {
          keyId: "k-1",
          apiKey: "***REDACTED***",
          boundEmail: "timothy@leftbin.com",
          cursorKeyName: "stigmer-production-key",
          label: "timothy — prod",
          enabled: true,
        }),
        state: CursorMemberKeyState.member_key_active,
        spend: spend("timothy@leftbin.com"),
      }),
      create(CursorMemberKeyViewSchema, {
        key: create(CursorMemberKeySchema, {
          keyId: "k-2",
          apiKey: "***REDACTED***",
          boundEmail: "lucasb@oneighty.com",
          cursorKeyName: "personal-key",
          enabled: true,
        }),
        state: CursorMemberKeyState.member_key_owner_unknown,
        spend: spend("lucasb@oneighty.com"),
      }),
    ],
    membersWithoutKeysViews: [
      create(CursorTeamMemberViewSchema, {
        member: create(CursorTeamMemberSchema, {
          userId: "u2",
          email: "amelia@leftbin.com",
          name: "Amelia F",
          role: "member",
        }),
      }),
    ],
  });
}

function renderTableAt(hostWidth: number) {
  const view = fixtureView();
  render(
    <div style={{ width: hostWidth }}>
      <StigmerProvider client={makeClient()}>
        <MemberCoverageTable
          accountId="acc-layout"
          coverage={deriveCoverage(view)}
          inviteLink={view.account?.teamInviteLink ?? ""}
          actions={stubActions}
          onChanged={() => {}}
        />
      </StigmerProvider>
    </div>,
  );

  const table = screen.getByRole("table", { name: "Team coverage" });
  // The overflow guard is the table's direct wrapper (the card-chrome div).
  const scroller = table.parentElement as HTMLElement;
  return { table, scroller };
}

function emailCell(email: string): HTMLElement {
  const cell = screen.getByText(email).closest('[role="cell"]');
  expect(cell, `member cell for ${email}`).not.toBeNull();
  return cell as HTMLElement;
}

describe("MemberCoverageTable column budget (#929)", () => {
  it("fits the 768px settings canvas without horizontal scroll, with a legible member column", () => {
    // max-w-3xl (768px) minus the settings page's px-6 → ~720px content.
    const { scroller } = renderTableAt(720);

    expect(scroller.scrollWidth).toBe(scroller.clientWidth);

    // The member column must hold real emails whole. The #929 failure
    // rendered this cell ~1ch wide; anything under ~180px would push
    // typical emails back into truncation as the norm rather than the
    // exception.
    const cell = emailCell("lucasb@oneighty.com");
    expect(cell.getBoundingClientRect().width).toBeGreaterThan(180);

    // One line: the email never wraps (truncation instead of the
    // character-per-line wrapping that motivated this suite).
    const emailEl = screen.getByText("lucasb@oneighty.com");
    const lineHeight = parseFloat(getComputedStyle(emailEl).lineHeight);
    expect(emailEl.getBoundingClientRect().height).toBeLessThan(lineHeight * 1.5);
  });

  it("scrolls horizontally in a narrow host instead of collapsing the member column", () => {
    const { table, scroller } = renderTableAt(400);

    // The min-width guard keeps the grid at its legible minimum and
    // hands the difference to the scroll container.
    expect(scroller.scrollWidth).toBeGreaterThan(scroller.clientWidth);
    expect(table.getBoundingClientRect().width).toBeGreaterThanOrEqual(640);

    // Even mid-scroll the member cell keeps usable width.
    const cell = emailCell("lucasb@oneighty.com");
    expect(cell.getBoundingClientRect().width).toBeGreaterThan(100);
  });
});
