/**
 * The two `npm install` argument lists scripts/verify-consumer-install.mjs
 * runs, built in one place so a test pins both: the consumer install of the
 * packed tarball (registry resolution, `--omit=dev`) and the install of the
 * declared consumer that typechecks against it. `resolution` is what
 * scripts/lib/resolve-before.mjs gives for the command line: the
 * `--before=<cutoff>` a gate passes, or nothing at release. Both lists carry
 * it, so a gate never resolves one install live while the other is held back
 * (stigmer/stigmer#1669).
 *
 * Both lists also carry `--prefer-online`: npm revalidates every document it
 * has cached against the registry, as a consumer installing for the first
 * time, with no cache, reads them fresh. Without it a document npm cached
 * before a release published (or during a failed attempt the release then
 * retries) is served stale for its max-age, and the version the release just
 * published looks missing (stigmer/stigmer#1367). Cached tarballs are kept,
 * so the cost is a conditional request per document. With a gate's `--before`
 * the two combine: revalidate, then apply the cutoff.
 */

const QUIET = ["--no-audit", "--no-fund", "--loglevel=error"];
const FRESH = ["--prefer-online"];

/** `npm install <tarball> --prefix <stagingDir> --omit=dev`, quiet and fresh, with the resolution's arguments. */
export function tarballInstallArgs(tarball, stagingDir, resolution) {
  return ["install", tarball, "--prefix", stagingDir, "--omit=dev", ...QUIET, ...FRESH, ...resolution];
}

/** `npm install` of the consumer package, quiet and fresh, with the resolution's arguments. */
export function consumerInstallArgs(resolution) {
  return ["install", ...QUIET, ...FRESH, ...resolution];
}
