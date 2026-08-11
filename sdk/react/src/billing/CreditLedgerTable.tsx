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
} from "./format.js";
import { Pagination } from "../internal/Pagination.js";
import { useCreditLedger, type UseCreditLedgerOptions } from "./useCreditLedger.js";

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
      <div className={cn("stg:space-y-2", className)} aria-busy="true">
        <div className="stg:h-4 stg:w-32 stg:animate-pulse stg:rounded stg:bg-muted-subtle" />
        {Array.from({ length: 5 }, (_, i) => (
          <div
            key={i}
            className="stg:h-10 stg:animate-pulse stg:rounded-lg stg:bg-muted-subtle"
          />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <p className={cn("stg:text-destructive stg:text-xs", className)} role="alert">
        {getUserMessage(error)}
      </p>
    );
  }

  const entries = ledger?.entries ?? [];
  const totalPages = ledger?.totalPages ?? 0;

  return (
    <div className={className}>
      <h3 className="stg:mb-2 stg:text-xs stg:font-semibold stg:text-foreground">
        Transaction History
      </h3>

      {entries.length === 0 ? (
        <EmptyLedger />
      ) : (
        <>
          <div
            className="stg:rounded-lg stg:border stg:border-border stg:bg-card"
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
              ariaLabel="Ledger pagination"
              className="stg:mt-3"
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
      className="stg:grid stg:grid-cols-[1fr_auto] stg:gap-x-4 stg:border-b stg:border-border stg:px-3.5 stg:py-2 stg:text-[0.65rem] stg:font-medium stg:uppercase stg:tracking-wider stg:text-muted-foreground stg:sm:grid-cols-[auto_1fr_auto]"
    >
      <span role="columnheader" className="stg:hidden stg:sm:block">
        Date
      </span>
      <span role="columnheader">Type</span>
      <span role="columnheader" className="stg:text-right">
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
      className="stg:grid stg:grid-cols-[1fr_auto] stg:items-center stg:gap-x-4 stg:border-b stg:border-border-muted stg:px-3.5 stg:py-2.5 stg:last:border-b-0 stg:sm:grid-cols-[auto_1fr_auto]"
    >
      <span
        role="cell"
        className="stg:hidden stg:text-xs stg:tabular-nums stg:text-muted-foreground stg:sm:block stg:sm:w-36"
      >
        {entry.createdAt
          ? formatLedgerDate(entry.createdAt.seconds)
          : "\u2014"}
      </span>

      <div role="cell" className="stg:min-w-0">
        <span
          className={cn(
            "stg:inline-block stg:rounded-full stg:px-2 stg:py-0.5 stg:text-[0.65rem] stg:font-medium",
            credit
              ? "stg:bg-emerald-500/10 stg:text-emerald-600 stg:dark:text-emerald-400"
              : hold
                ? "stg:bg-muted stg:text-muted-foreground"
                : "stg:bg-destructive-subtle stg:text-destructive",
          )}
        >
          {ledgerEntryLabel(entryType)}
        </span>
        {entry.source?.description && (
          <span className="stg:ml-2 stg:text-xs stg:text-muted-foreground">
            {entry.source.description}
          </span>
        )}
        {entry.createdAt && (
          <span className="stg:mt-0.5 stg:block stg:text-[0.6rem] stg:tabular-nums stg:text-muted-foreground stg:sm:hidden">
            {formatLedgerDate(entry.createdAt.seconds)}
          </span>
        )}
      </div>

      <span
        role="cell"
        className={cn(
          "stg:text-right stg:text-xs stg:font-medium stg:tabular-nums",
          credit
            ? "stg:text-emerald-600 stg:dark:text-emerald-400"
            : hold
              ? "stg:text-muted-foreground"
              : "stg:text-destructive",
        )}
      >
        {formatLedgerAmount(entry.amountMicros)}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// EmptyLedger (internal)
// ---------------------------------------------------------------------------

function EmptyLedger() {
  return (
    <div className="stg:flex stg:flex-col stg:items-center stg:justify-center stg:rounded-lg stg:border stg:border-border stg:bg-card stg:py-10 stg:text-center">
      <ReceiptIcon className="stg:text-muted-foreground stg:mb-3 stg:size-8" />
      <p className="stg:text-sm stg:font-medium stg:text-foreground">
        No transactions yet
      </p>
      <p className="stg:mt-1 stg:max-w-xs stg:text-xs stg:text-muted-foreground">
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
