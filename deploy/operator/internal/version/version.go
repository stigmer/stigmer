// The Stigmer version this operator runs, stamped at build time.
//
// One version line: operator vX runs Stigmer vX, so the server, runner and
// Enterprise images are pulled at exactly this tag. A release build stamps
// the release (`-ldflags -X ...version.Stigmer=v0.3.0`); a source build
// stamps compose-dev, the tag the install tests load into kind. An unstamped
// binary reports "dev" and would pull a tag that does not exist, which the
// image-pull reason then says in words. The release lane stamps the
// published per-session runner's digest the same way.

package version

// Stigmer is the version, and the image tag, this operator runs.
var Stigmer = "dev"

// SandboxRunnerDigest is the digest (sha256:...) of the per-session runner
// image published at Stigmer, stamped beside it. A sandbox is pinned to it,
// so every session of one version runs the same bytes on any node and a
// mirror serves the same image. Empty in a build that was not given one: a
// sandbox then pulls the image by its tag.
var SandboxRunnerDigest = ""
