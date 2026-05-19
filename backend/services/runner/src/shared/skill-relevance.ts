/**
 * Skill relevance scoring for smart context filtering.
 *
 * Uses a BM25-inspired algorithm to score each skill's relevance
 * against the user message. When an agent has many skills configured,
 * low-relevance skills are excluded from the system prompt to improve
 * signal quality.
 *
 * The progressive disclosure model means only skill metadata
 * (~50-70 tokens per skill) lives in the prompt, so filtering
 * primarily reduces noise rather than saving tokens.
 *
 * BM25 (Best Matching 25) is a lightweight, well-understood ranking
 * function from information retrieval. It uses term frequency saturation
 * and document length normalisation — both important when matching a
 * short user message (query) against short skill metadata (documents of
 * 5-20 tokens each).
 *
 * No external dependencies required.
 */

/** Relevance filtering activates only when the agent has at least this many skills. */
export const SKILL_COUNT_THRESHOLD = 8;

/** Term-frequency saturation. Higher values weight repeated terms more. */
const BM25_K1 = 1.5;

/** Length normalisation. 0 = none, 1 = full relative to average doc length. */
const BM25_B = 0.75;

const STOP_WORDS: ReadonlySet<string> = new Set([
  "a", "an", "the", "is", "are", "was", "were", "be", "been",
  "being", "have", "has", "had", "do", "does", "did", "will",
  "would", "could", "should", "may", "might", "shall", "can",
  "to", "of", "in", "for", "on", "with", "at", "by", "from",
  "as", "into", "through", "during", "before", "after", "above",
  "below", "between", "and", "but", "or", "nor", "not", "so",
  "yet", "both", "either", "neither", "each", "every", "all",
  "any", "few", "more", "most", "some", "such", "no", "only",
  "own", "same", "than", "too", "very", "just", "because",
  "about", "up", "out", "if", "then", "that", "this", "these",
  "those", "it", "its", "i", "me", "my", "we", "our", "you",
  "your", "he", "she", "they", "them", "their", "what", "which",
  "who", "whom", "how", "when", "where", "why",
]);

const TOKEN_PATTERN = /[a-z0-9]+/g;

// ─── Tokenisation ────────────────────────────────────────────────────────

/**
 * Split text into lowercase tokens, dropping stop words and
 * single-character fragments.
 */
export function tokenize(text: string): string[] {
  const matches = text.toLowerCase().match(TOKEN_PATTERN);
  if (!matches) return [];
  return matches.filter(tok => !STOP_WORDS.has(tok) && tok.length > 1);
}

// ─── Data structures ─────────────────────────────────────────────────────

export interface ScoredSkill {
  readonly index: number;
  readonly name: string;
  readonly score: number;
}

export interface SkillFilterResult {
  /** Indices of skills to include in the prompt (original order). */
  readonly includedIndices: number[];
  /** Indices of skills excluded from the prompt (original order). */
  readonly excludedIndices: number[];
  /** Names of excluded skills (sorted alphabetically). */
  readonly excludedNames: string[];
}

// ─── BM25 scoring ────────────────────────────────────────────────────────

/**
 * Score each skill's relevance to the user message using BM25.
 *
 * Each skill's name and description are concatenated into a document
 * and scored against the query terms extracted from the user message.
 *
 * Returns ScoredSkill list ordered by descending score (ties broken alphabetically).
 */
export function scoreSkills(
  userMessage: string,
  skillNames: readonly string[],
  skillDescriptions: readonly string[],
  options?: { k1?: number; b?: number },
): ScoredSkill[] {
  const k1 = options?.k1 ?? BM25_K1;
  const b = options?.b ?? BM25_B;

  const queryTerms = tokenize(userMessage);
  const n = skillNames.length;

  if (n === 0) return [];

  if (queryTerms.length === 0) {
    return skillNames.map((name, index) => ({ index, name, score: 0.0 }));
  }

  // Build per-skill term-frequency maps.
  const docs: Map<string, number>[] = [];
  const docLengths: number[] = [];

  for (let i = 0; i < n; i++) {
    const tokens = tokenize(`${skillNames[i]} ${skillDescriptions[i]}`);
    const tf = new Map<string, number>();
    for (const tok of tokens) {
      tf.set(tok, (tf.get(tok) ?? 0) + 1);
    }
    docs.push(tf);
    docLengths.push(tokens.length);
  }

  const avgdl = docLengths.reduce((sum, l) => sum + l, 0) / n;

  // IDF per unique query term.
  const uniqueQueryTerms = new Set(queryTerms);
  const idf = new Map<string, number>();
  for (const term of uniqueQueryTerms) {
    let df = 0;
    for (const doc of docs) {
      if (doc.has(term)) df++;
    }
    idf.set(term, Math.max(0.0, Math.log((n - df + 0.5) / (df + 0.5) + 1.0)));
  }

  // Score each document.
  const results: ScoredSkill[] = [];
  for (let i = 0; i < n; i++) {
    const docTf = docs[i];
    const dl = docLengths[i];
    let score = 0.0;
    for (const term of queryTerms) {
      const tfVal = docTf.get(term);
      if (tfVal === undefined) continue;
      const numerator = tfVal * (k1 + 1);
      const denominator = tfVal + k1 * (1 - b + b * dl / avgdl);
      score += (idf.get(term) ?? 0.0) * numerator / denominator;
    }
    results.push({ index: i, name: skillNames[i], score });
  }

  results.sort((a, b_) => {
    if (b_.score !== a.score) return b_.score - a.score;
    return a.name.localeCompare(b_.name);
  });

  return results;
}

// ─── Filtering ───────────────────────────────────────────────────────────

/**
 * Partition skills into included / excluded based on relevance.
 *
 * Below the threshold, every skill is included unconditionally.
 * Above the threshold, skills whose BM25 score is zero (no query
 * term overlap at all) are moved to the excluded set.
 *
 * A safety floor guarantees that at least half the skills are
 * always included, regardless of scores.
 */
export function filterSkills(
  userMessage: string,
  skillNames: readonly string[],
  skillDescriptions: readonly string[],
  options?: { threshold?: number },
): SkillFilterResult {
  const threshold = options?.threshold ?? SKILL_COUNT_THRESHOLD;
  const n = skillNames.length;
  const allIndices = Array.from({ length: n }, (_, i) => i);

  if (n < threshold) {
    return {
      includedIndices: allIndices,
      excludedIndices: [],
      excludedNames: [],
    };
  }

  const scored = scoreSkills(userMessage, skillNames, skillDescriptions);

  const included: number[] = [];
  const excluded: number[] = [];
  const excludedNames: string[] = [];

  for (const s of scored) {
    if (s.score > 0.0) {
      included.push(s.index);
    } else {
      excluded.push(s.index);
      excludedNames.push(s.name);
    }
  }

  // Safety: always keep at least half the skills.
  const minIncluded = Math.max(1, Math.floor(n / 2));
  if (included.length < minIncluded) {
    const deficit = minIncluded - included.length;
    const reInclude = excluded.splice(0, deficit);
    included.push(...reInclude);
    for (const idx of reInclude) {
      const nameIdx = excludedNames.indexOf(skillNames[idx]);
      if (nameIdx !== -1) excludedNames.splice(nameIdx, 1);
    }
  }

  included.sort((a, b) => a - b);
  excluded.sort((a, b) => a - b);

  return {
    includedIndices: included,
    excludedIndices: excluded,
    excludedNames: excludedNames.sort(),
  };
}
