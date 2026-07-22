"use client";

import { cn } from "@stigmer/theme";

/**
 * The access-denied state for the Cursor-accounts operator surface.
 * Server-side authorization (`can_manage_cursor_accounts` on
 * `platform:stigmer`) is the real gate — this is the honest, designed
 * face of that denial for anyone who navigates to the operator route
 * without the permission, instead of a raw RPC error string.
 */
export function CursorAccountsAccessNotice({
  className,
}: {
  readonly className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-card px-4 py-6 text-center",
        className,
      )}
      role="status"
    >
      <p className="text-xs font-semibold text-foreground">
        Platform operator access required
      </p>
      <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
        Cursor account management is a Stigmer-internal surface holding
        provider credentials and team spend. It needs the platform operator
        role — organization roles do not grant it. If you believe you should
        have access, contact a platform operator.
      </p>
    </div>
  );
}
