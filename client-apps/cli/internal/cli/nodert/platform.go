package nodert

import (
	"fmt"
	"runtime"
)

// Platform represents a target OS/architecture for the Node.js runtime.
type Platform struct {
	OS   string
	Arch string
}

// DetectPlatform returns the Platform for the current runtime environment.
func DetectPlatform() Platform {
	return Platform{OS: runtime.GOOS, Arch: runtime.GOARCH}
}

// String returns the canonical platform identifier (e.g., "darwin-arm64").
func (p Platform) String() string {
	return p.OS + "-" + p.Arch
}

// IsSupported reports whether an official Node.js distribution is available
// for this platform.
func (p Platform) IsSupported() bool {
	_, ok := nodeArchMap[p.String()]
	return ok
}

// nodeArch returns the Node.js distribution architecture name.
// Go uses "amd64" but Node.js uses "x64".
func (p Platform) nodeArch() (string, error) {
	arch, ok := nodeArchMap[p.String()]
	if !ok {
		return "", fmt.Errorf("unsupported platform for Node.js: %s", p)
	}
	return arch, nil
}

// TarballName returns the filename of the Node.js distribution tarball.
func (p Platform) TarballName() (string, error) {
	arch, err := p.nodeArch()
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("node-v%s-%s-%s.tar.gz", NodeVersion, p.OS, arch), nil
}

// DownloadURL returns the full nodejs.org download URL for the tarball.
func (p Platform) DownloadURL() (string, error) {
	name, err := p.TarballName()
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%s/v%s/%s", nodeDistBaseURL, NodeVersion, name), nil
}

// StripPrefix returns the top-level directory name inside the tarball.
// Node.js tarballs extract into a directory named like
// "node-v22.22.2-darwin-arm64/".
func (p Platform) StripPrefix() (string, error) {
	arch, err := p.nodeArch()
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("node-v%s-%s-%s", NodeVersion, p.OS, arch), nil
}

// nodeArchMap maps canonical Go platform identifiers to Node.js distribution
// architecture names. Only platforms with official pre-built binaries are listed.
var nodeArchMap = map[string]string{
	"darwin-arm64": "arm64",
	"darwin-amd64": "x64",
	"linux-amd64":  "x64",
	"linux-arm64":  "arm64",
}
