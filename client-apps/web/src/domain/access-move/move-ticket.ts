// ---------------------------------------------------------------------------
// The access move's ticket between its two halves.
//
// The ticket is asked for while signed in the old way and redeemed once
// signed in through the organization's SSO provider, in the same tab. It is
// the move's authorization, so it lives in this tab's sessionStorage only,
// for the few minutes between the two: never in a URL, a log or a view.
// ---------------------------------------------------------------------------

const TICKET_KEY = "stigmer:access-move:ticket";

/** What the second half needs: the ticket, and the organization for the page's copy. */
export interface PendingMove {
  readonly ticket: string;
  readonly org: string;
}

export function savePendingMove(move: PendingMove): void {
  sessionStorage.setItem(TICKET_KEY, JSON.stringify(move));
}

/** The pending move, or `null` when there is none or it is malformed. */
export function readPendingMove(): PendingMove | null {
  const raw = sessionStorage.getItem(TICKET_KEY);
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object") return null;
    const { ticket, org } = parsed as Record<string, unknown>;
    return typeof ticket === "string" &&
      ticket !== "" &&
      typeof org === "string"
      ? { ticket, org }
      : null;
  } catch {
    return null;
  }
}

export function clearPendingMove(): void {
  sessionStorage.removeItem(TICKET_KEY);
}
