/**
 * FTS5 query rendering and score normalization — the sqlite driver's
 * engine-specific half of the search read contract. The Store interface
 * carries engine-neutral terms and wire-ready scores (DD-009: engine
 * syntax lives inside each driver; sub-project DD-001: each driver
 * normalizes its own engine's ranking); this module renders FTS5's.
 *
 * Ports the retired Go server's EscapeFTS5Query and NormalizeScore
 * (pkg/query/search/store/sqlite_search_query_store.go, git history),
 * which the D4 #14 port first placed in the search service — the Phase-2
 * seam redraw moved them here so the interface could stay engine-neutral.
 * The rendering and normalization bytes are unchanged by that move.
 *
 * Proven by __tests__/fts5.test.ts (Go's escaping and normalization
 * tables case-for-case, plus the driver-level read pins) and
 * search.conformance.test.ts on local.
 */

/**
 * Renders the FTS5 MATCH expression for engine-neutral search terms:
 * every term individually double-quoted (operator syntax — NOT/NEAR,
 * column filters — becomes literal text); embedded double quotes
 * stripped; a term left empty by stripping is dropped. A SINGLE
 * surviving term gets a trailing `*` for prefix matching (valid on
 * quoted terms) — the prefix decision counts terms AFTER sanitization,
 * Go's exact order. Multi-term expressions use FTS5's implicit AND. The
 * porter unicode61 tokenizer still stems inside quotes.
 *
 * Terms that sanitize to nothing render "" — FTS5 rejects an empty MATCH,
 * which surfaces as the same store failure the retired Go server produced
 * for such queries (behavior preserved, not beautified).
 */
export function renderFts5MatchExpression(terms: readonly string[]): string {
  const quoted: string[] = [];
  for (const term of terms) {
    const clean = term.replaceAll('"', "");
    if (clean === "") {
      continue;
    }
    quoted.push(`"${clean}"`);
  }

  if (quoted.length === 0) {
    return "";
  }
  if (quoted.length === 1) {
    return `${quoted[0]}*`;
  }
  return quoted.join(" ");
}

/**
 * Go NormalizeScore: FTS5 bm25() is negative (lower = better); map to the
 * wire's 0–1 (higher = better). Non-negative input (list mode's pinned
 * 1.0) → exactly 1.0; else 1 + bm25/10, clamped to [0, 1] — the linear
 * mapping for bm25's typical −5..0 range.
 */
export function normalizeBm25Score(bm25Score: number): number {
  if (bm25Score >= 0) {
    return 1.0;
  }
  const score = 1.0 + bm25Score / 10.0;
  if (score < 0) {
    return 0;
  }
  if (score > 1) {
    return 1;
  }
  return score;
}
