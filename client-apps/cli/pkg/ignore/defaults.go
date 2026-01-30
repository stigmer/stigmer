package ignore

// DefaultPatterns contains the built-in security-first ignore patterns.
// These patterns are always applied unless IncludeDefaults is set to false.
//
// The patterns follow gitignore syntax and are ordered for proper precedence:
// exclusions first, then negations to allow specific exceptions.
//
// Categories:
//   - Version control directories (always exclude)
//   - Security-sensitive files (credentials, secrets, keys)
//   - IDE and editor artifacts
//   - Operating system files
//   - Build artifacts and dependencies
var DefaultPatterns = []string{
	// ==========================================================================
	// VERSION CONTROL - Always exclude repository metadata
	// ==========================================================================
	".git/",
	".svn/",
	".hg/",
	".bzr/",

	// ==========================================================================
	// SECURITY - Credentials and secrets (CRITICAL: Never distribute)
	// ==========================================================================

	// Environment files (often contain secrets)
	".env",
	".env.*",
	// Allow template files that don't contain actual secrets
	"!.env.example",
	"!.env.template",
	"!.env.sample",

	// Private keys and certificates
	"*.pem",
	"*.key",
	"*.p12",
	"*.pfx",
	"*.keystore",
	"*.jks",
	"id_rsa",
	"id_rsa.*",
	"id_ed25519",
	"id_ed25519.*",
	"id_dsa",
	"id_dsa.*",

	// Cloud credentials
	"credentials.json",
	"service-account*.json",
	"gcp-credentials*.json",
	"aws-credentials",
	".aws/credentials",
	".aws/config",

	// Generic secrets
	".secrets",
	".secrets/",
	"*.secret",
	".credentials/",
	"secrets.yaml",
	"secrets.yml",
	"secrets.json",

	// Package manager auth (may contain tokens)
	".npmrc",
	".pypirc",
	".gem/credentials",
	".docker/config.json",

	// ==========================================================================
	// IDE AND EDITOR - Development environment artifacts
	// ==========================================================================
	".idea/",
	".vscode/",
	"*.swp",
	"*.swo",
	"*.swn",
	"*~",
	".project",
	".classpath",
	".settings/",
	"*.sublime-workspace",
	"*.sublime-project",
	".vs/",

	// ==========================================================================
	// OPERATING SYSTEM - OS-specific artifacts
	// ==========================================================================
	".DS_Store",
	".DS_Store?",
	"._*",
	".Spotlight-V100",
	".Trashes",
	"Thumbs.db",
	"Thumbs.db:encryptable",
	"desktop.ini",
	"ehthumbs.db",
	"ehthumbs_vista.db",

	// ==========================================================================
	// BUILD ARTIFACTS - Large, reproducible, or generated files
	// ==========================================================================

	// Node.js
	"node_modules/",
	"npm-debug.log*",
	"yarn-debug.log*",
	"yarn-error.log*",
	".npm/",
	".yarn/cache/",
	".yarn/unplugged/",
	".pnp.*",

	// Python
	"__pycache__/",
	"*.py[cod]",
	"*$py.class",
	".Python",
	"*.so",
	".venv/",
	"venv/",
	"env/",
	"ENV/",
	".pytest_cache/",
	".mypy_cache/",
	".ruff_cache/",
	".tox/",
	".nox/",
	"*.egg-info/",
	".eggs/",
	"dist/",
	"build/",
	"develop-eggs/",
	".installed.cfg",
	"*.manifest",
	"*.spec",
	"pip-log.txt",
	"pip-delete-this-directory.txt",

	// Java/JVM
	"target/",
	"*.class",
	"*.jar",
	"*.war",
	"*.ear",
	".gradle/",
	"gradle-app.setting",
	".gradletasknamecache",

	// Go
	"vendor/",

	// Rust
	"target/",
	"Cargo.lock",

	// Coverage and test reports
	"coverage/",
	".coverage",
	"htmlcov/",
	".nyc_output/",
	"coverage.xml",
	"*.cover",
	".hypothesis/",

	// Logs
	"*.log",
	"logs/",

	// Temporary files
	"tmp/",
	"temp/",
	"*.tmp",
	"*.temp",
	"*.bak",
	"*.backup",
}
