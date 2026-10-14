/**
 * A plugin's tags, derived at push from its manifest's keywords.
 *
 * Tags are search words with GitHub's topic rule (lowercase letters,
 * digits and hyphens, starting with a letter or digit, at most 50
 * characters, unique, at most 20). A manifest is an outside format whose
 * keywords follow no such rule ("SEC filings", "A/B testing", "otter.ai"),
 * so a push never refuses one for its keywords: each is normalized instead,
 * and the manifest's own words stay verbatim in `spec.keywords`.
 *
 * Normalizing a keyword: lowercase it, turn each run of characters other
 * than a-z and 0-9 into one hyphen, trim hyphens from both ends, and cut it
 * at 50 characters (trimming a hyphen the cut leaves at the end). A keyword
 * that leaves nothing is dropped; repeats keep their first place; the first
 * 20 are kept.
 */

/** The most tags a resource carries (the contract's rule). */
export const MAX_TAGS = 20;

/** The longest tag (the contract's rule). */
export const MAX_TAG_LENGTH = 50;

/** One keyword as a tag, or "" when nothing of it is left. */
export function tagOfKeyword(keyword: string): string {
  return keyword
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_TAG_LENGTH)
    .replace(/-+$/, "");
}

/** The tags a manifest's keywords give: normalized, deduplicated, at most 20. */
export function tagsOfKeywords(keywords: readonly string[]): string[] {
  const tags: string[] = [];
  for (const keyword of keywords) {
    const tag = tagOfKeyword(keyword);
    if (tag !== "" && !tags.includes(tag)) {
      tags.push(tag);
    }
    if (tags.length === MAX_TAGS) {
      break;
    }
  }
  return tags;
}
