// Reads a cursor-paged list RPC (page_size, page_token, next_page_token)
// until `--limit` entries are in hand or the list ends.
//
// The server reads at most 100 entries per page, answers page_size 0 with
// its default page (50), and may answer a short page with a token (it stops
// after a bounded examination when most rows are not the caller's), so a
// single request is not "the first `limit` rows". Each read asks for what
// is still missing, at most a full page, and follows the token; every read
// advances the server's cursor, so the walk ends. A limit of zero walks
// every page: no request asks the server for the whole list, so the CLI
// gathers it page by page.

/** One page of a cursor-paged list response. */
export interface CursorPage<T> {
  readonly entries: readonly T[];
  readonly nextPageToken: string;
}

/** The most entries the server returns in one page. */
export const SERVER_PAGE_MAX = 100;

export async function readCursorPages<T>(
  limit: number,
  read: (pageSize: number, pageToken: string) => Promise<CursorPage<T>>,
): Promise<T[]> {
  const entries: T[] = [];
  let pageToken = "";
  do {
    const missing = limit === 0 ? SERVER_PAGE_MAX : limit - entries.length;
    const page = await read(Math.min(missing, SERVER_PAGE_MAX), pageToken);
    entries.push(...page.entries);
    pageToken = page.nextPageToken;
  } while (pageToken !== "" && (limit === 0 || entries.length < limit));
  return limit === 0 ? entries : entries.slice(0, limit);
}
