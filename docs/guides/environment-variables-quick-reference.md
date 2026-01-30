# Environment Variables - Quick Reference

Quick reference card for Stigmer environment variables and secrets.

## Basic Commands

```bash
# Inline environment variable
stigmer run my-agent --env "KEY=VALUE"

# Inline secret (encrypted at rest)
stigmer run my-agent --secret "API_KEY=secret_value"

# Load from file
stigmer run my-agent --env-file .env

# Load secrets from file
stigmer run my-agent --secret-file .env.secret

# Combine all sources
stigmer run my-agent \
  --env-file .env \
  --secret-file .env.secret \
  --env "REGION=us-west-2" \
  --secret "API_KEY=override_key"
```

## Precedence Order

Higher numbers override lower numbers:

```
4. --secret flags       (highest priority)
3. --env flags
2. --secret-file files
1. --env-file files     (lowest priority)
```

**Example:**

```bash
# REGION will be "us-west-2" (flag wins over file)
stigmer run my-agent \
  --env-file .env \
  --env "REGION=us-west-2"
```

## File Format

### .env file format

```bash
# Comments start with #
DATABASE_URL=postgresql://localhost:5432/mydb
REGION=us-east-1

# Quotes for values with spaces
MESSAGE="Hello, World!"

# Export prefix (optional)
export LOG_LEVEL=info

# Empty values allowed
OPTIONAL_VAR=
```

### Special characters

```bash
# Equals sign in value - use quotes
CONNECTION="Server=localhost;Database=mydb"

# Newlines - use \n in double quotes
MULTILINE="Line 1\nLine 2"

# Single vs double quotes
SINGLE='Literal $VAR not expanded'
DOUBLE="Supports \n escapes"
```

## Common Patterns

### Development + Production

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

### Base + Override

```bash
# Base configuration + local overrides
stigmer run my-agent \
  --env-file .env \
  --env-file .env.local
```

### Test Override

```bash
# Test with different configuration
stigmer run my-agent \
  --env-file .env \
  --env "LOG_LEVEL=debug" \
  --secret "API_KEY=test_key"
```

## MCP Server Placeholders

Use `${VAR_NAME}` in MCP server configurations:

```yaml
# mcpserver.yaml
spec:
  http:
    headers:
      Authorization: "Bearer ${GITHUB_TOKEN}"
```

Resolved at runtime:

```bash
stigmer run my-agent \
  --secret "GITHUB_TOKEN=ghp_xxxxxxxxxxxx"

# Runtime resolves to:
# Authorization: "Bearer ghp_xxxxxxxxxxxx"
```

## Security Checklist

- ✓ Use `--secret` or `--secret-file` for sensitive values
- ✓ Add `.env.secret` to `.gitignore`
- ✓ Create `.env.example` and `.env.secret.example` templates
- ✓ Use separate secrets for dev/staging/production
- ✓ Rotate secrets regularly
- ✗ Never commit `.env.secret` to git
- ✗ Never hardcode secrets in code
- ✗ Never share secrets via email/Slack

## Setup Template

### 1. Create .gitignore

```bash
# Add to .gitignore
.env.secret
.env.secret.*
.env.*.local
```

### 2. Create environment files

```bash
# Non-sensitive configuration (commit to git)
cat > .env << EOF
REGION=us-east-1
LOG_LEVEL=info
DATABASE_HOST=localhost
EOF

# Secrets (DO NOT commit)
cat > .env.secret << EOF
API_KEY=your_api_key_here
DATABASE_PASSWORD=your_password_here
EOF
```

### 3. Create example templates

```bash
# Create templates for team (commit these)
cp .env .env.example
cp .env.secret .env.secret.example

# Edit examples to remove real values
# Replace with placeholders like "your_key_here"
```

### 4. Document in README

```markdown
## Setup

1. Copy environment templates:
   ```bash
   cp .env.example .env
   cp .env.secret.example .env.secret
   ```

2. Edit `.env.secret` and add your credentials

3. Run the agent:
   ```bash
   stigmer run my-agent \
     --env-file .env \
     --secret-file .env.secret
   ```
```

## Troubleshooting

### Variable not found

```bash
# Error: Environment variable not found: DATABASE_URL

# Check spelling (case-sensitive)
stigmer run my-agent --env "DATABASE_URL=..."

# Verify file loaded
stigmer run my-agent --env-file .env
```

### Secret stored as plain text

```bash
# Wrong - Plain text
stigmer run my-agent --env "API_KEY=secret"

# Correct - Encrypted
stigmer run my-agent --secret "API_KEY=secret"
```

### MCP server placeholder not resolved

```bash
# Error: MCP server 'github' missing required environment variables: GITHUB_TOKEN

# Provide the variable
stigmer run my-agent --secret "GITHUB_TOKEN=ghp_xxx"
```

### File not found

```bash
# Error: Failed to read environment file: .env.secret

# Check file exists
ls -la .env.secret

# Use absolute path
stigmer run my-agent --secret-file /absolute/path/.env.secret

# Or run from correct directory
cd /path/to/project
stigmer run my-agent --secret-file .env.secret
```

## Flag Reference

| Flag | Description | Example |
|------|-------------|---------|
| `--env KEY=VALUE` | Inline environment variable | `--env "REGION=us-east-1"` |
| `--secret KEY=VALUE` | Inline secret (encrypted) | `--secret "API_KEY=sk_xxx"` |
| `--env-file PATH` | Load env vars from file | `--env-file .env` |
| `--secret-file PATH` | Load secrets from file | `--secret-file .env.secret` |

**All flags are repeatable** - Use multiple times for multiple values/files.

## When to Use Secrets

Mark as secret (`--secret` or `--secret-file`):

- ✓ API keys and tokens
- ✓ Passwords and credentials
- ✓ Private keys and certificates
- ✓ Session secrets
- ✓ OAuth client secrets
- ✓ Encryption keys

Mark as non-secret (`--env` or `--env-file`):

- ✓ Region/zone names
- ✓ Log levels
- ✓ Feature flags
- ✓ Service endpoints (URLs)
- ✓ Port numbers
- ✓ Timeouts and retry counts

**When in doubt, mark as secret** - Better safe than sorry!

## Complete Documentation

- [Environment Variables Guide](environment-variables.md) - Complete 700+ line guide
- [Using MCP Servers](using-mcp-servers.md) - MCP server integration
- [Running Agents and Workflows](../cli/running-agents-workflows.md) - CLI reference

---

**Need help?** See the [complete guide](environment-variables.md) for detailed examples, troubleshooting, and best practices.
