//go:build e2e
// +build e2e

package e2e

// Environment variable test constants
// Used for testing --env, --secret, --env-file, and --secret-file flags
const (
	// Test environment variable keys and values (non-secrets)
	EnvTestAPIURL      = "API_URL"
	EnvTestAPIURLValue = "https://api.test.stigmer.ai"
	EnvTestDebug       = "DEBUG"
	EnvTestDebugValue  = "true"
	EnvTestLogLevel    = "LOG_LEVEL"
	EnvTestLogLevelVal = "info"

	// Test secret keys and values
	EnvTestDBPassword      = "DB_PASSWORD"
	EnvTestDBPasswordValue = "test_secret_password_123"
	EnvTestAPIKey          = "API_KEY"
	EnvTestAPIKeyValue     = "ghp_test_api_key_abc123"

	// Override values for precedence testing
	EnvTestOverrideValue       = "override_value"
	EnvTestSecretOverrideValue = "secret_override_value"

	// Test fixture paths (in fixtures/ dir, committed to git)
	// Note: testdata/examples/ is auto-generated and git-ignored
	EnvVarTestDataDir    = "testdata/fixtures/env-vars"
	EnvVarTestEnvFile    = "testdata/fixtures/env-vars/test.env"
	EnvVarTestSecretFile = "testdata/fixtures/env-vars/test.env.secret"

	// Execution timeouts for env var tests
	EnvVarExecutionTimeoutSeconds = 60
)
