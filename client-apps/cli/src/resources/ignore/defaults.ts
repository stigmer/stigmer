// Built-in security-first ignore patterns, applied (lowest priority) unless
// disabled. A verbatim port of the Go CLI's DefaultPatterns so `push` excludes
// the same secrets, VCS metadata, and build artifacts on both CLIs.

export const DEFAULT_PATTERNS: readonly string[] = [
  // Version control
  ".git/",
  ".svn/",
  ".hg/",
  ".bzr/",

  // Environment files (often contain secrets)
  ".env",
  ".env.*",
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

  // Package manager auth
  ".npmrc",
  ".pypirc",
  ".gem/credentials",
  ".docker/config.json",

  // IDE and editor
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

  // Operating system
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
];
