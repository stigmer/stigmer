/**
 * The organization a person has just joined through an invite link, handed
 * from the public invite page to the launcher it sends them to, so the
 * launcher can say they joined and point at the team's agents
 * (stigmer#3208).
 *
 * The hand-off rides `sessionStorage`: it is this tab's alone and gone with
 * the tab, so a later visit never greets again. Within the tab it holds
 * until the person starts a conversation (`forgetJoinedOrg`), the moment
 * the welcome has done its job. The launcher reads it as an external store
 * (`useSyncExternalStore`, with no entry on the server), as the console's
 * other storage-backed state is read. Only the organization's id is kept:
 * an invitation names no display name, and the launcher reads the name
 * from the organization it has open. Every storage access is guarded:
 * storage that is unavailable (private browsing, a blocked origin, a
 * server render) means no welcome, never a broken page.
 */

/** The `sessionStorage` key the invite page writes and the launcher reads. */
export const JOINED_ORG_KEY = "stigmer:invite:joined";

/** The entry's shape: the joined organization's id (`metadata.id`). */
interface JoinedOrgEntry {
  readonly org: string;
}

const listeners = new Set<() => void>();

/**
 * Remember, for this tab's launcher, that the person has just joined `org`
 * (its id). An empty id remembers nothing.
 */
export function rememberJoinedOrg(org: string): void {
  if (org === "") return;
  const entry: JoinedOrgEntry = { org };
  try {
    sessionStorage.setItem(JOINED_ORG_KEY, JSON.stringify(entry));
  } catch {
    // No storage: the launcher simply greets no one.
  }
}

/**
 * The organization this tab has just joined: its id, or `null` when none is
 * remembered, the entry is unreadable, or storage is unavailable.
 */
export function readJoinedOrg(): string | null {
  let raw: string | null;
  try {
    raw = sessionStorage.getItem(JOINED_ORG_KEY);
  } catch {
    return null;
  }
  return raw === null ? null : joinedOrgOf(raw);
}

/** Forget the organization joined: the welcome has done its job. */
export function forgetJoinedOrg(): void {
  try {
    sessionStorage.removeItem(JOINED_ORG_KEY);
  } catch {
    // Unremovable storage: nothing more to do.
  }
  for (const listener of listeners) listener();
}

/** Subscribe to {@link forgetJoinedOrg}, for `useSyncExternalStore`. */
export function subscribeJoinedOrg(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The organization id a stored entry names, or `null` for anything else. */
function joinedOrgOf(raw: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || !("org" in parsed)) return null;
  const { org } = parsed;
  return typeof org === "string" && org !== "" ? org : null;
}
