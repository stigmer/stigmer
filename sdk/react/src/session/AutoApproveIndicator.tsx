"use client";

import { Button } from "../button/Button.js";
import { ComposerStrip } from "./ComposerStrip.js";

/**
 * Armed-only indicator for the session-scoped auto-approve state, docked
 * above the composer. Renders nothing about approvals until auto-approve is
 * actually ON — the composer stays clean by default — and while ON it is the
 * always-visible safety surface: the user can never be silently
 * auto-approving without seeing this strip and its one-click "Turn off".
 *
 * The way ON lives elsewhere (the run settings switch in the composer, the
 * gate-time "Approve & don't ask again", the account's `default_auto_approve`
 * preference, the host's `approvalDefaults`); this strip is deliberately only
 * the way OFF plus the disclosure. Shared by `SessionViewer` and
 * `NewSessionViewer` — a persisted account preference can arm the
 * launcher before the first message, so both surfaces need the disclosure.
 * One line, in the family of every strip above the composer (a hook's
 * refusal and the agent's tool lists still bind under auto-approve; the run
 * settings switch says so where the choice is made).
 */
export function AutoApproveIndicator({ onTurnOff }: { readonly onTurnOff: () => void }) {
  return (
    <ComposerStrip
      role="status"
      icon={<ShieldCheckIcon />}
      act={
        <Button variant="ghost" size="xs" onClick={onTurnOff}>
          Turn off
        </Button>
      }
    >
      Approving tool calls automatically
    </ComposerStrip>
  );
}

function ShieldCheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="stg:shrink-0 stg:text-status-ready" aria-hidden="true">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}
