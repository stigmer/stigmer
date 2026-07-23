import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { StigmerError } from "@stigmer/sdk";
import {
  CursorAccountSchema,
  CursorMemberKeySchema,
  CursorTeamMemberSchema,
  CursorMemberSpendSchema,
  CursorAccountSyncSnapshotSchema,
} from "@stigmer/protos/ai/stigmer/platform/cursoraccount/v1/cursor_account_pb";
import {
  CursorAccountSummarySchema,
  CursorAccountViewSchema,
  CursorMemberKeyViewSchema,
  CursorMemberKeyState,
  CursorTeamMemberViewSchema,
} from "@stigmer/protos/ai/stigmer/platform/cursoraccount/v1/io_pb";
import { StigmerContext } from "../../context";
import { FetchCacheContext } from "../../internal/FetchCacheProvider";
import { CursorAccountsConsole } from "../CursorAccountsConsole";

interface MockCursorAccounts {
  listAccounts: ReturnType<typeof vi.fn>;
  getAccountView: ReturnType<typeof vi.fn>;
  upsertAccount: ReturnType<typeof vi.fn>;
  deleteAccount: ReturnType<typeof vi.fn>;
  addMemberKey: ReturnType<typeof vi.fn>;
  removeMemberKey: ReturnType<typeof vi.fn>;
  setMemberKeyEnabled: ReturnType<typeof vi.fn>;
  syncAccount: ReturnType<typeof vi.fn>;
}

function createMockStigmer(cursorAccounts: Partial<MockCursorAccounts> = {}) {
  return {
    cursorAccounts: {
      listAccounts: vi.fn().mockResolvedValue({ accounts: [] }),
      getAccountView: vi.fn(),
      upsertAccount: vi.fn(),
      deleteAccount: vi.fn(),
      addMemberKey: vi.fn(),
      removeMemberKey: vi.fn(),
      setMemberKeyEnabled: vi.fn(),
      syncAccount: vi.fn(),
      ...cursorAccounts,
    },
  } as never;
}

function wrapper(client: unknown) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <FetchCacheContext.Provider value={null}>
        <StigmerContext.Provider value={client as never}>
          {children}
        </StigmerContext.Provider>
      </FetchCacheContext.Provider>
    );
  };
}

function scenarAccount(overrides: Record<string, unknown> = {}) {
  return create(CursorAccountSchema, {
    accountId: "acc-1",
    displayName: "scenar team",
    adminApiKey: "***REDACTED***",
    enabled: true,
    orgIds: ["org-a"],
    memberKeys: [
      create(CursorMemberKeySchema, {
        keyId: "k-1",
        apiKey: "***REDACTED***",
        boundEmail: "zane@scenar.ai",
        cursorKeyName: "stigmer-prod",
        enabled: true,
      }),
    ],
    ...overrides,
  });
}

function scenarSummary() {
  return create(CursorAccountSummarySchema, {
    account: scenarAccount(),
    enabledKeyCount: 1,
    lastSyncedAt: timestampFromDate(new Date("2026-07-22T12:00:00Z")),
  });
}

function scenarView() {
  return create(CursorAccountViewSchema, {
    account: scenarAccount(),
    snapshot: create(CursorAccountSyncSnapshotSchema, {
      accountId: "acc-1",
      syncedAt: timestampFromDate(new Date("2026-07-22T12:00:00Z")),
      members: [
        create(CursorTeamMemberSchema, {
          userId: "u1",
          email: "zane@scenar.ai",
          name: "Zane S",
          role: "owner",
        }),
        create(CursorTeamMemberSchema, {
          userId: "u2",
          email: "uncovered@scenar.ai",
          name: "Uncovered U",
          role: "member",
        }),
        // Cursor marks departed seats role:"removed" in place; they stay
        // in the roster snapshot but never in the coverage categories.
        create(CursorTeamMemberSchema, {
          userId: "u3",
          email: "departed@scenar.ai",
          name: "Departed D",
          role: "removed",
        }),
      ],
      spend: [
        create(CursorMemberSpendSchema, {
          userId: "u1",
          email: "zane@scenar.ai",
          includedSpendUsdMicros: 169342n,
        }),
      ],
    }),
    keyViews: [
      create(CursorMemberKeyViewSchema, {
        key: scenarAccount().memberKeys[0],
        state: CursorMemberKeyState.member_key_active,
        spend: create(CursorMemberSpendSchema, {
          userId: "u1",
          email: "zane@scenar.ai",
          includedSpendUsdMicros: 169342n,
        }),
      }),
    ],
    // The server populates both the deprecated flat list and the
    // spend-joined views; the console reads only the views.
    membersWithoutKeys: [
      create(CursorTeamMemberSchema, {
        userId: "u2",
        email: "uncovered@scenar.ai",
        name: "Uncovered U",
        role: "member",
      }),
    ],
    membersWithoutKeysViews: [
      create(CursorTeamMemberViewSchema, {
        member: create(CursorTeamMemberSchema, {
          userId: "u2",
          email: "uncovered@scenar.ai",
          name: "Uncovered U",
          role: "member",
        }),
        spend: create(CursorMemberSpendSchema, {
          userId: "u2",
          email: "uncovered@scenar.ai",
          includedSpendUsdMicros: 42000n,
        }),
      }),
    ],
  });
}

afterEach(() => {
  cleanup();
});

describe("CursorAccountsConsole", () => {
  it("renders the empty state with onboarding guidance", async () => {
    const client = createMockStigmer();
    render(<CursorAccountsConsole />, { wrapper: wrapper(client) });

    await waitFor(() =>
      expect(screen.getByText(/No Cursor accounts yet/)).toBeTruthy(),
    );
  });

  it("lists accounts with routability and the derived pool class at a glance", async () => {
    const notRoutable = create(CursorAccountSummarySchema, {
      account: scenarAccount({
        accountId: "acc-2",
        displayName: "empty team",
        memberKeys: [],
        // No org assignment = shared-pool account (DD-008): the class is
        // derived from org_ids, never from the deprecated default flag.
        orgIds: [],
      }),
      enabledKeyCount: 0,
    });
    const client = createMockStigmer({
      listAccounts: vi
        .fn()
        .mockResolvedValue({ accounts: [scenarSummary(), notRoutable] }),
    });
    render(<CursorAccountsConsole />, { wrapper: wrapper(client) });

    await waitFor(() => expect(screen.getByText("scenar team")).toBeTruthy());
    expect(screen.getByText("empty team")).toBeTruthy();
    expect(screen.getByText("Not routable")).toBeTruthy();
    expect(screen.getByText("shared pool")).toBeTruthy();
  });

  it("shows the designed access notice on PERMISSION_DENIED", async () => {
    const client = createMockStigmer({
      listAccounts: vi
        .fn()
        .mockRejectedValue(
          new StigmerError("permission-denied", "only platform operators", 7),
        ),
    });
    render(<CursorAccountsConsole />, { wrapper: wrapper(client) });

    await waitFor(() =>
      expect(screen.getByText("Platform operator access required")).toBeTruthy(),
    );
    expect(screen.queryByText(/only platform operators/)).toBeNull();
  });

  it("opens the detail view with the coverage table: covered and gap rows in their groups", async () => {
    const client = createMockStigmer({
      listAccounts: vi.fn().mockResolvedValue({ accounts: [scenarSummary()] }),
      getAccountView: vi.fn().mockResolvedValue(scenarView()),
    });
    render(<CursorAccountsConsole />, { wrapper: wrapper(client) });

    await waitFor(() => expect(screen.getByText("scenar team")).toBeTruthy());
    await userEvent.click(screen.getByRole("button", { name: /scenar team/ }));

    await waitFor(() =>
      expect(screen.getByRole("table", { name: "Team coverage" })).toBeTruthy(),
    );
    // Category 1: on the team, key held — email, key name, spend, status.
    expect(screen.getByText(/On the team — key held/)).toBeTruthy();
    expect(screen.getByText("zane@scenar.ai")).toBeTruthy();
    expect(screen.getByText("stigmer-prod")).toBeTruthy();
    // The email is the row's identity: full value always hoverable on
    // both row kinds (the cell wraps rather than truncates).
    expect(screen.getByTitle("zane@scenar.ai")).toBeTruthy();
    expect(screen.getByTitle("uncovered@scenar.ai")).toBeTruthy();
    expect(screen.getByText("$0.17")).toBeTruthy(); // included, 169342 micro-USD
    expect(screen.getByText("Active")).toBeTruthy();
    // Category 2: on the team, no key — server-joined spend on the gap row.
    expect(screen.getByText(/On the team — no execution key/)).toBeTruthy();
    expect(screen.getByText("uncovered@scenar.ai")).toBeTruthy();
    expect(screen.getByText("$0.04")).toBeTruthy(); // included, 42000 micro-USD
    expect(screen.getByText("No key")).toBeTruthy();
    // Both rows carry all four numeric columns: zero on-demand renders as
    // a real dollar amount and zero pool percents as "0%" (matching
    // Cursor's dashboard), never as em-dashes — those mean "no spend row".
    expect(screen.getAllByText("$0.00")).toHaveLength(2); // on-demand × 2 rows
    expect(screen.getAllByText("0%")).toHaveLength(4); // first-party + API × 2 rows
    // Removed roster entries never render as coverage rows.
    expect(screen.queryByText("departed@scenar.ai")).toBeNull();
    // Header sync line: active members from server facts, removed seats
    // by list arithmetic (roster entries minus active members).
    expect(screen.getByText(/2 members · 1 removed seat/)).toBeTruthy();
  });

  it("affirms full coverage instead of hiding the gap group when every active member holds a key", async () => {
    const coveredView = create(CursorAccountViewSchema, {
      account: scenarAccount(),
      snapshot: create(CursorAccountSyncSnapshotSchema, {
        accountId: "acc-1",
        syncedAt: timestampFromDate(new Date("2026-07-22T12:00:00Z")),
        members: [
          create(CursorTeamMemberSchema, {
            userId: "u1",
            email: "zane@scenar.ai",
            name: "Zane S",
            role: "owner",
          }),
        ],
      }),
      keyViews: [
        create(CursorMemberKeyViewSchema, {
          key: scenarAccount().memberKeys[0],
          state: CursorMemberKeyState.member_key_active,
        }),
      ],
      // A fully covered roster: the server sends no gap views.
    });
    const client = createMockStigmer({
      listAccounts: vi.fn().mockResolvedValue({ accounts: [scenarSummary()] }),
      getAccountView: vi.fn().mockResolvedValue(coveredView),
    });
    render(<CursorAccountsConsole />, { wrapper: wrapper(client) });

    await waitFor(() => expect(screen.getByText("scenar team")).toBeTruthy());
    await userEvent.click(screen.getByRole("button", { name: /scenar team/ }));

    // The gap group renders with an affirmative answer, so "fully
    // covered" is distinguishable from "the sync never classified".
    await waitFor(() =>
      expect(screen.getByText(/On the team — no execution key/)).toBeTruthy(),
    );
    expect(screen.getByText(/roster is fully covered/)).toBeTruthy();
    // A member with no spend row at all renders em-dash cells.
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("classifies off-team keys with invite guidance; copy button only with a configured link", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window.navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    const offTeamView = create(CursorAccountViewSchema, {
      account: scenarAccount({
        teamInviteLink: "https://cursor.com/team-invite/abc",
      }),
      snapshot: create(CursorAccountSyncSnapshotSchema, {
        accountId: "acc-1",
        syncedAt: timestampFromDate(new Date("2026-07-22T12:00:00Z")),
      }),
      keyViews: [
        create(CursorMemberKeyViewSchema, {
          key: create(CursorMemberKeySchema, {
            keyId: "k-stranger",
            apiKey: "***REDACTED***",
            boundEmail: "stranger@else.where",
            enabled: true,
          }),
          state: CursorMemberKeyState.member_key_owner_unknown,
        }),
        create(CursorMemberKeyViewSchema, {
          key: create(CursorMemberKeySchema, {
            keyId: "k-gone",
            apiKey: "***REDACTED***",
            boundEmail: "gone@scenar.ai",
            enabled: true,
          }),
          state: CursorMemberKeyState.member_key_owner_removed,
        }),
      ],
    });
    const client = createMockStigmer({
      listAccounts: vi.fn().mockResolvedValue({ accounts: [scenarSummary()] }),
      getAccountView: vi.fn().mockResolvedValue(offTeamView),
    });
    render(<CursorAccountsConsole />, { wrapper: wrapper(client) });

    await waitFor(() => expect(screen.getByText("scenar team")).toBeTruthy());
    await userEvent.click(screen.getByRole("button", { name: /scenar team/ }));

    await waitFor(() =>
      expect(screen.getByText(/Key held — not on the team/)).toBeTruthy(),
    );
    // The two off-team causes carry distinct labels.
    expect(screen.getByText("Not on team")).toBeTruthy();
    expect(screen.getByText("Left team")).toBeTruthy();

    // One "Copy invite" per off-team row — a copy, never a navigation.
    const copyButtons = screen.getAllByRole("button", { name: "Copy invite" });
    expect(copyButtons).toHaveLength(2);
    await userEvent.click(copyButtons[0]);
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith("https://cursor.com/team-invite/abc"),
    );
    expect(screen.getByRole("button", { name: "Copied" })).toBeTruthy();
  });

  it("points at the Cursor dashboard when no invite link is configured", async () => {
    const offTeamView = create(CursorAccountViewSchema, {
      account: scenarAccount(),
      snapshot: create(CursorAccountSyncSnapshotSchema, {
        accountId: "acc-1",
        syncedAt: timestampFromDate(new Date("2026-07-22T12:00:00Z")),
      }),
      keyViews: [
        create(CursorMemberKeyViewSchema, {
          key: create(CursorMemberKeySchema, {
            keyId: "k-stranger",
            apiKey: "***REDACTED***",
            boundEmail: "stranger@else.where",
            enabled: true,
          }),
          state: CursorMemberKeyState.member_key_owner_unknown,
        }),
      ],
    });
    const client = createMockStigmer({
      listAccounts: vi.fn().mockResolvedValue({ accounts: [scenarSummary()] }),
      getAccountView: vi.fn().mockResolvedValue(offTeamView),
    });
    render(<CursorAccountsConsole />, { wrapper: wrapper(client) });

    await waitFor(() => expect(screen.getByText("scenar team")).toBeTruthy());
    await userEvent.click(screen.getByRole("button", { name: /scenar team/ }));

    await waitFor(() =>
      expect(screen.getByText(/Key held — not on the team/)).toBeTruthy(),
    );
    expect(screen.queryByRole("button", { name: "Copy invite" })).toBeNull();
    expect(screen.getByText(/paste the team's invite link/)).toBeTruthy();
  });

  it("withholds classification before the first sync instead of reporting keys off-team", async () => {
    const unsyncedView = create(CursorAccountViewSchema, {
      account: scenarAccount(),
      keyViews: [
        create(CursorMemberKeyViewSchema, {
          key: scenarAccount().memberKeys[0],
          state: CursorMemberKeyState.member_key_owner_unknown,
        }),
      ],
    });
    const client = createMockStigmer({
      listAccounts: vi.fn().mockResolvedValue({ accounts: [scenarSummary()] }),
      getAccountView: vi.fn().mockResolvedValue(unsyncedView),
    });
    render(<CursorAccountsConsole />, { wrapper: wrapper(client) });

    await waitFor(() => expect(screen.getByText("scenar team")).toBeTruthy());
    await userEvent.click(screen.getByRole("button", { name: /scenar team/ }));

    await waitFor(() =>
      expect(screen.getByText(/not yet classified/)).toBeTruthy(),
    );
    expect(screen.getByText("Awaiting sync")).toBeTruthy();
    expect(screen.queryByText(/Key held — not on the team/)).toBeNull();
  });

  it("adds a member key and refreshes both views", async () => {
    const addMemberKey = vi.fn().mockResolvedValue(scenarAccount());
    const client = createMockStigmer({
      listAccounts: vi.fn().mockResolvedValue({ accounts: [scenarSummary()] }),
      getAccountView: vi.fn().mockResolvedValue(scenarView()),
      addMemberKey,
    });
    render(<CursorAccountsConsole />, { wrapper: wrapper(client) });

    await waitFor(() => expect(screen.getByText("scenar team")).toBeTruthy());
    await userEvent.click(screen.getByRole("button", { name: /scenar team/ }));
    await waitFor(() =>
      expect(screen.getByLabelText(/User-scoped API key/)).toBeTruthy(),
    );

    await userEvent.type(
      screen.getByLabelText(/User-scoped API key/),
      "key_user_plain",
    );
    await userEvent.click(screen.getByRole("button", { name: "Add key" }));

    await waitFor(() =>
      expect(addMemberKey).toHaveBeenCalledWith({
        accountId: "acc-1",
        apiKey: "key_user_plain",
        label: undefined,
      }),
    );
  });

  it("surfaces Cursor's own explanation when a wrong key class is added", async () => {
    const client = createMockStigmer({
      listAccounts: vi.fn().mockResolvedValue({ accounts: [scenarSummary()] }),
      getAccountView: vi.fn().mockResolvedValue(scenarView()),
      addMemberKey: vi
        .fn()
        .mockRejectedValue(
          new StigmerError(
            "invalid-argument",
            "Key rejected by Cursor — This is a team API key from the dashboard's Team API Keys tab",
            3,
          ),
        ),
    });
    render(<CursorAccountsConsole />, { wrapper: wrapper(client) });

    await waitFor(() => expect(screen.getByText("scenar team")).toBeTruthy());
    await userEvent.click(screen.getByRole("button", { name: /scenar team/ }));
    await waitFor(() =>
      expect(screen.getByLabelText(/User-scoped API key/)).toBeTruthy(),
    );

    await userEvent.type(screen.getByLabelText(/User-scoped API key/), "wrong-class");
    await userEvent.click(screen.getByRole("button", { name: "Add key" }));

    await waitFor(() =>
      expect(screen.getByText(/Team API Keys tab/i)).toBeTruthy(),
    );
  });

  it("creates an account through the editor", async () => {
    const upsertAccount = vi.fn().mockResolvedValue(scenarAccount());
    const client = createMockStigmer({
      listAccounts: vi.fn().mockResolvedValue({ accounts: [] }),
      upsertAccount,
    });
    render(<CursorAccountsConsole />, { wrapper: wrapper(client) });

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Add account" })).toBeTruthy(),
    );
    await userEvent.click(screen.getByRole("button", { name: "Add account" }));

    await userEvent.type(screen.getByLabelText(/Display name/), "new team");
    await userEvent.type(
      screen.getByLabelText(/Team Admin API key/),
      "key_admin_plain",
    );
    await userEvent.type(
      screen.getByLabelText(/Dedicated organization ids/),
      "org-x org-y",
    );
    await userEvent.type(
      screen.getByLabelText(/Team invite link/),
      "https://cursor.com/team-invite/abc",
    );
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));

    await waitFor(() => expect(upsertAccount).toHaveBeenCalledTimes(1));
    const submitted = upsertAccount.mock.calls[0][0].account;
    expect(submitted.displayName).toBe("new team");
    expect(submitted.adminApiKey).toBe("key_admin_plain");
    expect(submitted.orgIds).toEqual(["org-x", "org-y"]);
    // Readable round-trip: the invite link submits as typed, no marker.
    expect(submitted.teamInviteLink).toBe("https://cursor.com/team-invite/abc");
    expect(submitted.enabled).toBe(true);
    // Checkbox default checked ("on-demand enabled", Cursor's team default)
    // negates into the proto field.
    expect(submitted.onDemandUsageDisabled).toBe(false);
    // The deprecated default flag is never written by current clients —
    // the shared pool is derived from empty org_ids (DD-008).
    expect(submitted.isPlatformDefault).toBe(false);
  });

  it("declares on-demand usage off through the editor checkbox", async () => {
    const upsertAccount = vi.fn().mockResolvedValue(scenarAccount());
    const client = createMockStigmer({
      listAccounts: vi.fn().mockResolvedValue({ accounts: [] }),
      upsertAccount,
    });
    render(<CursorAccountsConsole />, { wrapper: wrapper(client) });

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Add account" })).toBeTruthy(),
    );
    await userEvent.click(screen.getByRole("button", { name: "Add account" }));

    await userEvent.type(screen.getByLabelText(/Display name/), "capped team");
    await userEvent.type(screen.getByLabelText(/Team Admin API key/), "key_admin");
    await userEvent.click(
      screen.getByRole("checkbox", { name: /On-demand usage enabled/ }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));

    await waitFor(() => expect(upsertAccount).toHaveBeenCalledTimes(1));
    expect(upsertAccount.mock.calls[0][0].account.onDemandUsageDisabled).toBe(true);
  });

  it("bulk-imports keys one per line, keeping failed lines for retry", async () => {
    const accountWithNewKey = scenarAccount({
      memberKeys: [
        scenarAccount().memberKeys[0],
        create(CursorMemberKeySchema, {
          keyId: "k-new",
          apiKey: "***REDACTED***",
          boundEmail: "morgan@scenar.ai",
          enabled: true,
        }),
      ],
    });
    const addMemberKey = vi
      .fn()
      .mockResolvedValueOnce(accountWithNewKey)
      .mockRejectedValueOnce(
        new StigmerError("invalid-argument", "Key rejected by Cursor", 3),
      );
    const syncAccount = vi.fn().mockResolvedValue(scenarView());
    const client = createMockStigmer({
      listAccounts: vi.fn().mockResolvedValue({ accounts: [scenarSummary()] }),
      getAccountView: vi.fn().mockResolvedValue(scenarView()),
      addMemberKey,
      syncAccount,
    });
    render(<CursorAccountsConsole />, { wrapper: wrapper(client) });

    await waitFor(() => expect(screen.getByText("scenar team")).toBeTruthy());
    await userEvent.click(screen.getByRole("button", { name: /scenar team/ }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Import keys" })).toBeTruthy(),
    );

    await userEvent.click(screen.getByRole("button", { name: "Import keys" }));
    const textarea = screen.getByLabelText(/one user-scoped API key per line/);
    await userEvent.type(textarea, "key_good_1234{Enter}key_bad_5678");
    await userEvent.click(screen.getByRole("button", { name: "Import 2 keys" }));

    await waitFor(() => expect(addMemberKey).toHaveBeenCalledTimes(2));
    expect(addMemberKey).toHaveBeenNthCalledWith(1, {
      accountId: "acc-1",
      apiKey: "key_good_1234",
    });
    expect(addMemberKey).toHaveBeenNthCalledWith(2, {
      accountId: "acc-1",
      apiKey: "key_bad_5678",
    });

    // Per-line outcomes: success bound to its member, failure with the error.
    await waitFor(() =>
      expect(screen.getByText(/added — bound to morgan@scenar\.ai/)).toBeTruthy(),
    );
    expect(screen.getByText(/Key rejected by Cursor/)).toBeTruthy();
    // Only the failed key remains in the box for retry.
    expect((textarea as HTMLTextAreaElement).value).toBe("key_bad_5678");
    // The roster sync runs automatically after the import.
    await waitFor(() => expect(syncAccount).toHaveBeenCalledWith("acc-1"));
  });

  it("shows pool-utilization columns and the usage-guard badge from server-computed facts", async () => {
    const guardedView = create(CursorAccountViewSchema, {
      account: scenarAccount({ onDemandUsageDisabled: true }),
      snapshot: create(CursorAccountSyncSnapshotSchema, {
        accountId: "acc-1",
        syncedAt: timestampFromDate(new Date("2026-07-22T12:00:00Z")),
      }),
      keyViews: [
        create(CursorMemberKeyViewSchema, {
          key: scenarAccount().memberKeys[0],
          state: CursorMemberKeyState.member_key_active,
          usageGuardTripped: true,
          spend: create(CursorMemberSpendSchema, {
            email: "zane@scenar.ai",
            includedSpendUsdMicros: 169342n,
            apiPercentUsed: 100,
            autoPercentUsed: 5.19,
            totalPercentUsed: 26.58,
          }),
        }),
      ],
    });
    const client = createMockStigmer({
      listAccounts: vi.fn().mockResolvedValue({ accounts: [scenarSummary()] }),
      getAccountView: vi.fn().mockResolvedValue(guardedView),
    });
    render(<CursorAccountsConsole />, { wrapper: wrapper(client) });

    await waitFor(() => expect(screen.getByText("scenar team")).toBeTruthy());
    await userEvent.click(screen.getByRole("button", { name: /scenar team/ }));

    // The four numeric columns map 1:1 onto Cursor's Members page:
    // first-party pool %, API pool %, included $, on-demand $.
    await waitFor(() => expect(screen.getByText("100%")).toBeTruthy()); // API
    expect(screen.getByText("5%")).toBeTruthy(); // first-party (5.19)
    expect(screen.getByText("$0.17")).toBeTruthy(); // included, 169342 micro-USD
    expect(screen.getByText("$0.00")).toBeTruthy(); // on-demand, none
    // The blended totalPercentUsed (26.58) is deliberately not rendered —
    // it maps to nothing on Cursor's dashboard and reads a flat 100 for
    // removed members.
    expect(screen.queryByText("27%")).toBeNull();
    // The badge renders the server's flag — no client-side threshold math.
    expect(screen.getByText("Usage guard")).toBeTruthy();
    // The header carries the declaration driving the guard.
    expect(screen.getByText(/on-demand usage off \(usage guard active\)/)).toBeTruthy();
  });

  it("keeps the stored admin key when the editor's masked value is untouched", async () => {
    const upsertAccount = vi.fn().mockResolvedValue(scenarAccount());
    const client = createMockStigmer({
      listAccounts: vi.fn().mockResolvedValue({ accounts: [scenarSummary()] }),
      getAccountView: vi.fn().mockResolvedValue(scenarView()),
      upsertAccount,
    });
    render(<CursorAccountsConsole />, { wrapper: wrapper(client) });

    await waitFor(() => expect(screen.getByText("scenar team")).toBeTruthy());
    await userEvent.click(screen.getByRole("button", { name: /scenar team/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Edit" })).toBeTruthy());
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));

    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(upsertAccount).toHaveBeenCalledTimes(1));
    expect(upsertAccount.mock.calls[0][0].account.adminApiKey).toBe("***REDACTED***");
  });
});
