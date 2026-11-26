// Stigmer is in Beta, in the command line's words: said once after the two
// commands a newcomer starts with (`stigmer auth login`, `stigmer up`), as a
// hint under the result, so the result a script reads (its message and data)
// does not change.
//
// The words are the brand's (brand/beta.ts in the repository); this published
// package cannot import that file, so it spells them out here, and
// brand/__tests__/beta.test.ts holds this copy equal.

/** The one line. */
export const BETA_LINE = "Stigmer is in Beta: things may change, and your work is kept. Tell us what breaks.";

/** The page that says what Beta means and the bar for lifting it. */
export const BETA_URL = "https://stigmer.ai/docs/beta";

/** The hint: the line, ending on where to read more ("… Tell us what breaks: https://…"). */
export const BETA_HINT = `${BETA_LINE.replace(/\.$/, ":")} ${BETA_URL}`;
