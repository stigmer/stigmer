// Reads a cursor-paged list RPC (page_size, page_token, next_page_token)
// until `--limit` entries are in hand or the list ends.
//
// The server caps one page at 100 and may answer a short page with a token
// (it stops after a bounded examination when most rows are not the
// caller's), so a single request is not "the first `limit` rows". Each read
// asks for what is still missing and follows the token; every read advances
// the server's cursor, so the walk ends. A limit of zero sends one request
// with page_size 0, which the server answers with the whole list.

/** One page of a cursor-paged list response. */
export interface CursorPage<T> {
  readonly entries: readonly T[];
  readonly nextPageToken: string;
}

export async function readCursorPages<T>(
  limit: number,
  read: (pageSize: number, pageToken: string) => Promise<CursorPage<T>>,
): Promise<T[]> {
  if (limit === 0) {
    return [...(await read(0, "")).entries];
  }
  const entries: T[] = [];
  let pageToken = "";
  do {
    const page = await read(limit - entries.length, pageToken);
    entries.push(...page.entries);
    pageToken = page.nextPageToken;
  } while (pageToken !== "" && entries.length < limit);
  return entries.slice(0, limit);
}
