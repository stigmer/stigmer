package config

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	artifactstorage "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/artifact/storage"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/encryption/payloadcodec"
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

	// SkillTransferBaseURL is the externally-reachable base of the skill
	// artifact transfer lane (#675) — the URL prefix minted into
	// createArtifactUploadUrl / getArtifactDownloadUrl responses. The lane
	// itself is served on the main gRPC port's HTTP handler, so the default
	// points there; operators serving remote clients override it via
	// SKILL_TRANSFER_BASE_URL (the ARTIFACT_LOCAL_SERVE_URL idiom).
	SkillTransferBaseURL string

	// GitHub OAuth configuration for workspace repo selection.
	// Override via STIGMER_GITHUB_CLIENT_ID / STIGMER_GITHUB_CLIENT_SECRET.
	// When empty, the GitHub workspace source is disabled in the UI.
	GitHubOAuthClientID     string
	GitHubOAuthClientSecret string

	// OAuthRedirectURI is the frontend callback URL for MCP OAuth flows.
	// Override via STIGMER_OAUTH_REDIRECT_URI. When empty, OAuth Connect
	// for MCP servers is unavailable.
	OAuthRedirectURI string

	// PayloadEncryption holds the Temporal payload-decryption keys
	// (STIGMER_PAYLOAD_ENCRYPTION_KEY(_ID) + optional secondary pair —
	// the same env vars the TS runner reads). Nil when encryption is not
	// configured; the decode-only codec is then not installed.
	PayloadEncryption *payloadcodec.Config

	// OperatorEmail / OperatorName hold the deployment's configured operator
	// identity (STIGMER_OPERATOR_EMAIL / STIGMER_OPERATOR_NAME —
	// stigmer/stigmer#400). When set, every audit actor this server stamps
	// (created_by / updated_by) carries it, which is what lets MCP servers
	// see a real, grantable `stigmer_user/<email>` caller identity from a
	// self-hosted install. When unset, the historical "system" placeholder
	// stays, and the runner presents the anonymous identity — the documented
	// deny-by-default for unconfigured self-hosted backends.
	OperatorEmail string
	OperatorName  string
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

		// Skill artifact transfer lane (served on the main port's HTTP handler)
		SkillTransferBaseURL: getEnvString("SKILL_TRANSFER_BASE_URL", fmt.Sprintf("http://localhost:%d", grpcPort)),

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

	// A present-but-malformed payload encryption key fails the boot:
	// the operator intended runner history to be encrypted, and without
	// the decode codec every runner payload read would fail at runtime.
	payloadEncryption, err := payloadcodec.LoadConfigFromEnv()
	if err != nil {
		return nil, err
	}
	config.PayloadEncryption = payloadEncryption

	// Same fail-loud posture for the operator identity: a present-but-
	// malformed email fails the boot rather than silently stamping a typo —
	// audit actors feed MCP caller-identity bindings, so a typo would mint a
	// wrong grantable value that no one intended to grant.
	operatorEmail, operatorName, err := loadOperatorIdentity()
	if err != nil {
		return nil, err
	}
	config.OperatorEmail = operatorEmail
	config.OperatorName = operatorName

	return config, nil
}

// loadOperatorIdentity reads the configured operator identity
// (stigmer/stigmer#400). Only a minimal shape check is applied — an email
// without an '@' can never be a deliverable address, so it is certainly a
// typo; anything beyond that is the operator's own naming to get right.
func loadOperatorIdentity() (email string, name string, err error) {
	email = strings.TrimSpace(os.Getenv("STIGMER_OPERATOR_EMAIL"))
	name = strings.TrimSpace(os.Getenv("STIGMER_OPERATOR_NAME"))
	if email != "" && !strings.Contains(email, "@") {
		return "", "", fmt.Errorf(
			"STIGMER_OPERATOR_EMAIL %q is not an email address (missing '@') — fix or unset it", email)
	}
	if email == "" && name != "" {
		return "", "", fmt.Errorf(
			"STIGMER_OPERATOR_NAME is set but STIGMER_OPERATOR_EMAIL is not — the email is the identity; set both or neither")
	}
	return email, name, nil
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

// defaultArtifactPath returns the default artifact storage root
// (~/.stigmer/data/artifacts). This path IS the artifact root — the storage
// layer (local_storage.go) stores a key K directly at <root>/K, with no implicit
// "artifacts" segment. It is the exact directory the agent-runner reads via
// LOCAL_ARTIFACT_PATH, so the two processes share one store by construction
// (see stigmer/stigmer#285).
func defaultArtifactPath() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return "./artifacts"
	}
	return filepath.Join(home, ".stigmer", "data", "artifacts")
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
