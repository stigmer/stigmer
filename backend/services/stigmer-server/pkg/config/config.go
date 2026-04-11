package config

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"

	artifactstorage "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/artifact/storage"
)

// defaultGitHubOAuthClientID and defaultGitHubOAuthClientSecret are the
// credentials for the "Stigmer Local" OAuth App (callback: localhost:3000).
// Hardcoded in source following the same pattern as GitHub CLI (gh):
// a localhost-only OAuth App's client_secret has negligible security value
// since tokens can only be delivered to localhost.
//
// Enterprise/self-hosted users can override via STIGMER_GITHUB_CLIENT_ID
// and STIGMER_GITHUB_CLIENT_SECRET environment variables.
//
// CI release builds may override via ldflags for the Cloud OAuth App:
//
//	-X github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/config.defaultGitHubOAuthClientID=...
//	-X github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/config.defaultGitHubOAuthClientSecret=...
var (
	defaultGitHubOAuthClientID     = "Ov23li4q5kgj90QMr226"
	defaultGitHubOAuthClientSecret = "edc089d10b6cc0dcee898f9680d62d1504e2c89a"
)

// Config holds server configuration
type Config struct {
	GRPCPort    int
	DBPath      string
	StoragePath string // Path for skill artifacts storage
	LogLevel    string
	Env         string

	// Temporal configuration
	TemporalHostPort  string // Default: "localhost:7233"
	TemporalNamespace string // Default: "default"

	// Artifact storage configuration
	ArtifactStorage artifactstorage.Config

	// ArtifactHTTPPort is the port for the HTTP file server that serves local
	// artifact downloads. Only used when ArtifactStorage.Type == "local".
	// Default: GRPCPort + 1 (7235).
	ArtifactHTTPPort int

	// GitHub OAuth configuration for workspace repo selection.
	// Override via STIGMER_GITHUB_CLIENT_ID / STIGMER_GITHUB_CLIENT_SECRET.
	// When empty, the GitHub workspace source is disabled in the UI.
	GitHubOAuthClientID     string
	GitHubOAuthClientSecret string

	// OAuthRedirectURI is the frontend callback URL for MCP OAuth flows.
	// Override via STIGMER_OAUTH_REDIRECT_URI. When empty, OAuth Connect
	// for MCP servers is unavailable.
	OAuthRedirectURI string
}

// LoadConfig loads configuration from environment variables
func LoadConfig() (*Config, error) {
	grpcPort := getEnvInt("GRPC_PORT", 7234)
	artifactHTTPPort := getEnvInt("ARTIFACT_HTTP_PORT", grpcPort+1)

	config := &Config{
		GRPCPort:    grpcPort,
		DBPath:      getEnvString("DB_PATH", defaultDBPath()),
		StoragePath: getEnvString("STORAGE_PATH", defaultStoragePath()),
		LogLevel:    getEnvString("LOG_LEVEL", "info"),
		Env:         getEnvString("ENV", "local"),

		// Temporal configuration
		TemporalHostPort:  getEnvString("TEMPORAL_HOST_PORT", "localhost:7233"),
		TemporalNamespace: getEnvString("TEMPORAL_NAMESPACE", "default"),

		// Artifact HTTP server port (for local artifact downloads)
		ArtifactHTTPPort: artifactHTTPPort,

		// GitHub OAuth configuration
		GitHubOAuthClientID:     getEnvString("STIGMER_GITHUB_CLIENT_ID", defaultGitHubOAuthClientID),
		GitHubOAuthClientSecret: getEnvString("STIGMER_GITHUB_CLIENT_SECRET", defaultGitHubOAuthClientSecret),

		// MCP OAuth redirect URI
		OAuthRedirectURI: getEnvString("STIGMER_OAUTH_REDIRECT_URI", ""),

		// Artifact storage configuration
		ArtifactStorage: artifactstorage.Config{
			Type:          getEnvString("ARTIFACT_STORAGE_TYPE", "local"), // Default to local
			LocalBasePath: getEnvString("ARTIFACT_LOCAL_BASE_PATH", defaultArtifactPath()),
			// Default serve URL uses the artifact HTTP port — no trailing path segment
			// because the storage key already contains the full path (e.g. "artifacts/{exec_id}/{file}").
			LocalServeURL:     getEnvString("ARTIFACT_LOCAL_SERVE_URL", fmt.Sprintf("http://localhost:%d", artifactHTTPPort)),
			R2Bucket:          getEnvString("R2_BUCKET", ""),
			R2Endpoint:        getEnvString("R2_ENDPOINT", ""),
			R2AccessKeyID:     getEnvString("R2_ACCESS_KEY_ID", ""),
			R2SecretAccessKey: getEnvString("R2_SECRET_ACCESS_KEY", ""),
			R2Region:          getEnvString("R2_REGION", "auto"),
		},
	}

	// Ensure database directory exists
	if err := ensureDBDir(config.DBPath); err != nil {
		return nil, fmt.Errorf("failed to ensure database directory: %w", err)
	}

	// Ensure storage directory exists
	if err := ensureStorageDir(config.StoragePath); err != nil {
		return nil, fmt.Errorf("failed to ensure storage directory: %w", err)
	}

	// Ensure artifact storage directory exists (for local mode)
	if config.ArtifactStorage.Type == "local" {
		if err := ensureArtifactDir(config.ArtifactStorage.LocalBasePath); err != nil {
			return nil, fmt.Errorf("failed to ensure artifact directory: %w", err)
		}
	}

	// Validate R2 configuration if R2 storage is enabled
	if config.ArtifactStorage.Type == "r2" {
		if err := validateR2Config(config.ArtifactStorage); err != nil {
			return nil, fmt.Errorf("invalid R2 configuration: %w", err)
		}
	}

	return config, nil
}

// getEnvString gets a string from environment or returns default
func getEnvString(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

// getEnvInt gets an int from environment or returns default
func getEnvInt(key string, defaultValue int) int {
	if value := os.Getenv(key); value != "" {
		if intValue, err := strconv.Atoi(value); err == nil {
			return intValue
		}
	}
	return defaultValue
}

// defaultDBPath returns the default database path (~/.stigmer/stigmer.db)
func defaultDBPath() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return "./stigmer.db"
	}
	return filepath.Join(home, ".stigmer", "stigmer.db")
}

// defaultStoragePath returns the default storage path (~/.stigmer/storage)
func defaultStoragePath() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return "./storage"
	}
	return filepath.Join(home, ".stigmer", "storage")
}

// defaultArtifactPath returns the default artifact storage base path (~/.stigmer/data)
// The storage layer (local_storage.go) creates an "artifacts" subdirectory under this path.
// This path is shared with agent-runner (via volume mount at ~/.stigmer/data/artifacts)
// for attachment storage.
func defaultArtifactPath() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return "./"
	}
	return filepath.Join(home, ".stigmer", "data")
}

// ensureDBDir ensures the database directory exists
func ensureDBDir(dbPath string) error {
	dir := filepath.Dir(dbPath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return err
	}
	return nil
}

// ensureStorageDir ensures the storage directory and subdirectories exist
func ensureStorageDir(storagePath string) error {
	// Create main storage directory
	if err := os.MkdirAll(storagePath, 0755); err != nil {
		return err
	}
	// Create skills subdirectory
	skillsDir := filepath.Join(storagePath, "skills")
	if err := os.MkdirAll(skillsDir, 0755); err != nil {
		return err
	}
	return nil
}

// ensureArtifactDir ensures the artifact storage directory exists
func ensureArtifactDir(artifactPath string) error {
	if err := os.MkdirAll(artifactPath, 0755); err != nil {
		return err
	}
	return nil
}

// validateR2Config validates that all required R2 configuration is present
func validateR2Config(cfg artifactstorage.Config) error {
	if cfg.R2Bucket == "" {
		return fmt.Errorf("R2_BUCKET is required when ARTIFACT_STORAGE_TYPE=r2")
	}
	if cfg.R2Endpoint == "" {
		return fmt.Errorf("R2_ENDPOINT is required when ARTIFACT_STORAGE_TYPE=r2")
	}
	if cfg.R2AccessKeyID == "" {
		return fmt.Errorf("R2_ACCESS_KEY_ID is required when ARTIFACT_STORAGE_TYPE=r2")
	}
	if cfg.R2SecretAccessKey == "" {
		return fmt.Errorf("R2_SECRET_ACCESS_KEY is required when ARTIFACT_STORAGE_TYPE=r2")
	}
	return nil
}
