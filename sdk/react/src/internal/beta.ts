/**
 * Stigmer is in Beta, in the console's words: the mark's word, the one line,
 * and the public page that says what Beta means and the bar for lifting it.
 *
 * Beta is the product's statement, the same in every edition and on every
 * deployment, so no server announces it and no host sets it: these are
 * internal, not exported. The words are the brand's (brand/beta.ts in the
 * repository); this published package cannot import that file, so it spells
 * them out here, and brand/__tests__/beta.test.ts holds this copy equal.
 */

/** The sidebar mark's word. */
export const BETA_WORD = "Beta";

/** The one line, said on the sign-in screen and as the mark's accessible name. */
export const BETA_LINE =
  "Stigmer is in Beta: things may change, and your work is kept. Tell us what breaks.";

/** The page every mention links, on stigmer.ai. */
export const BETA_URL = "https://stigmer.ai/docs/beta";
