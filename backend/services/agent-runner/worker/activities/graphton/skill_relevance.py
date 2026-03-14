"""Skill relevance scoring for smart context filtering.

Uses a BM25-inspired algorithm to score each skill's relevance
against the user message.  When an agent has many skills
configured, low-relevance skills are excluded from the system
prompt to improve signal quality.

The progressive disclosure model means only skill metadata
(~50-70 tokens per skill) lives in the prompt, so filtering
primarily reduces noise rather than saving tokens.

Scoring approach
~~~~~~~~~~~~~~~~
BM25 (Best Matching 25) is a lightweight, well-understood ranking
function from information retrieval.  It uses term frequency
saturation and document length normalisation — both important
when matching a short user message (query) against short skill
metadata (documents of 5-20 tokens each).

No external dependencies are required; the implementation uses
only the Python standard library.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass

_SKILL_COUNT_THRESHOLD = 8
"""Relevance filtering activates only when the agent has at least
this many skills.  Below this count every skill is included."""

_BM25_K1 = 1.5
"""Term-frequency saturation.  Higher values give more weight to
repeated terms.  1.2-2.0 is the standard range."""

_BM25_B = 0.75
"""Length normalisation.  0 = no normalisation, 1 = full
normalisation relative to average document length."""

_STOP_WORDS: frozenset[str] = frozenset({
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
})

_TOKEN_PATTERN = re.compile(r"[a-z0-9]+")


# ─── Tokenisation ────────────────────────────────────────────────────────

def _tokenize(text: str) -> list[str]:
    """Split *text* into lowercase tokens, dropping stop words and
    single-character fragments."""
    return [
        tok
        for tok in _TOKEN_PATTERN.findall(text.lower())
        if tok not in _STOP_WORDS and len(tok) > 1
    ]


# ─── Data structures ─────────────────────────────────────────────────────

@dataclass(frozen=True, slots=True)
class ScoredSkill:
    """A skill together with its computed relevance score."""

    index: int
    """Original position in the input list."""

    name: str
    """Skill name (for logging / diagnostics)."""

    score: float
    """BM25 relevance score (higher = more relevant)."""


@dataclass(frozen=True, slots=True)
class SkillFilterResult:
    """Outcome of :func:`filter_skills`."""

    included_indices: list[int]
    """Indices of skills to include in the prompt (original order)."""

    excluded_indices: list[int]
    """Indices of skills excluded from the prompt (original order)."""

    excluded_names: list[str]
    """Names of excluded skills (sorted alphabetically)."""


# ─── BM25 scoring ────────────────────────────────────────────────────────

def score_skills(
    user_message: str,
    skill_names: list[str],
    skill_descriptions: list[str],
    *,
    k1: float = _BM25_K1,
    b: float = _BM25_B,
) -> list[ScoredSkill]:
    """Score each skill's relevance to *user_message* using BM25.

    Each skill's ``name`` and ``description`` are concatenated into a
    document and scored against the query terms extracted from the
    user message.

    Args:
        user_message: The user's input text.
        skill_names: Skill names (parallel with *skill_descriptions*).
        skill_descriptions: Skill descriptions.
        k1: BM25 term-frequency saturation parameter.
        b: BM25 document-length normalisation parameter.

    Returns:
        :class:`ScoredSkill` list ordered by **descending** score.
    """
    query_terms = _tokenize(user_message)

    n = len(skill_names)
    if n == 0:
        return []

    if not query_terms:
        return [
            ScoredSkill(index=i, name=name, score=0.0)
            for i, name in enumerate(skill_names)
        ]

    # Build per-skill term-frequency maps.
    docs: list[dict[str, int]] = []
    doc_lengths: list[int] = []
    for name, desc in zip(skill_names, skill_descriptions):
        tokens = _tokenize(f"{name} {desc}")
        tf: dict[str, int] = {}
        for tok in tokens:
            tf[tok] = tf.get(tok, 0) + 1
        docs.append(tf)
        doc_lengths.append(len(tokens))

    avgdl = sum(doc_lengths) / n

    # IDF per unique query term.
    unique_query_terms = set(query_terms)
    idf: dict[str, float] = {}
    for term in unique_query_terms:
        df = sum(1 for doc in docs if term in doc)
        idf[term] = max(0.0, math.log((n - df + 0.5) / (df + 0.5) + 1.0))

    # Score each document.
    results: list[ScoredSkill] = []
    for i, (doc_tf, dl) in enumerate(zip(docs, doc_lengths)):
        score = 0.0
        for term in query_terms:
            if term not in doc_tf:
                continue
            tf_val = doc_tf[term]
            numerator = tf_val * (k1 + 1)
            denominator = tf_val + k1 * (1 - b + b * dl / avgdl)
            score += idf.get(term, 0.0) * numerator / denominator
        results.append(ScoredSkill(index=i, name=skill_names[i], score=score))

    results.sort(key=lambda s: (-s.score, s.name))
    return results


# ─── Filtering ───────────────────────────────────────────────────────────

def filter_skills(
    user_message: str,
    skill_names: list[str],
    skill_descriptions: list[str],
    *,
    threshold: int = _SKILL_COUNT_THRESHOLD,
) -> SkillFilterResult:
    """Partition skills into included / excluded based on relevance.

    Below *threshold* skills every skill is included unconditionally.
    Above the threshold, skills whose BM25 score is zero (no query
    term overlap at all) are moved to the excluded set.

    A safety floor guarantees that at least half the skills are
    always included, regardless of scores.

    Args:
        user_message: The user's input text.
        skill_names: Skill names.
        skill_descriptions: Skill descriptions.
        threshold: Minimum skill count that activates filtering.

    Returns:
        :class:`SkillFilterResult` with included/excluded partitions.
    """
    n = len(skill_names)
    all_indices = list(range(n))

    if n < threshold:
        return SkillFilterResult(
            included_indices=all_indices,
            excluded_indices=[],
            excluded_names=[],
        )

    scored = score_skills(user_message, skill_names, skill_descriptions)

    included: list[int] = []
    excluded: list[int] = []
    excluded_names: list[str] = []

    for s in scored:
        if s.score > 0.0:
            included.append(s.index)
        else:
            excluded.append(s.index)
            excluded_names.append(s.name)

    # Safety: always keep at least half the skills.
    min_included = max(1, n // 2)
    if len(included) < min_included:
        deficit = min_included - len(included)
        re_include = excluded[:deficit]
        included.extend(re_include)
        for idx in re_include:
            excluded_names.remove(skill_names[idx])
        excluded = excluded[deficit:]

    included.sort()
    excluded.sort()

    return SkillFilterResult(
        included_indices=included,
        excluded_indices=excluded,
        excluded_names=sorted(excluded_names),
    )
