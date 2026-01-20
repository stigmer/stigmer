package embedded

import (
	"fmt"
	"runtime"
)

// Platform represents a supported OS/architecture combination
type Platform struct {
	OS   string
	Arch string
}

// CurrentPlatform returns the current runtime platform
func CurrentPlatform() Platform {
	return Platform{
		OS:   runtime.GOOS,
		Arch: runtime.GOARCH,
	}
}

// String returns the platform as a string (e.g., "darwin_arm64")
func (p Platform) String() string {
	return fmt.Sprintf("%s_%s", p.OS, p.Arch)
}

// IsSupported returns true if the platform is supported
func (p Platform) IsSupported() bool {
	switch p.String() {
	case "darwin_arm64", "darwin_amd64", "linux_amd64":
		return true
	default:
		return false
	}
}

// Platform-specific implementations are in:
// - embedded_darwin_arm64.go (for macOS Apple Silicon)
// - embedded_darwin_amd64.go (for macOS Intel)
// - embedded_linux_amd64.go (for Linux AMD64)
//
// Each file provides:
// - GetStigmerServerBinary() ([]byte, error)
// - GetWorkflowRunnerBinary() ([]byte, error)
// - GetAgentRunnerTarball() ([]byte, error)
