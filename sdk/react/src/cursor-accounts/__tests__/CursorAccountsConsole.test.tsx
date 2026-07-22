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
    membersWithoutKeys: [
      create(CursorTeamMemberSchema, {
        userId: "u2",
        email: "uncovered@scenar.ai",
        name: "Uncovered U",
        role: "member",
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

  it("lists accounts with routability at a glance", async () => {
    const notRoutable = create(CursorAccountSummarySchema, {
      account: scenarAccount({
        accountId: "acc-2",
        displayName: "empty team",
        memberKeys: [],
        orgIds: [],
        isPlatformDefault: true,
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
    expect(screen.getByText("platform default")).toBeTruthy();
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

  it("opens the detail view with key coverage, spend, and gap list", async () => {
    const client = createMockStigmer({
      listAccounts: vi.fn().mockResolvedValue({ accounts: [scenarSummary()] }),
      getAccountView: vi.fn().mockResolvedValue(scenarView()),
    });
    render(<CursorAccountsConsole />, { wrapper: wrapper(client) });

    await waitFor(() => expect(screen.getByText("scenar team")).toBeTruthy());
    await userEvent.click(screen.getByRole("button", { name: /scenar team/ }));

    await waitFor(() => expect(screen.getByText(/zane@scenar\.ai/)).toBeTruthy());
    // Spend joined to the key row: 169342 micro-USD = $0.17.
    expect(screen.getByText(/\$0\.17 this cycle/)).toBeTruthy();
    // Coverage gap: the active member with no key, by name and email.
    expect(screen.getByText(/uncovered@scenar\.ai/)).toBeTruthy();
    expect(screen.getByText("Active")).toBeTruthy();
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
      screen.getByLabelText(/Assigned organization ids/),
      "org-x org-y",
    );
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));

    await waitFor(() => expect(upsertAccount).toHaveBeenCalledTimes(1));
    const submitted = upsertAccount.mock.calls[0][0].account;
    expect(submitted.displayName).toBe("new team");
    expect(submitted.adminApiKey).toBe("key_admin_plain");
    expect(submitted.orgIds).toEqual(["org-x", "org-y"]);
    expect(submitted.enabled).toBe(true);
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
