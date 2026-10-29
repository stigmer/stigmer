/**
 * Tells a consumer install that failed because npm does not serve a pinned
 * @stigmer/* version YET apart from one that failed for any other reason,
 * and names the exit code that carries the answer from
 * scripts/verify-consumer-install.mjs to scripts/publish-standalone.mjs.
 *
 * A release publishes its libs and then installs a package pinned to them.
 * npm can accept a version and still answer an install of it with "no such
 * version" for minutes: ETARGET when the document the install resolves
 * against does not list it yet (v3.38.0, and the dev lane, stigmer#1367), or
 * E404 when its tarball or its whole document is not served yet (v3.33.0,
 * stigmer#1325). For a version this release just published, those answers
 * mean "not yet", and the release script retries the install within the
 * registry wait's deadline. Any other failure, or the same answer about a
 * package the release does not pin, is a real break and fails at once.
 *
 * The smoke owns its installs, so it classifies its own failure and reports
 * the answer as an exit code: one number is the whole contract between the
 * two scripts, and `npm run` hands a script's exit code back unchanged.
 */

/** The smoke's exit code for "npm does not serve a pinned version yet": EX_TEMPFAIL. */
export const REGISTRY_LAG_EXIT = 75;

const NAME_CHAR = /[A-Za-z0-9._-]/;

/** Whether `text` mentions `name` as a whole package name, not as the prefix of a longer one. */
function mentions(text, name) {
  for (let at = text.indexOf(name); at !== -1; at = text.indexOf(name, at + 1)) {
    const next = text[at + name.length];
    if (next === undefined || !NAME_CHAR.test(next)) return true;
  }
  return false;
}

/**
 * The pinned package an install's stderr says npm does not serve yet, or
 * `null` when the failure is anything else. `names` are the @stigmer/*
 * packages the release pinned to registry versions; with none, nothing is
 * lag. ETARGET names the package in its "No matching version found for
 * <name>@<version>" line; E404 names it in the request URL, with the
 * scope's slash kept for a tarball and encoded as `%2f` (either case) for
 * a document.
 */
export function registryLag(stderr, names) {
  const etarget = /\bcode ETARGET\b/.test(stderr);
  const e404 = /\bcode E404\b/.test(stderr);
  if (!etarget && !e404) return null;
  const lines = stderr
    .split("\n")
    .filter((line) => (etarget ? /No matching version found for /.test(line) : /\b404\b/.test(line)));
  for (const name of names) {
    const spellings = [name, name.replace("/", "%2f"), name.replace("/", "%2F")];
    if (lines.some((line) => spellings.some((spelling) => mentions(line, spelling)))) {
      return name;
    }
  }
  return null;
}
