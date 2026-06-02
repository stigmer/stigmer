import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { LedgerEntryType, LedgerView } from "@stigmer/protos/ai/stigmer/billing/v1/enum_pb";
import { StigmerContext } from "../../context";
import { FetchCacheContext } from "../../internal/FetchCacheProvider";
import { CreditLedgerTable } from "../CreditLedgerTable";

function createMockStigmer(getCreditLedger: (...args: unknown[]) => Promise<unknown>) {
  return {
    billing: { getCreditLedger },
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

function ledgerEntry(overrides: Record<string, unknown> = {}) {
  return {
    entryId: "led-1",
    type: LedgerEntryType.purchase_credit,
    amountMicros: 50_000_000n,
    balanceAfterMicros: 50_000_000n,
    createdAt: { seconds: 1_750_000_000n },
    ...overrides,
  };
}

describe("CreditLedgerTable", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("requests the server-resolved statement view with a 0-based page number", async () => {
    const getCreditLedger = vi
      .fn()
      .mockResolvedValue({ entries: [ledgerEntry()], totalPages: 1 });

    render(<CreditLedgerTable orgId="org-1" />, {
      wrapper: wrapper(createMockStigmer(getCreditLedger)),
    });

    await waitFor(() => expect(getCreditLedger).toHaveBeenCalled());

    const arg = getCreditLedger.mock.calls[0]![0] as {
      view: LedgerView;
      page: { num: number };
      typeFilter?: unknown;
    };
    // Intent is expressed as a server-resolved view — the client must NOT
    // hand-roll a list of ledger entry types.
    expect(arg.view).toBe(LedgerView.statement);
    expect(arg.typeFilter).toBeUndefined();
    // UI page 1 maps to the 0-based backend page number.
    expect(arg.page.num).toBe(0);
  });

  it("renders Date, Type, and Amount columns but not a Balance column", async () => {
    const getCreditLedger = vi
      .fn()
      .mockResolvedValue({ entries: [ledgerEntry()], totalPages: 1 });

    render(<CreditLedgerTable orgId="org-1" />, {
      wrapper: wrapper(createMockStigmer(getCreditLedger)),
    });

    await waitFor(() => expect(screen.queryByText("Transaction History")).toBeTruthy());

    const headers = screen
      .getAllByRole("columnheader")
      .map((el) => el.textContent);
    expect(headers).toContain("Type");
    expect(headers).toContain("Amount");
    expect(headers).not.toContain("Balance");
  });

  it("shows the funding-oriented empty state when there are no entries", async () => {
    const getCreditLedger = vi
      .fn()
      .mockResolvedValue({ entries: [], totalPages: 0 });

    render(<CreditLedgerTable orgId="org-1" />, {
      wrapper: wrapper(createMockStigmer(getCreditLedger)),
    });

    await waitFor(() => expect(screen.queryByText("No transactions yet")).toBeTruthy());
    expect(
      screen.queryByText(/Credit purchases, auto-recharges, and refunds/i),
    ).toBeTruthy();
  });
});
