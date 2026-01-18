package workflow

import (
	"fmt"
	"regexp"
)

// RuntimeSecret returns a placeholder reference to a runtime secret.
// The actual value is provided at execution time via CLI --runtime-env flag.
//
// **CRITICAL SECURITY PATTERN:**
// Unlike ctx.SetSecret() which resolves at synthesis time (embedding secrets in manifests),
// RuntimeSecret() generates a placeholder that is resolved just-in-time during activity execution.
// This ensures secrets NEVER appear in Temporal history.
//
// Example:
//
//	wf.HttpPost("callAPI", endpoint,
//	    workflow.Header("Authorization", workflow.RuntimeSecret("OPENAI_KEY")),
//	)
//	// Manifest contains: "Authorization": "${.secrets.OPENAI_KEY}"
//	// CLI execution: stigmer run my-workflow --runtime-env secret:OPENAI_KEY=sk-12345
//	// Activity resolves: "Authorization": "sk-12345" (JIT, in-memory only)
//
// **Why use RuntimeSecret instead of ctx.SetSecret?**
//
// ctx.SetSecret():
//   - ❌ Resolves at synthesis time
//   - ❌ Secret value baked into manifest
//   - ❌ Visible in Temporal history
//   - ✅ Simple for non-sensitive config
//
// RuntimeSecret():
//   - ✅ Placeholder in manifest
//   - ✅ Resolved JIT in activity
//   - ✅ NEVER appears in Temporal history
//   - ✅ Secure for API keys, tokens, passwords
//
// **Common use cases:**
//   - API keys (OpenAI, Stripe, AWS credentials)
//   - Authentication tokens
//   - Database passwords
//   - OAuth secrets
//   - Webhook signing keys
func RuntimeSecret(keyName string) string {
	return fmt.Sprintf("${.secrets.%s}", keyName)
}

// RuntimeEnv returns a placeholder reference to a runtime environment variable.
// The actual value is provided at execution time via CLI --runtime-env flag.
//
// This is for non-secret runtime configuration that varies by environment
// (dev/staging/prod) or execution context.
//
// Example:
//
//	wf.HttpGet("fetchData",
//	    workflow.Interpolate(
//	        "https://api-",
//	        workflow.RuntimeEnv("ENVIRONMENT"),
//	        ".example.com/data",
//	    ),
//	)
//	// Manifest contains: "https://api-${.env_vars.ENVIRONMENT}.example.com/data"
//	// CLI execution: stigmer run my-workflow --runtime-env ENVIRONMENT=staging
//	// Activity resolves: "https://api-staging.example.com/data"
//
// **Why use RuntimeEnv instead of ctx.SetString?**
//
// ctx.SetString():
//   - ❌ Resolves at synthesis time
//   - ❌ Value hardcoded in manifest
//   - ✅ Good for static config
//
// RuntimeEnv():
//   - ✅ Placeholder in manifest
//   - ✅ Resolved JIT at execution
//   - ✅ Same manifest works across environments
//   - ✅ Dynamic configuration
//
// **Common use cases:**
//   - Environment names (dev, staging, prod)
//   - Region configuration (us-east-1, eu-west-1)
//   - Feature flags
//   - API endpoints that vary by environment
//   - Tenant identifiers in multi-tenant systems
func RuntimeEnv(varName string) string {
	return fmt.Sprintf("${.env_vars.%s}", varName)
}

// ValidateRuntimeRef validates that a runtime reference has the correct format.
// This is used internally during synthesis to catch malformed references early.
//
// Valid formats:
//   - ${.secrets.KEY_NAME}  (uppercase, underscores allowed)
//   - ${.env_vars.VAR_NAME} (uppercase, underscores allowed)
//
// Invalid formats:
//   - ${secrets.KEY}        (missing leading dot)
//   - ${.secrets.keyName}   (lowercase not allowed)
//   - ${.secrets.KEY-NAME}  (hyphens not allowed)
//   - ${.other.KEY}         (only secrets and env_vars supported)
//
// Example:
//
//	// Internal usage in synthesizer
//	if err := workflow.ValidateRuntimeRef("${.secrets.OPENAI_KEY}"); err != nil {
//	    return fmt.Errorf("invalid runtime reference: %w", err)
//	}
func ValidateRuntimeRef(ref string) error {
	// Pattern: ${.secrets.KEY} or ${.env_vars.VAR}
	// Key/Var names must be UPPERCASE with underscores
	pattern := regexp.MustCompile(`^\$\{\.(?:secrets|env_vars)\.[A-Z_][A-Z0-9_]*\}$`)
	if !pattern.MatchString(ref) {
		return fmt.Errorf("invalid runtime reference format: %s (expected ${.secrets.KEY} or ${.env_vars.VAR})", ref)
	}
	return nil
}

// IsRuntimeRef checks if a string is a runtime placeholder reference.
// This is used internally to distinguish between static values and runtime placeholders.
//
// Example:
//
//	workflow.IsRuntimeRef("${.secrets.API_KEY}")  // true
//	workflow.IsRuntimeRef("${.env_vars.REGION}") // true
//	workflow.IsRuntimeRef("https://api.example.com") // false
//	workflow.IsRuntimeRef("${ $context.apiURL }") // false
func IsRuntimeRef(s string) bool {
	pattern := regexp.MustCompile(`^\$\{\.(?:secrets|env_vars)\.[A-Z_][A-Z0-9_]*\}$`)
	return pattern.MatchString(s)
}

// ExtractRuntimeRefs extracts all runtime references from a string.
// This is used internally to analyze task configurations and track which
// runtime values need to be provided at execution time.
//
// Example:
//
//	s := "Bearer ${.secrets.TOKEN} for ${.env_vars.ENVIRONMENT}"
//	refs := workflow.ExtractRuntimeRefs(s)
//	// refs = ["${.secrets.TOKEN}", "${.env_vars.ENVIRONMENT}"]
func ExtractRuntimeRefs(s string) []string {
	pattern := regexp.MustCompile(`\$\{\.(?:secrets|env_vars)\.[A-Z_][A-Z0-9_]*\}`)
	return pattern.FindAllString(s, -1)
}
