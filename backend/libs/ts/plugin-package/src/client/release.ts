/**
 * Whether a version string names a release the lockstep publish covers.
 *
 * The official catalogue (`@stigmer/plugins`) and the runtime packages are
 * published at every release version and at every pre-release the release
 * lane cuts (`X.Y.Z-rc.1` under the `next` tag), never for a source build
 * (`dev`, `0.0.0-dev`), a dev-channel stamp (`X.Y.Z-dev.<stamp>`) or a
 * local build (`0.0.0-local.<stamp>`, scripts/stage-server-library.mjs). Every
 * client asks this one predicate, its cases pinned, so an `rc` server is
 * never called a development build and the bare `dev` an unbundled server
 * reports never sends a client to acquire packages. The server reads it
 * too: a release server's sandbox drivers hold the runner layer to that
 * release, so a local build read as one would refuse every layer that
 * named a real release (stigmer/stigmer#1867).
 */

/**
 * A semver core, optionally followed by a pre-release whose first
 * identifier is neither `dev` nor `local`. Build metadata (`+…`) is not
 * accepted: nothing publishes with it.
 */
const RELEASE_PATTERN = /^\d+\.\d+\.\d+(?:-(?!(?:dev|local)(?:[.-]|$))[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

/** True for `3.17.0` and `3.17.0-rc.1`; false for `dev`, `0.0.0-dev`, `3.17.0-dev.20260918120000` and `0.0.0-local.20261004150608`. */
export function isReleaseVersion(version: string): boolean {
  return RELEASE_PATTERN.test(version);
}
