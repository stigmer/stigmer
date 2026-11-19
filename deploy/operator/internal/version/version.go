// The Stigmer version this operator runs, stamped at build time.
//
// One version line: operator vX runs Stigmer vX, so the server, runner and
// Enterprise images are pulled at exactly this tag. A release build stamps
// the release (`-ldflags -X ...version.Stigmer=v0.3.0`); a source build
// stamps compose-dev, the tag the install tests load into kind. An unstamped
// binary reports "dev" and would pull a tag that does not exist, which the
// image-pull reason then says in words.

package version

// Stigmer is the version, and the image tag, this operator runs.
var Stigmer = "dev"
