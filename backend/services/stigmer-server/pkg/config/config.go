package config

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"
)

// Config holds server configuration
type Config struct {
	GRPCPort int
	DBPath   string
	LogLevel string
	Env      string

	// Temporal configuration
	TemporalHostPort  string // Default: "localhost:7233"
	TemporalNamespace string // Default: "default"
}

// LoadConfig loads configuration from environment variables
func LoadConfig() (*Config, error) {
	config := &Config{
		GRPCPort: getEnvInt("GRPC_PORT", 7234), // Port 7234 (Temporal + 1)
		DBPath:   getEnvString("DB_PATH", defaultDBPath()),
		LogLevel: getEnvString("LOG_LEVEL", "info"),
		Env:      getEnvString("ENV", "local"),

		// Temporal configuration
		TemporalHostPort:  getEnvString("TEMPORAL_HOST_PORT", "localhost:7233"),
		TemporalNamespace: getEnvString("TEMPORAL_NAMESPACE", "default"),
	}

	// Ensure database directory exists
	if err := ensureDBDir(config.DBPath); err != nil {
		return nil, fmt.Errorf("failed to ensure database directory: %w", err)
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

// ensureDBDir ensures the database directory exists
func ensureDBDir(dbPath string) error {
	dir := filepath.Dir(dbPath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return err
	}
	return nil
}
