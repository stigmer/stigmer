package nodert

const (
	// NodeVersion is the pinned Node.js version shipped with the managed runtime.
	// Node.js 22 is the current Active LTS (supported through April 2027).
	// The Cursor SDK requires Node.js >= 20.
	NodeVersion = "22.22.2"

	// nodeDistBaseURL is the official Node.js distribution download root.
	nodeDistBaseURL = "https://nodejs.org/dist"
)

// nodeChecksums maps Node.js distribution tarball filenames to their expected
// SHA-256 digests. These MUST be updated whenever NodeVersion changes.
//
// Source: https://nodejs.org/download/release/v22.22.2/SHASUMS256.txt
var nodeChecksums = map[string]string{
	"node-v22.22.2-darwin-arm64.tar.gz": "db4b275b83736df67533529a18cc55de2549a8329ace6c7bcc68f8d22d3c9000",
	"node-v22.22.2-darwin-x64.tar.gz":   "12a6abb9c2902cf48a21120da13f87fde1ed1b71a13330712949e8db818708ba",
	"node-v22.22.2-linux-x64.tar.gz":    "978978a635eef872fa68beae09f0aad0bbbae6757e444da80b570964a97e62a3",
	"node-v22.22.2-linux-arm64.tar.gz":  "b2f3a96f31486bfc365192ad65ced14833ad2a3c2e1bcefec4846902f264fa28",
}
