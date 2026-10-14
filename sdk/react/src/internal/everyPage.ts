/**
 * The whole of a list, for a hook whose consumer needs every entry.
 *
 * `readEveryPage` serves a set that stays small (a picker, a lookup by id):
 * it walks the list's tokens and refuses past the SDK's cap rather than
 * hand a cut list to a caller that would read it as the whole
 * (`readEveryPage` in `@stigmer/sdk`).
 *
 * {@link readWholeList} serves a set that grows without bound but that a
 * view still needs whole (a session's runs and scores, an organization's
 * channels): it walks every page with no cap, so a long-lived session
 * loads instead of failing at the cap.
 *
 * @internal Not part of the public `@stigmer/react` API.
 */
import { everyEntry, type ListPage } from "@stigmer/sdk";

export { readEveryPage } from "@stigmer/sdk";

/** Every entry of a list, walked page by page with no cap. */
export async function readWholeList<T>(
  read: (pageToken: string) => Promise<ListPage<T>>,
): Promise<T[]> {
  const entries: T[] = [];
  for await (const entry of everyEntry(read)) {
    entries.push(entry);
  }
  return entries;
}

/** The largest page a list serves; a walk reads at this size. */
export const LIST_PAGE_MAX = 100;
