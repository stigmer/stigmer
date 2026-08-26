/**
 * tsquery rendering and score normalization — the Postgres driver's
 * engine-specific half of the search read contract (DD-009: the Store
 * interface carries engine-neutral terms and wire-ready 0–1 scores; each
 * driver renders its own engine's syntax and normalizes its own engine's
 * ranking). The sqlite counterpart is sqlite/fts5.ts.
 *
 * Declared seam semantics implemented here (interface.ts SearchIndexQuery):
 * each term matches as a token, a SINGLE term is a prefix match, multiple
 * terms compose with AND. Tokenization/stemming is driver-relative — this
 * driver uses the 'english' text search config (Snowball stemming, the
 * closest analog to FTS5's porter tokenizer), declared once here and in
 * the migration's generated tsvector.
 *
 * Weighting: the sqlite driver's bm25 vector spans FIVE columns (kind=1,
 * resource_id=0, name=10, description=5, tags=5); Postgres setweight has
 * exactly FOUR classes (A–D), so a one-to-one mapping is impossible.
 * DD-009 makes ranking driver-relative — the only cross-driver requirement
 * (interface.ts SearchIndexEntry) is that name weighs highest. This driver
 * maps name=A, tags=B, description=C; kind and resource_id are not part of
 * the searchable document at all (their FTS5 weights, 1 and 0, made them
 * near-noise there too).
 *
 * Proven by __tests__/tsquery.test.ts (rendering/sanitization/
 * normalization tables, the fts5.test.ts pattern) and
 * search.conformance.test.ts on local-postgres.
 */

/**
 * Renders the tsquery expression for engine-neutral search terms: every
 * term individually quoted as a lexeme string (tsquery operator syntax —
 * &, |, !, <->, parentheses — becomes literal text inside quotes);
 * embedded single quotes and backslashes stripped (either would terminate
 * or escape the quoted lexeme); a term left empty by stripping is dropped.
 * A SINGLE surviving term gets a trailing `:*` for prefix matching (valid
 * on quoted lexemes) — the prefix decision counts terms AFTER
 * sanitization, mirroring the Go-ported FTS5 order. Multi-term
 * expressions compose with explicit `&` (AND).
 *
 * Terms that sanitize to nothing render "" — to_tsquery rejects an empty
 * expression, which surfaces as the same store failure the FTS5 driver
 * produces for such queries (behavior preserved, not beautified).
 */
export function renderTsQueryExpression(terms: readonly string[]): string {
  const quoted: string[] = [];
  for (const term of terms) {
    const clean = term.replaceAll("'", "").replaceAll("\\", "");
    if (clean === "") {
      continue;
    }
    quoted.push(`'${clean}'`);
  }

  if (quoted.length === 0) {
    return "";
  }
  if (quoted.length === 1) {
    return `${quoted[0]}:*`;
  }
  return quoted.join(" & ");
}

/**
 * ts_rank → the wire's 0–1 (higher = better). ts_rank with default
 * normalization is already higher-is-better and effectively small-positive
 * (typically well under 1; unbounded above only in pathological
 * documents), so the mapping is a clamp — absolute values and cross-driver
 * ordering are explicitly NOT contract (DD-009), only deterministic
 * ordering within this driver is. List mode never reaches this function
 * (its score is pinned exactly 1.0 by the driver).
 */
export function normalizeTsRankScore(tsRank: number): number {
  if (tsRank < 0) {
    return 0;
  }
  if (tsRank > 1) {
    return 1;
  }
  return tsRank;
}
