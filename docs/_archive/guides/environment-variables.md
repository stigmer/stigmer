# Environment Variables and Secrets

Complete guide to managing environment variables and secrets in Stigmer agents and workflows.

## Overview

Environment variables provide configuration and secrets to your agents and workflows at runtime. Stigmer offers a Pulumi-inspired approach with:

- **Explicit secret declaration** - Secrets are explicitly marked via flags, not inferred from values
- **Multiple sources** - Combine inline flags and files with clear precedence rules
- **Encryption at rest** - Secrets are encrypted using AES-256-GCM before storage
- **Runtime resolution** - Variables available during agent/workflow execution
- **MCP server integration** - Resolve placeholders in MCP server configurations

## Quick Start

### Inline Environment Variables

```bash
# Single variable
stigmer run my-agent --env "REGION=us-east-1"

# Multiple variables
stigmer run my-agent \
  --env "REGION=us-east-1" \
  --env "ENVIRONMENT=production" \
  --env "LOG_LEVEL=debug"
```

### Inline Secrets

```bash
# Single secret (encrypted at rest)
stigmer run my-agent --secret "API_KEY=sk_prod_abc123"

# Multiple secrets
stigmer run my-agent \
  --secret "DB_PASSWORD=supersecret" \
  --secret "API_KEY=sk_prod_abc123" \
  --secret "GITHUB_TOKEN=ghp_xxxxxxxxxxxx"
```

### Load from Files

```bash
# Environment variables from .env file
stigmer run my-agent --env-file .env

# Secrets from .env.secret file
stigmer run my-agent --secret-file .env.secret

# Combine both
stigmer run my-agent \
  --env-file .env \
  --secret-file .env.secret
```

### Combine All Sources

```bash
# Files provide defaults, flags override
stigmer run my-agent \
  --env-file .env \
  --secret-file .env.secret \
  --env "REGION=us-west-2" \
  --secret "API_KEY=override_key"
```

## CLI Flags

### `--env KEY=VALUE`

Pass environment variables inline (non-secret).

**Usage:**

```bash
stigmer run my-agent --env "DATABASE_URL=postgresql://localhost:5432/mydb"
```

**Repeatable** - Use multiple times:

```bash
stigmer run my-agent \
  --env "REGION=us-east-1" \
  --env "ENVIRONMENT=production" \
  --env "LOG_LEVEL=info"
```

**Format:** `KEY=VALUE`

**Precedence:** Higher than files, lower than `--secret` flags

### `--secret KEY=VALUE`

Pass secrets inline (encrypted at rest).

**Usage:**

```bash
stigmer run my-agent --secret "API_KEY=sk_prod_abc123"
```

**Repeatable** - Use multiple times:

```bash
stigmer run my-agent \
  --secret "DB_PASSWORD=supersecret" \
  --secret "API_KEY=sk_prod_abc123"
```

**Format:** `KEY=VALUE` (same as `--env`, but marked as secret)

**Precedence:** Highest priority - overrides all other sources

**Encryption:** Values are encrypted using AES-256-GCM before storage

### `--env-file PATH`

Load environment variables from a file.

**Usage:**

```bash
stigmer run my-agent --env-file .env
```

**Repeatable** - Later files override earlier ones:

```bash
stigmer run my-agent \
  --env-file .env \
  --env-file .env.local \
  --env-file .env.production
```

**File format:** Standard `.env` format (see below)

**Precedence:** Lowest priority

### `--secret-file PATH`

Load secrets from a file (encrypted at rest).

**Usage:**

```bash
stigmer run my-agent --secret-file .env.secret
```

**Repeatable** - Later files override earlier ones:

```bash
stigmer run my-agent \
  --secret-file .env.secret \
  --secret-file .env.secret.local
```

**File format:** Same as `--env-file`, but all values treated as secrets

**Precedence:** Higher than `--env-file`, lower than inline flags

**Security:** Values are encrypted using AES-256-GCM before storage

## .env File Format

### Basic Format

Standard `.env` file format with key-value pairs:

```bash
# Comments start with #
DATABASE_URL=postgresql://localhost:5432/mydb
REGION=us-east-1
LOG_LEVEL=info

# Empty lines are ignored

PORT=8080
```

### Quoted Values

Use quotes for values with spaces or special characters:

```bash
# Single quotes (literal)
MESSAGE='Hello, World!'

# Double quotes (supports escape sequences)
MESSAGE="Hello, \"World\"!"

# Escape sequences in double quotes
PATH="/home/user/\nprojects"
```

### Comments

```bash
# Full-line comment
DATABASE_URL=postgresql://localhost:5432/mydb  # Inline comment

# Multi-line values not supported
# Use separate keys instead
```

### Export Prefix (Optional)

The `export` prefix is supported but optional:

```bash
# Both formats work
export DATABASE_URL=postgresql://localhost:5432/mydb
REGION=us-east-1
```

### Special Characters

```bash
# Equals sign in value - use quotes
CONNECTION_STRING="Server=localhost;Database=mydb;User=admin"

# Newlines in value - use \n in double quotes
MULTILINE="Line 1\nLine 2\nLine 3"

# Empty value
OPTIONAL_VAR=
```

### Example .env File

```bash
# Application Configuration
REGION=us-east-1
ENVIRONMENT=production
LOG_LEVEL=info

# Database Configuration
DATABASE_HOST=localhost
DATABASE_PORT=5432
DATABASE_NAME=mydb

# Feature Flags
ENABLE_CACHING=true
ENABLE_ANALYTICS=false

# Optional Values
OPTIONAL_CONFIG=
```

### Example .env.secret File

```bash
# API Keys (will be encrypted at rest)
OPENAI_API_KEY=sk-proj-xxxxxxxxxxxx
GITHUB_TOKEN=ghp_xxxxxxxxxxxx
STRIPE_API_KEY=sk_live_xxxxxxxxxxxx

# Database Credentials (will be encrypted at rest)
DATABASE_PASSWORD=supersecret
REDIS_PASSWORD=anothersecret

# Service Tokens (will be encrypted at rest)
JWT_SECRET=randomsecretvalue
ENCRYPTION_KEY=base64encodedkey
```

**Security Note:** Add `.env.secret` to `.gitignore` to prevent committing secrets.

## Precedence Rules

When multiple sources provide the same variable, the following precedence applies (highest to lowest):

```
1. --secret flags       (inline secrets)
2. --env flags          (inline env vars)
3. --secret-file files  (later files override earlier ones)
4. --env-file files     (later files override earlier ones)
```

### Examples

**Scenario 1: File + Inline Flag**

```bash
# .env
REGION=us-east-1

# Command
stigmer run my-agent --env-file .env --env "REGION=us-west-2"

# Result: REGION=us-west-2 (inline flag wins)
```

**Scenario 2: Multiple Files**

```bash
# .env
REGION=us-east-1
LOG_LEVEL=info

# .env.local
REGION=us-west-2

# Command
stigmer run my-agent --env-file .env --env-file .env.local

# Result: 
#   REGION=us-west-2 (later file wins)
#   LOG_LEVEL=info (from first file)
```

**Scenario 3: All Sources Combined**

```bash
# .env
REGION=us-east-1
LOG_LEVEL=info
DATABASE_URL=postgresql://localhost/db

# .env.secret
API_KEY=from_file

# Command
stigmer run my-agent \
  --env-file .env \
  --secret-file .env.secret \
  --env "LOG_LEVEL=debug" \
  --secret "API_KEY=from_flag"

# Result:
#   REGION=us-east-1 (from .env)
#   LOG_LEVEL=debug (--env flag overrides file)
#   DATABASE_URL=postgresql://localhost/db (from .env)
#   API_KEY=from_flag (--secret flag overrides --secret-file)
```

## Secret Handling

### Encryption

Secrets are encrypted at rest using AES-256-GCM:

- **Algorithm:** AES-256-GCM (Galois/Counter Mode)
- **Key derivation:** Platform-managed or environment variable
- **Format:** `enc:v1:<base64(nonce || ciphertext || tag)>`
- **Cross-platform:** Compatible between Java (Cloud) and Go (OSS)

### When to Use Secrets

Mark values as secrets when they contain:

- API keys and tokens
- Passwords and credentials
- Private keys and certificates
- Session secrets
- OAuth client secrets
- Encryption keys

```bash
# Good - Sensitive values marked as secrets
stigmer run my-agent \
  --secret "API_KEY=sk_prod_abc123" \
  --secret "DB_PASSWORD=supersecret" \
  --env "REGION=us-east-1"

# Bad - API key not marked as secret
stigmer run my-agent \
  --env "API_KEY=sk_prod_abc123"  # Stored as plain text!
```

### Best Practices

**1. Separate secrets from non-secrets:**

```bash
# .env - Non-sensitive configuration (commit to git)
REGION=us-east-1
LOG_LEVEL=info
DATABASE_HOST=localhost

# .env.secret - Secrets (add to .gitignore)
DATABASE_PASSWORD=supersecret
API_KEY=sk_prod_abc123
```

**2. Use `.gitignore`:**

```gitignore
# .gitignore
.env.secret
.env.local
.env.*.local
```

**3. Document required variables:**

Create `.env.example` with placeholders:

```bash
# .env.example - Commit this to git
REGION=us-east-1
DATABASE_URL=postgresql://localhost:5432/mydb

# .env.secret.example - Commit this to git
API_KEY=your_api_key_here
DATABASE_PASSWORD=your_password_here
```

**4. Rotate secrets regularly:**

```bash
# Update secret value
stigmer run my-agent --secret "API_KEY=new_rotated_key"
```

**5. Use environment-specific files:**

```bash
# Development
stigmer run my-agent \
  --env-file .env.development \
  --secret-file .env.secret.development

# Production
stigmer run my-agent \
  --env-file .env.production \
  --secret-file .env.secret.production
```

## MCP Server Integration

Environment variables can be used in MCP server configurations via placeholder syntax.

### Placeholder Syntax

Use `${VAR_NAME}` in MCP server configs:

```yaml
# mcpserver.yaml
apiVersion: agentic.stigmer.ai/v1
kind: McpServer
metadata:
  name: GitHub MCP Server
  slug: github
spec:
  http:
    url: https://api.github.com
    headers:
      Authorization: "Bearer ${GITHUB_TOKEN}"
      X-GitHub-Api-Version: "2022-11-28"
```

### Runtime Resolution

Placeholders are resolved at runtime using the merged environment:

```bash
# Provide GITHUB_TOKEN via secret flag
stigmer run my-agent \
  --secret "GITHUB_TOKEN=ghp_xxxxxxxxxxxx"

# Agent uses github MCP server
# Runtime resolves: Authorization: "Bearer ghp_xxxxxxxxxxxx"
```

### Validation

Missing required variables cause execution to fail fast:

```bash
stigmer run my-agent

# Error: MCP server 'github' missing required environment variables: GITHUB_TOKEN
#
# Solution: Provide the variable:
#   stigmer run my-agent --secret "GITHUB_TOKEN=ghp_xxxxxxxxxxxx"
```

### Example: Multi-Server Setup

```bash
# Multiple MCP servers with different auth
stigmer run my-agent \
  --secret "GITHUB_TOKEN=ghp_xxxxxxxxxxxx" \
  --secret "SLACK_TOKEN=xoxb-xxxxxxxxxxxx" \
  --secret "AWS_ACCESS_KEY=AKIA..." \
  --secret "AWS_SECRET_KEY=..."
```

See [Using MCP Servers](using-mcp-servers.md) for complete MCP documentation.

## Common Patterns

### Pattern 1: Development + Production Environments

**Setup:**

```bash
# .env.development
REGION=us-west-2
LOG_LEVEL=debug
API_ENDPOINT=http://localhost:3000

# .env.secret.development
API_KEY=dev_key_12345
DB_PASSWORD=devpassword

# .env.production
REGION=us-east-1
LOG_LEVEL=info
API_ENDPOINT=https://api.example.com

# .env.secret.production
API_KEY=prod_key_67890
DB_PASSWORD=strongprodpassword
```

**Usage:**

```bash
# Development
stigmer run my-agent \
  --env-file .env.development \
  --secret-file .env.secret.development

# Production
stigmer run my-agent \
  --env-file .env.production \
  --secret-file .env.secret.production
```

### Pattern 2: Base Configuration + Overrides

**Setup:**

```bash
# .env - Base configuration
REGION=us-east-1
LOG_LEVEL=info
RETRY_COUNT=3
TIMEOUT_SECONDS=30

# .env.local - Local overrides (not committed)
LOG_LEVEL=debug
REGION=us-west-2
```

**Usage:**

```bash
# Load base + local overrides
stigmer run my-agent \
  --env-file .env \
  --env-file .env.local
```

### Pattern 3: Shared Secrets + Per-User Overrides

**Setup:**

```bash
# .env.secret.shared - Team secrets
SHARED_API_KEY=team_key_12345
DATABASE_PASSWORD=shared_db_pass

# .env.secret.local - Personal tokens (not committed)
GITHUB_TOKEN=ghp_personal_token
```

**Usage:**

```bash
stigmer run my-agent \
  --secret-file .env.secret.shared \
  --secret-file .env.secret.local
```

### Pattern 4: CLI Override for Testing

**Test different configurations without editing files:**

```bash
# Test with different region
stigmer run my-agent \
  --env-file .env \
  --env "REGION=eu-west-1"

# Test with different API endpoint
stigmer run my-agent \
  --env-file .env \
  --env "API_ENDPOINT=https://staging.example.com"

# Test with mock credentials
stigmer run my-agent \
  --secret-file .env.secret \
  --secret "API_KEY=mock_key_for_testing"
```

### Pattern 5: Multi-Environment with Scripts

**Create helper scripts:**

```bash
#!/bin/bash
# run-dev.sh
stigmer run "$@" \
  --env-file .env.development \
  --secret-file .env.secret.development

# Usage: ./run-dev.sh my-agent
```

```bash
#!/bin/bash
# run-prod.sh
stigmer run "$@" \
  --env-file .env.production \
  --secret-file .env.secret.production

# Usage: ./run-prod.sh my-agent
```

## Troubleshooting

### Issue 1: Variable Not Available at Runtime

**Symptom:**

```
Error: Environment variable not found: DATABASE_URL
```

**Solutions:**

1. **Check spelling:** Variable names are case-sensitive

```bash
# Wrong
stigmer run my-agent --env "database_url=..."

# Correct
stigmer run my-agent --env "DATABASE_URL=..."
```

2. **Verify flag used:**

```bash
# File not loaded
stigmer run my-agent  # Missing --env-file

# Correct
stigmer run my-agent --env-file .env
```

3. **Check file path:**

```bash
# Wrong path
stigmer run my-agent --env-file ../wrong/.env

# Correct path
stigmer run my-agent --env-file .env
```

### Issue 2: Secret Stored as Plain Text

**Symptom:**

Secret values visible in logs or database.

**Solution:**

Use `--secret` or `--secret-file`, not `--env`:

```bash
# Wrong - Stored as plain text
stigmer run my-agent --env "API_KEY=secret_value"

# Correct - Encrypted at rest
stigmer run my-agent --secret "API_KEY=secret_value"
```

### Issue 3: Precedence Confusion

**Symptom:**

Unexpected variable values.

**Solution:**

Remember precedence order (highest to lowest):

1. `--secret` flags
2. `--env` flags
3. `--secret-file` files
4. `--env-file` files

```bash
# LOG_LEVEL will be "debug" (--env flag wins over --env-file)
stigmer run my-agent \
  --env-file .env \
  --env "LOG_LEVEL=debug"
```

### Issue 4: Invalid .env File Format

**Symptom:**

```
Error: Invalid environment format at line 5: missing '=' separator
```

**Solution:**

Check `.env` file format:

```bash
# Wrong
API_KEY sk_prod_abc123

# Correct
API_KEY=sk_prod_abc123
```

### Issue 5: MCP Server Placeholder Not Resolved

**Symptom:**

```
Error: MCP server 'github' missing required environment variables: GITHUB_TOKEN
```

**Solution:**

Provide the variable via flag or file:

```bash
# Via flag
stigmer run my-agent --secret "GITHUB_TOKEN=ghp_xxxxxxxxxxxx"

# Via file
# .env.secret
GITHUB_TOKEN=ghp_xxxxxxxxxxxx

stigmer run my-agent --secret-file .env.secret
```

### Issue 6: File Not Found

**Symptom:**

```
Error: Failed to read environment file: .env.secret: no such file or directory
```

**Solutions:**

1. **Create the file:**

```bash
touch .env.secret
echo "API_KEY=your_key_here" >> .env.secret
```

2. **Use absolute path:**

```bash
stigmer run my-agent --secret-file /absolute/path/to/.env.secret
```

3. **Run from correct directory:**

```bash
cd /path/to/project
stigmer run my-agent --secret-file .env.secret
```

## Security Considerations

### 1. Never Commit Secrets

**Add to `.gitignore`:**

```gitignore
# Secrets
.env.secret
.env.secret.*
.env.local
.env.*.local

# Except examples
!.env.secret.example
!.env.example
```

### 2. Use Separate Files for Secrets

```bash
# Good - Secrets separated
.env               # Non-sensitive (commit to git)
.env.secret        # Secrets (gitignored)

# Bad - Mixed
.env               # Contains both (risky if committed)
```

### 3. Limit Secret Scope

Provide only necessary secrets:

```bash
# Good - Only needed secrets
stigmer run github-pr-reviewer \
  --secret "GITHUB_TOKEN=ghp_xxxxxxxxxxxx"

# Bad - Unnecessary secrets exposed
stigmer run github-pr-reviewer \
  --secret "GITHUB_TOKEN=ghp_xxxxxxxxxxxx" \
  --secret "AWS_SECRET_KEY=..." \
  --secret "DATABASE_PASSWORD=..."
```

### 4. Rotate Secrets Regularly

Update secrets periodically:

```bash
# Generate new API key from provider
# Then update:
stigmer run my-agent --secret "API_KEY=new_rotated_key"
```

### 5. Use Environment-Specific Secrets

Never share secrets across environments:

```bash
# Good - Separate secrets per environment
.env.secret.development  # Dev secrets
.env.secret.production   # Prod secrets (different values!)

# Bad - Same secrets file for all environments
.env.secret  # Used in dev AND prod (dangerous!)
```

### 6. Audit Secret Access

Monitor which agents access secrets:

```bash
# Review agent logs for secret access patterns
stigmer logs my-agent | grep "Environment loaded"
```

### 7. Principle of Least Privilege

Grant minimal necessary access:

```yaml
# Agent definition - Only request needed env vars
spec:
  env_spec:
    data:
      GITHUB_TOKEN:  # Only GitHub token needed
        is_secret: true
      # Don't request DATABASE_PASSWORD if not needed
```

## Examples

### Example 1: Local Development

```bash
# .env.development
REGION=us-west-2
LOG_LEVEL=debug
API_ENDPOINT=http://localhost:3000
ENABLE_MOCK=true

# .env.secret.development
API_KEY=dev_key_12345
DB_PASSWORD=devpassword

# Run
stigmer run my-agent \
  --env-file .env.development \
  --secret-file .env.secret.development
```

### Example 2: Production Deployment

```bash
# .env.production
REGION=us-east-1
LOG_LEVEL=info
API_ENDPOINT=https://api.example.com
ENABLE_MOCK=false

# .env.secret.production
API_KEY=prod_key_67890
DB_PASSWORD=str0ngPr0dP@ssw0rd!

# Run
stigmer run my-agent \
  --env-file .env.production \
  --secret-file .env.secret.production
```

### Example 3: MCP Servers with Environment Variables

```bash
# .env.secret
GITHUB_TOKEN=ghp_xxxxxxxxxxxx
SLACK_TOKEN=xoxb-xxxxxxxxxxxx
OPENAI_API_KEY=sk-proj-xxxxxxxxxxxx

# Agent uses MCP servers that need these tokens
stigmer run code-assistant \
  --secret-file .env.secret \
  --message "Review PR #123"
```

### Example 4: Override for Testing

```bash
# Use production config but mock API for testing
stigmer run my-agent \
  --env-file .env.production \
  --env "API_ENDPOINT=https://mock.example.com" \
  --secret "API_KEY=mock_key_for_testing"
```

### Example 5: Workflows with Shared Configuration

```bash
# .env.shared - Shared across multiple workflows
REGION=us-east-1
LOG_LEVEL=info
NOTIFICATION_EMAIL=team@example.com

# .env.secret.shared
DATABASE_PASSWORD=shared_password
API_KEY=shared_api_key

# Run multiple workflows with same config
stigmer run workflow-1 \
  --env-file .env.shared \
  --secret-file .env.secret.shared

stigmer run workflow-2 \
  --env-file .env.shared \
  --secret-file .env.secret.shared
```

## Related Documentation

- [Running Agents and Workflows](../cli/running-agents-workflows.md) - CLI command reference
- [Using MCP Servers](using-mcp-servers.md) - MCP server environment integration
- [Configuration](../cli/configuration.md) - CLI configuration and context
- [Deploying with Apply](deploying-with-apply.md) - Deploy-time configuration

---

**Remember**: Always use `--secret` or `--secret-file` for sensitive values. Secrets are encrypted at rest using AES-256-GCM and never exposed in plain text through APIs.
