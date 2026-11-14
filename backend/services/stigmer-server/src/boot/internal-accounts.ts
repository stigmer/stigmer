/**
 * Which sign-in addresses belong to the people who run a server, so the
 * onboarding count leaves their organizations out.
 *
 * The count of how far new organizations got (getOnboardingFunnel) is a
 * question about newcomers. A team that signs up to try its own sign-up,
 * and a paid tester walking it, would otherwise be counted as newcomers.
 * The operator names those addresses with one setting,
 * STIGMER_INTERNAL_ACCOUNTS: a comma-separated list where each entry is an
 * exact address (`sam@example.com`) or a pattern with one `*`
 * (`*@example.com`, `walk+*@example.com`). Matching ignores case. An
 * organization whose creator's sign-in address matches is left out and
 * counted as excluded, so the reader sees how many were.
 *
 * {@link parseInternalAccounts} is a pure function of the setting, so every
 * rule is tested without a server, and it is exported from the package root
 * so a deployment that writes to its own newcomers (Stigmer Cloud's
 * day-later ask) leaves out the same people by the same rule. It is lenient
 * like the help link's settings (help-link.ts): a bad entry never stops the
 * boot, it is dropped with a warning naming the fix.
 *   - An entry needs exactly one `@`, with something on each side.
 *   - An entry holds at most one `*`; one with more is dropped.
 *   - Blank entries (a trailing comma, doubled commas) are skipped silently.
 */

/** The parsed setting: the entries kept, and what to warn about. */
export interface InternalAccounts {
  /** The kept entries, lowercased, in the order written. */
  readonly entries: readonly string[];
  /** Boot warnings, each a sentence for the operator. */
  readonly warnings: readonly string[];
}

/** No internal accounts: what an unset setting means. */
export const NO_INTERNAL_ACCOUNTS: InternalAccounts = { entries: [], warnings: [] };

/** Parses STIGMER_INTERNAL_ACCOUNTS ("" or undefined when unset). */
export function parseInternalAccounts(raw: string | undefined): InternalAccounts {
  const entries: string[] = [];
  const warnings: string[] = [];
  for (const piece of (raw ?? "").split(",")) {
    const entry = piece.trim().toLowerCase();
    if (entry === "") continue;
    const problem = entryProblem(entry);
    if (problem !== undefined) {
      warnings.push(
        `STIGMER_INTERNAL_ACCOUNTS entry '${piece.trim()}' ${problem} — it is ignored; write an address such as sam@example.com or a pattern such as *@example.com`,
      );
      continue;
    }
    if (!entries.includes(entry)) entries.push(entry);
  }
  return { entries, warnings };
}

/** Whether a sign-in address is one of the internal accounts. An empty address never is. */
export function isInternalAccount(accounts: InternalAccounts, email: string | undefined): boolean {
  const address = (email ?? "").trim().toLowerCase();
  if (address === "") return false;
  return accounts.entries.some((entry) => entryMatches(entry, address));
}

/** Why an entry cannot be used, or undefined when it can. */
function entryProblem(entry: string): string | undefined {
  const at = entry.indexOf("@");
  if (at <= 0 || at !== entry.lastIndexOf("@") || at === entry.length - 1) return "is not an address";
  if (/\s/.test(entry)) return "holds a space";
  if (entry.split("*").length > 2) return "holds more than one *";
  return undefined;
}

/** Whether an address matches an entry: exactly, or around its one `*`. */
function entryMatches(entry: string, address: string): boolean {
  const star = entry.indexOf("*");
  if (star === -1) return entry === address;
  const head = entry.slice(0, star);
  const tail = entry.slice(star + 1);
  return address.length >= head.length + tail.length && address.startsWith(head) && address.endsWith(tail);
}
