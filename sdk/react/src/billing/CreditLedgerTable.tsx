"use client";

import { useState } from "react";
import { cn } from "@stigmer/theme";
import { getUserMessage } from "@stigmer/sdk";
import type { CreditLedgerEntry } from "@stigmer/protos/ai/stigmer/billing/v1/credit_pb";
import { LedgerView } from "@stigmer/protos/ai/stigmer/billing/v1/enum_pb";
import {
  formatLedgerAmount,
  formatLedgerDate,
  ledgerEntryLabel,
  isCredit,
  isHold,
} from "./format";
import { useCreditLedger, type UseCreditLedgerOptions } from "./useCreditLedger";

/** Props for {@link CreditLedgerTable}. */
export interface CreditLedgerTableProps {
  /** Organization ID to fetch ledger entries for. */
  readonly orgId: string;
  /** Additional CSS class names. */
  readonly className?: string;
}

/**
 * Paginated transaction history table showing credit ledger entries.
 *
 * Displays entries with type badges, signed amounts, and running
 * balance. Supports pagination with simple prev/next controls.
 * Uses semantic colors: green for credits, red for debits, gray
 * for holds and releases.
 *
 * @example
 * ```tsx
 * <CreditLedgerTable orgId={activeOrg.metadata.id} />
 * ```
 */
export function CreditLedgerTable({
  orgId,
  className,
}: CreditLedgerTableProps) {
  const [pageNum, setPageNum] = useState(1);
  // Request the server-resolved account statement: funding and money-movement
  // events only. Routine internal mechanics (per-call usage debits, reservation
  // holds/releases) are classified out server-side; consumption is surfaced in
  // the usage report instead.
  const options: UseCreditLedgerOptions = {
    pageNum,
    pageSize: 10,
    view: LedgerView.statement,
  };
  const { ledger, isLoading, error } = useCreditLedger(orgId, options);

  if (isLoading) {
    return (
      <div className={cn("space-y-2", className)} aria-busy="true">
        <div className="h-4 w-32 animate-pulse rounded bg-muted-subtle" />
        {Array.from({ length: 5 }, (_, i) => (
          <div
            key={i}
            className="h-10 animate-pulse rounded-lg bg-muted-subtle"
          />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <p className={cn("text-destructive text-xs", className)} role="alert">
        {getUserMessage(error)}
      </p>
    );
  }

  const entries = ledger?.entries ?? [];
  const totalPages = ledger?.totalPages ?? 0;

  return (
    <div className={className}>
      <h3 className="mb-2 text-xs font-semibold text-foreground">
        Transaction History
      </h3>

      {entries.length === 0 ? (
        <EmptyLedger />
      ) : (
        <>
          <div
            className="rounded-lg border border-border bg-card"
            role="table"
            aria-label="Credit ledger"
          >
            <LedgerHeader />
            {entries.map((entry) => (
              <LedgerRow key={entry.entryId} entry={entry} />
            ))}
          </div>

          {totalPages > 1 && (
            <Pagination
              pageNum={pageNum}
              totalPages={totalPages}
              onPageChange={setPageNum}
            />
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// LedgerHeader (internal)
// ---------------------------------------------------------------------------

function LedgerHeader() {
  return (
    <div
      role="row"
      className="grid grid-cols-[1fr_auto] gap-x-4 border-b border-border px-3.5 py-2 text-[0.65rem] font-medium uppercase tracking-wider text-muted-foreground sm:grid-cols-[auto_1fr_auto]"
    >
      <span role="columnheader" className="hidden sm:block">
        Date
      </span>
      <span role="columnheader">Type</span>
      <span role="columnheader" className="text-right">
        Amount
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// LedgerRow (internal)
// ---------------------------------------------------------------------------

function LedgerRow({ entry }: { entry: CreditLedgerEntry }) {
  const entryType = entry.type;
  const credit = isCredit(entryType);
  const hold = isHold(entryType);

  return (
    <div
      role="row"
      className="grid grid-cols-[1fr_auto] items-center gap-x-4 border-b border-border-muted px-3.5 py-2.5 last:border-b-0 sm:grid-cols-[auto_1fr_auto]"
    >
      <span
        role="cell"
        className="hidden text-xs tabular-nums text-muted-foreground sm:block sm:w-36"
      >
        {entry.createdAt
          ? formatLedgerDate(entry.createdAt.seconds)
          : "\u2014"}
      </span>

      <div role="cell" className="min-w-0">
        <span
          className={cn(
            "inline-block rounded-full px-2 py-0.5 text-[0.65rem] font-medium",
            credit
              ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
              : hold
                ? "bg-muted text-muted-foreground"
                : "bg-destructive-subtle text-destructive",
          )}
        >
          {ledgerEntryLabel(entryType)}
        </span>
        {entry.source?.description && (
          <span className="ml-2 text-xs text-muted-foreground">
            {entry.source.description}
          </span>
        )}
        {entry.createdAt && (
          <span className="mt-0.5 block text-[0.6rem] tabular-nums text-muted-foreground sm:hidden">
            {formatLedgerDate(entry.createdAt.seconds)}
          </span>
        )}
      </div>

      <span
        role="cell"
        className={cn(
          "text-right text-xs font-medium tabular-nums",
          credit
            ? "text-emerald-600 dark:text-emerald-400"
            : hold
              ? "text-muted-foreground"
              : "text-destructive",
        )}
      >
        {formatLedgerAmount(entry.amountMicros)}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pagination (internal)
// ---------------------------------------------------------------------------

function Pagination({
  pageNum,
  totalPages,
  onPageChange,
}: {
  pageNum: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}) {
  return (
    <div
      className="mt-3 flex items-center justify-between"
      role="navigation"
      aria-label="Ledger pagination"
    >
      <button
        type="button"
        disabled={pageNum <= 1}
        onClick={() => onPageChange(pageNum - 1)}
        className="rounded-md px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
      >
        Previous
      </button>
      <span className="text-xs tabular-nums text-muted-foreground">
        Page {pageNum} of {totalPages}
      </span>
      <button
        type="button"
        disabled={pageNum >= totalPages}
        onClick={() => onPageChange(pageNum + 1)}
        className="rounded-md px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
      >
        Next
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// EmptyLedger (internal)
// ---------------------------------------------------------------------------

function EmptyLedger() {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-border bg-card py-10 text-center">
      <ReceiptIcon className="text-muted-foreground mb-3 size-8" />
      <p className="text-sm font-medium text-foreground">
        No transactions yet
      </p>
      <p className="mt-1 max-w-xs text-xs text-muted-foreground">
        Credit purchases, auto-recharges, and refunds will appear here as
        your organization funds its account.
      </p>
    </div>
  );
}

function ReceiptIcon({ className }: { className?: string }) {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z" />
      <path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8" />
      <path d="M12 17.5v.5M12 6v.5" />
    </svg>
  );
}
