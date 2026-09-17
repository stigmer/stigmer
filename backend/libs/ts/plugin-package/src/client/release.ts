/**
 * Whether a version string names a release the lockstep publish covers.
 *
 * The official catalogue (`@stigmer/plugins`) and the runtime packages are
 * published at every release version and at every pre-release the release
 * lane cuts (`X.Y.Z-rc.1` under the `next` tag), never for a source build
 * (`dev`, `0.0.0-dev`) or a dev-channel stamp (`X.Y.Z-dev.<stamp>`). Two
 * clients used to answer this with two different tests: the console
 * accepted only `X.Y.Z` and called an `rc` server a development build; the
 * CLI accepted anything without `-dev` and would have tried to acquire
 * packages for the bare `dev` an unbundled server reports. One predicate,
 * five cases pinned, no third opinion.
 */

/**
 * A semver core, optionally followed by a pre-release whose first
 * identifier is not `dev`. Build metadata (`+…`) is not accepted: nothing
 * publishes with it.
 */
const RELEASE_PATTERN = /^\d+\.\d+\.\d+(?:-(?!dev(?:[.-]|$))[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

/** True for `3.17.0` and `3.17.0-rc.1`; false for `dev`, `0.0.0-dev` and `3.17.0-dev.20260918120000`. */
export function isReleaseVersion(version: string): boolean {
  return RELEASE_PATTERN.test(version);
}
