package embedded

import (
	_ "embed"
	"fmt"
	"runtime"
)

// Embedded binaries for different platforms
// Note: Actual binaries will be placed in binaries/ directory at build time

// Darwin ARM64 (Apple Silicon)
//
//go:embed binaries/darwin_arm64/stigmer-server
var stigmerServerDarwinARM64 []byte

//go:embed binaries/darwin_arm64/workflow-runner
var workflowRunnerDarwinARM64 []byte

// Darwin AMD64 (Intel Mac)
//
//go:embed binaries/darwin_amd64/stigmer-server
var stigmerServerDarwinAMD64 []byte

//go:embed binaries/darwin_amd64/workflow-runner
var workflowRunnerDarwinAMD64 []byte

// Linux AMD64
//
//go:embed binaries/linux_amd64/stigmer-server
var stigmerServerLinuxAMD64 []byte

//go:embed binaries/linux_amd64/workflow-runner
var workflowRunnerLinuxAMD64 []byte

// Agent Runner (platform-independent, but venv is platform-specific)
// We'll embed all platform versions as separate tarballs
//
//go:embed binaries/darwin_arm64/agent-runner.tar.gz
var agentRunnerDarwinARM64 []byte

//go:embed binaries/darwin_amd64/agent-runner.tar.gz
var agentRunnerDarwinAMD64 []byte

//go:embed binaries/linux_amd64/agent-runner.tar.gz
var agentRunnerLinuxAMD64 []byte

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

// GetStigmerServerBinary returns the embedded stigmer-server binary for the current platform
func GetStigmerServerBinary() ([]byte, error) {
	platform := CurrentPlatform()
	
	if !platform.IsSupported() {
		return nil, fmt.Errorf("unsupported platform: %s/%s\n\nStigmer CLI supports:\n  - macOS arm64 (Apple Silicon)\n  - macOS amd64 (Intel)\n  - Linux amd64\n\nYour platform: %s/%s\n\nPlease open an issue if you need support for this platform:\n  https://github.com/stigmer/stigmer/issues",
			platform.OS, platform.Arch, platform.OS, platform.Arch)
	}

	switch platform.String() {
	case "darwin_arm64":
		return stigmerServerDarwinARM64, nil
	case "darwin_amd64":
		return stigmerServerDarwinAMD64, nil
	case "linux_amd64":
		return stigmerServerLinuxAMD64, nil
	default:
		// Should never reach here due to IsSupported check
		return nil, fmt.Errorf("unsupported platform: %s", platform.String())
	}
}

// GetWorkflowRunnerBinary returns the embedded workflow-runner binary for the current platform
func GetWorkflowRunnerBinary() ([]byte, error) {
	platform := CurrentPlatform()
	
	if !platform.IsSupported() {
		return nil, fmt.Errorf("unsupported platform: %s/%s", platform.OS, platform.Arch)
	}

	switch platform.String() {
	case "darwin_arm64":
		return workflowRunnerDarwinARM64, nil
	case "darwin_amd64":
		return workflowRunnerDarwinAMD64, nil
	case "linux_amd64":
		return workflowRunnerLinuxAMD64, nil
	default:
		return nil, fmt.Errorf("unsupported platform: %s", platform.String())
	}
}

// GetAgentRunnerTarball returns the embedded agent-runner tarball for the current platform
func GetAgentRunnerTarball() ([]byte, error) {
	platform := CurrentPlatform()
	
	if !platform.IsSupported() {
		return nil, fmt.Errorf("unsupported platform: %s/%s", platform.OS, platform.Arch)
	}

	switch platform.String() {
	case "darwin_arm64":
		return agentRunnerDarwinARM64, nil
	case "darwin_amd64":
		return agentRunnerDarwinAMD64, nil
	case "linux_amd64":
		return agentRunnerLinuxAMD64, nil
	default:
		return nil, fmt.Errorf("unsupported platform: %s", platform.String())
	}
}
