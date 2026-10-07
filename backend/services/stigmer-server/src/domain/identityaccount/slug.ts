/**
 * An identity account's slug, valid by construction. Every other kind's
 * name is chosen by the caller, so a derived slug the rules refuse is
 * refused with its fix ("set metadata.slug", pipeline/steps/slug.ts
 * checkDerivedSlug). An account's name is not: it is the email the
 * provider released, else the subject (steps.ts DefaultAccountName), or
 * the operator's configured name, and refusing it would refuse a sign-in
 * for an email that starts with a digit, a platform-client user whose
 * external id is numeric, or a boot whose operator name has no ASCII
 * letters. So the account derives a slug the rules always admit.
 *
 * Nothing reads an account by slug, and accounts are unique by subject,
 * never by slug (steps.ts CheckDuplicate), so the slug only has to be
 * valid and stable for the account. The derivation:
 *
 *   - the shared generator over the name (generateSlug), kept as it is
 *     whenever the rules admit it, so a valid slug is the one every
 *     earlier release derived;
 *   - nothing left (no ASCII letter or digit in the name): the first
 *     fallback that leaves something, the subject, then the account id;
 *   - not starting with a letter: `a-` in front;
 *   - longer than 63, or shorter than 2: cut to fit and suffixed with the
 *     first 8 hex digits of the source's SHA-256, so two long emails that
 *     share their first 54 characters still differ.
 *
 * The cloud's own account writer derives through this same function, and
 * each edition's store migration repairs the slugs stored before it.
 */
import { createHash } from "node:crypto";

import { generateSlug } from "../../pipeline/steps/slug.js";

/** metadata.slug's bounds, the ones every reference to a resource holds. */
const MAX_SLUG_LENGTH = 63;
const MIN_SLUG_LENGTH = 2;
const HASH_DIGITS = 8;
const LEADING_LETTER = /^[a-z]/;

/**
 * The slug for an account named `name`, valid under metadata.slug's rules.
 * `fallbacks` (the subject, then the account id) stand in, in order, when
 * the name leaves nothing; at least one of the inputs must hold an ASCII
 * letter or digit, which an account id always does.
 */
export function accountSlugFor(name: string, ...fallbacks: string[]): string {
  let source = name;
  let slug = generateSlug(name);
  for (const fallback of fallbacks) {
    if (slug !== "") {
      break;
    }
    source = fallback;
    slug = generateSlug(fallback);
  }
  if (slug === "") {
    throw new Error(
      "an account slug needs a name, subject or id with an ASCII letter or digit",
    );
  }
  if (!LEADING_LETTER.test(slug)) {
    slug = `a-${slug}`;
  }
  if (slug.length > MAX_SLUG_LENGTH || slug.length < MIN_SLUG_LENGTH) {
    const hash = createHash("sha256").update(source).digest("hex").slice(0, HASH_DIGITS);
    const head = slug.slice(0, MAX_SLUG_LENGTH - HASH_DIGITS - 1).replace(/-+$/, "");
    slug = `${head}-${hash}`;
  }
  return slug;
}
