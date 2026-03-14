// Package webconsole provides access to the pre-built web console static
// assets as an io/fs.FS.
//
// The assets are resolved at init time via one of two mechanisms:
//
//   - Production (build tag embed_webconsole): Static files from the Next.js
//     export (out/) are embedded in the binary via //go:embed. The CLI binary
//     is self-contained and can serve the web console without external files.
//
//   - Development (default): No assets are available. The daemon skips
//     starting the web console HTTP server and logs that the web console
//     is not embedded.
package webconsole

import "io/fs"

// assetsFS is populated at init time by the build-tagged embed file.
var assetsFS fs.FS

// FS returns the web console static assets as a read-only filesystem.
// Returns nil when assets are not embedded (built without embed_webconsole tag).
func FS() fs.FS {
	return assetsFS
}

// IsAvailable reports whether the web console assets are embedded in the binary.
func IsAvailable() bool {
	return assetsFS != nil
}
