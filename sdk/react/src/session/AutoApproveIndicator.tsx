"use client";

/**
 * Armed-only indicator for the session-scoped auto-approve state, docked
 * above the composer. Renders nothing about approvals until auto-approve is
 * actually ON — the composer stays clean by default — and while ON it is the
 * always-visible safety surface: the user can never be silently
 * auto-approving without seeing this strip and its one-click "Turn off".
 *
 * The way ON lives elsewhere (the Config facet's Run Config switch, the
 * gate-time "Approve & don't ask again", the account's `default_auto_approve`
 * preference, the host's `approvalDefaults`); this strip is deliberately only
 * the way OFF plus the disclosure. Shared by `SessionViewer` and
 * `NewSessionViewer` (DD-016) — a persisted account preference can arm the
 * launcher before the first message, so both surfaces need the disclosure.
 */
export function AutoApproveIndicator({ onTurnOff }: { readonly onTurnOff: () => void }) {
  return (
    <div
      role="status"
      className="stg:flex stg:items-center stg:gap-2 stg:border-t stg:border-border-muted stg:px-4 stg:py-1.5 stg:text-xs stg:text-muted-foreground"
    >
      <ShieldCheckIcon />
      <span className="stg:min-w-0 stg:flex-1 stg:truncate">
        Auto-approving tool calls for this session
      </span>
      <button
        type="button"
        onClick={onTurnOff}
        className="stg:shrink-0 stg:rounded stg:font-medium stg:text-foreground stg:underline-offset-2 stg:hover:underline stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring"
      >
        Turn off
      </button>
    </div>
  );
}

function ShieldCheckIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="stg:shrink-0 stg:text-success" aria-hidden="true">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}
