package config

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"

	artifactstorage "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/artifact/storage"
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
}

// LoadConfig loads configuration from environment variables
func LoadConfig() (*Config, error) {
	config := &Config{
		GRPCPort:    getEnvInt("GRPC_PORT", 7234), // Port 7234 (Temporal + 1)
		DBPath:      getEnvString("DB_PATH", defaultDBPath()),
		StoragePath: getEnvString("STORAGE_PATH", defaultStoragePath()),
		LogLevel:    getEnvString("LOG_LEVEL", "info"),
		Env:         getEnvString("ENV", "local"),

		// Temporal configuration
		TemporalHostPort:  getEnvString("TEMPORAL_HOST_PORT", "localhost:7233"),
		TemporalNamespace: getEnvString("TEMPORAL_NAMESPACE", "default"),

		// Artifact storage configuration
		ArtifactStorage: artifactstorage.Config{
			Type:              getEnvString("ARTIFACT_STORAGE_TYPE", "local"), // Default to local
			LocalBasePath:     getEnvString("ARTIFACT_LOCAL_BASE_PATH", defaultArtifactPath()),
			LocalServeURL:     getEnvString("ARTIFACT_LOCAL_SERVE_URL", "http://localhost:8080/artifacts"),
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
