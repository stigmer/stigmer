/**
 * The two `npm install` argument lists scripts/verify-consumer-install.mjs
 * runs, built in one place so a test pins both: the consumer install of the
 * packed tarball (registry resolution, `--omit=dev`) and the install of the
 * declared consumer that typechecks against it. `resolution` is what
 * scripts/lib/resolve-before.mjs gives for the command line: the
 * `--before=<cutoff>` a gate passes, or nothing at release. Both lists carry
 * it, so a gate never resolves one install live while the other is held back
 * (stigmer/stigmer#1669).
 */

const QUIET = ["--no-audit", "--no-fund", "--loglevel=error"];

/** `npm install <tarball> --prefix <stagingDir> --omit=dev`, quiet, with the resolution's arguments. */
export function tarballInstallArgs(tarball, stagingDir, resolution) {
  return ["install", tarball, "--prefix", stagingDir, "--omit=dev", ...QUIET, ...resolution];
}

/** `npm install` of the consumer package, quiet, with the resolution's arguments. */
export function consumerInstallArgs(resolution) {
  return ["install", ...QUIET, ...resolution];
}
