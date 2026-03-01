package pythonrt

const (
	// PythonVersion is the pinned CPython version shipped with the runtime.
	PythonVersion = "3.11.14"

	// PBSTag is the pinned python-build-standalone release tag.
	PBSTag = "20260211"

	// pbsBaseURL is the GitHub releases download root for python-build-standalone.
	pbsBaseURL = "https://github.com/astral-sh/python-build-standalone/releases/download"
)

// pbsChecksums maps python-build-standalone platform triples to the expected
// SHA-256 digest of the corresponding install_only tarball. These MUST be
// updated whenever PythonVersion or PBSTag changes.
var pbsChecksums = map[string]string{
	"aarch64-apple-darwin":      "508e8cbf83f542cd94b77b6604ceef4bb008c4aefc13fb6fdfae9a7a80e36faf",
	"x86_64-apple-darwin":       "efe5a725af211bccaf3c1cc5916186e875b287a2a1dba056a1963e9eebd6e8c6",
	"x86_64-unknown-linux-gnu":  "fbb8a67888f58d876df8bf524c822f2457fd7503ecec03b5fd68a778aa65c8c9",
	"aarch64-unknown-linux-gnu": "83a62eabd4d7732a9dada97496db4b974b939721603f26918586d0dfc8f22593",
}
