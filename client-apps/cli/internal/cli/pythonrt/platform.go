package pythonrt

import (
	"fmt"
	"runtime"
)

// Platform represents a target OS/architecture for the Python runtime.
// Uses hyphen-separated identifiers (e.g., "darwin-arm64") per DD-01.
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

// IsSupported reports whether python-build-standalone provides a distribution
// for this platform.
func (p Platform) IsSupported() bool {
	_, ok := pbsTriples[p.String()]
	return ok
}

// PBSTriple returns the python-build-standalone platform triple
// (e.g., "aarch64-apple-darwin"). Returns an error for unsupported platforms.
func (p Platform) PBSTriple() (string, error) {
	triple, ok := pbsTriples[p.String()]
	if !ok {
		return "", fmt.Errorf("unsupported platform for python-build-standalone: %s", p)
	}
	return triple, nil
}

// TarballName returns the filename of the PBS install_only tarball.
func (p Platform) TarballName() (string, error) {
	triple, err := p.PBSTriple()
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("cpython-%s+%s-%s-install_only.tar.gz", PythonVersion, PBSTag, triple), nil
}

// DownloadURL returns the full GitHub releases URL for the PBS tarball.
func (p Platform) DownloadURL() (string, error) {
	name, err := p.TarballName()
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%s/%s/%s", pbsBaseURL, PBSTag, name), nil
}

// pbsTriples maps canonical platform identifiers to python-build-standalone
// OS triples. Only glibc-based Linux builds are listed — musl builds are
// incompatible with many native extension wheels (grpcio, temporalio).
var pbsTriples = map[string]string{
	"darwin-arm64": "aarch64-apple-darwin",
	"darwin-amd64": "x86_64-apple-darwin",
	"linux-amd64":  "x86_64-unknown-linux-gnu",
	"linux-arm64":  "aarch64-unknown-linux-gnu",
}
