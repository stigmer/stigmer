/**
 * FTS5 query rendering and score normalization — the sqlite driver's
 * engine-specific half of the search read contract. The Store interface
 * carries engine-neutral terms and wire-ready scores (engine syntax lives
 * inside each driver, and each driver normalizes its own engine's
 * ranking); this module renders FTS5's.
 *
 * Rendering and normalization live in the driver, not the search
 * service, so the interface stays engine-neutral.
 *
 * Proven by __tests__/fts5.test.ts (the escaping and normalization
 * tables case by case, plus the driver-level read pins) and
 * search.conformance.test.ts on local.
 */

/**
 * Renders the FTS5 MATCH expression for engine-neutral search terms:
 * every term individually double-quoted (operator syntax — NOT/NEAR,
 * column filters — becomes literal text); embedded double quotes
 * stripped; a term left empty by stripping is dropped. A SINGLE
 * surviving term gets a trailing `*` for prefix matching (valid on
 * quoted terms) — the prefix decision counts terms AFTER sanitization. Multi-term expressions use FTS5's implicit AND. The
 * porter unicode61 tokenizer still stems inside quotes.
 *
 * Terms that sanitize to nothing render "" — FTS5 rejects an empty MATCH,
 * which surfaces as a store failure for such queries; the rendering
 * never widens them into a match-all.
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
 * Score normalization: FTS5 bm25() is negative (lower = better); map to the
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
