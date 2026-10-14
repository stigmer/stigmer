/**
 * Page walking for the one shape every Stigmer list takes: a request names
 * `pageSize` and `pageToken`, a response carries `entries` and
 * `nextPageToken`, and an empty token ends the list. Each generated client
 * emits a `<method>All` iterator beside every list; these helpers serve a
 * hand-written read (search, a fake in a test) and a caller that needs the
 * whole list at once.
 *
 * Proven by __tests__/pages.test.ts.
 */

/** One page of a list, as every list response carries it. */
export interface ListPage<T> {
  readonly entries: readonly T[];
  readonly nextPageToken: string;
}

/** The most entries {@link readEveryPage} gathers before it refuses. */
export const READ_EVERY_PAGE_DEFAULT_CAP = 1000;

/**
 * Every entry of a list, page after page: `read` returns the page a token
 * names ("" naming the first), and the walk follows `nextPageToken` from
 * `firstToken` until it is empty. Breaking out of the loop stops the reads.
 */
export async function* everyEntry<T>(
  read: (pageToken: string) => Promise<ListPage<T>>,
  firstToken = "",
): AsyncGenerator<T> {
  let pageToken = firstToken;
  for (;;) {
    const page = await read(pageToken);
    yield* page.entries;
    if (page.nextPageToken === "") return;
    pageToken = page.nextPageToken;
  }
}

/**
 * Every entry of a list as one array. Past `cap` entries it throws rather
 * than return a cut list a caller would mistake for the whole; walk
 * {@link everyEntry} instead when the list may be longer.
 */
export async function readEveryPage<T>(
  read: (pageToken: string) => Promise<ListPage<T>>,
  options?: { readonly cap?: number },
): Promise<T[]> {
  const cap = options?.cap ?? READ_EVERY_PAGE_DEFAULT_CAP;
  const entries: T[] = [];
  for await (const entry of everyEntry(read)) {
    if (entries.length === cap) {
      throw new Error(
        `the list holds more than ${cap} entries; walk it with everyEntry instead`,
      );
    }
    entries.push(entry);
  }
  return entries;
}
