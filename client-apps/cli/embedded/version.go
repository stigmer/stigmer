package embedded

// Version information
// This will be set at build time via ldflags: -X github.com/stigmer/stigmer/client-apps/cli/embedded.buildVersion=x.y.z
var buildVersion = "dev"

// GetBuildVersion returns the current build version
func GetBuildVersion() string {
	if buildVersion == "" {
		return "dev"
	}
	return buildVersion
}
