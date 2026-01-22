package embedded

import (
	"fmt"
	"os"
	"path/filepath"
)

// GetSDKVersionForTemplate returns the SDK version string to use in go.mod templates
// based on whether this is a development build or production release
func GetSDKVersionForTemplate() string {
	version := GetBuildVersion()
	
	// Development mode: use @latest to pull latest from GitHub
	// This allows developers to work with the latest SDK without worrying about commits
	if version == "dev" || version == "development" {
		return "latest"
	}
	
	// Production mode: use the same version tag as the CLI
	// Example: CLI v0.1.0 -> SDK v0.1.0
	return version
}

// findStigmerRepo attempts to find the stigmer repository root
// Returns the path to the repo if found, empty string otherwise
func findStigmerRepo() string {
	// Get home directory
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	
	// Check common locations from home directory
	possiblePaths := []string{
		filepath.Join(homeDir, "scm/github.com/stigmer/stigmer"),
		filepath.Join(homeDir, "code/stigmer/stigmer"),
		filepath.Join(homeDir, "projects/stigmer/stigmer"),
		filepath.Join(homeDir, "workspace/stigmer/stigmer"),
		filepath.Join(homeDir, "dev/stigmer/stigmer"),
		filepath.Join(homeDir, "stigmer/stigmer"),
		filepath.Join(homeDir, "go/src/github.com/stigmer/stigmer"),
	}
	
	for _, repoPath := range possiblePaths {
		// Check if this looks like the stigmer repo (has sdk/go and apis/stubs/go)
		sdkPath := filepath.Join(repoPath, "sdk", "go")
		apisPath := filepath.Join(repoPath, "apis", "stubs", "go")
		
		if _, err := os.Stat(sdkPath); err == nil {
			if _, err := os.Stat(apisPath); err == nil {
				return repoPath
			}
		}
	}
	
	return ""
}

// GenerateGoModContent generates the go.mod file content with proper SDK version
func GenerateGoModContent(projectName string) string {
	moduleName := projectName // Use project name as module name
	sdkVersion := GetSDKVersionForTemplate()
	
	if sdkVersion == "latest" {
		// Development mode: Try to use local stigmer repo if available
		stigmerRepo := findStigmerRepo()
		
		if stigmerRepo != "" {
			// Use local replace directives pointing to the stigmer monorepo
			sdkPath := filepath.Join(stigmerRepo, "sdk", "go")
			apisPath := filepath.Join(stigmerRepo, "apis", "stubs", "go")
			
			return fmt.Sprintf(`module %s

go 1.24

require (
	github.com/stigmer/stigmer/sdk/go v0.0.0-00010101000000-000000000000
)

// Development mode: Using local stigmer repository
// This ensures you're using the latest local changes
replace github.com/stigmer/stigmer/sdk/go => %s

replace github.com/stigmer/stigmer/apis/stubs/go => %s
`, moduleName, sdkPath, apisPath)
		}
		
		// Fallback: use @latest (pulls from GitHub main)
		return fmt.Sprintf(`module %s

go 1.24

require (
	github.com/stigmer/stigmer/sdk/go latest
)
`, moduleName)
	}
	
	// Production mode: use specific version tag
	return fmt.Sprintf(`module %s

go 1.24

require (
	github.com/stigmer/stigmer/sdk/go %s
)
`, moduleName, sdkVersion)
}
