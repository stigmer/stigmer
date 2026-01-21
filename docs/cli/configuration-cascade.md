# Configuration Cascade Pattern

**Implementation Date**: 2026-01-22  
**Status**: ✅ Complete

## Overview

Stigmer implements the industry-standard **configuration cascade pattern** following tools like Docker, kubectl, AWS CLI, and Terraform.

## Priority Order

Configuration is resolved in this order (highest to lowest priority):

```
1. CLI Flags        (highest priority)
    ↓
2. Environment Variables
    ↓
3. Config File (~/.stigmer/config.yaml)
    ↓
4. Defaults        (lowest priority)
```

## Configuration Methods

### Method 1: CLI Flags (Highest Priority)

Override any setting for a single command:

```bash
# Execution mode
stigmer server start --execution-mode=sandbox

# Sandbox image
stigmer server start --sandbox-image=my-custom:latest

# Multiple flags
stigmer server start \
  --execution-mode=sandbox \
  --sandbox-image=my-custom:latest \
  --sandbox-ttl=7200
```

**Available Flags:**
- `--execution-mode` - Execution mode: local, sandbox, or auto
- `--sandbox-image` - Docker image for sandbox mode
- `--sandbox-auto-pull` - Auto-pull sandbox image if missing (default: true)
- `--sandbox-cleanup` - Cleanup containers after execution (default: true)
- `--sandbox-ttl` - Container reuse TTL in seconds (default: 3600)

**When to use:**
- Quick testing/debugging
- One-off overrides
- Temporary changes

### Method 2: Environment Variables

Set for current terminal session or permanently in shell profile:

```bash
# Execution configuration
export STIGMER_EXECUTION_MODE=sandbox
export STIGMER_SANDBOX_IMAGE=my-custom:latest
export STIGMER_SANDBOX_AUTO_PULL=true
export STIGMER_SANDBOX_CLEANUP=true
export STIGMER_SANDBOX_TTL=3600

# Then start server
stigmer server start
```

**Permanent (add to ~/.zshrc or ~/.bashrc):**
```bash
# Add to shell profile
echo 'export STIGMER_EXECUTION_MODE=sandbox' >> ~/.zshrc
source ~/.zshrc
```

**Available Environment Variables:**
- `STIGMER_EXECUTION_MODE` - Execution mode: local, sandbox, or auto
- `STIGMER_SANDBOX_IMAGE` - Docker image for sandbox mode
- `STIGMER_SANDBOX_AUTO_PULL` - Auto-pull sandbox image if missing
- `STIGMER_SANDBOX_CLEANUP` - Cleanup containers after execution
- `STIGMER_SANDBOX_TTL` - Container reuse TTL in seconds

**When to use:**
- CI/CD pipelines
- Docker containers
- Session-level overrides
- Team development environments

### Method 3: Config File (Persistent)

Edit `~/.stigmer/config.yaml` for persistent preferences:

```yaml
backend:
  type: local
  local:
    # LLM configuration
    llm:
      provider: ollama
      model: qwen2.5-coder:7b
      base_url: http://localhost:11434
    
    # Temporal configuration
    temporal:
      managed: true
    
    # Execution configuration
    execution:
      mode: sandbox                  # local, sandbox, or auto
      sandbox_image: my-custom:latest
      auto_pull: true
      cleanup: true
      ttl: 3600
```

**Helper Commands:**
```bash
# View current config
stigmer config list

# Get specific value
stigmer config get execution.mode

# Set value
stigmer config set execution.mode sandbox
stigmer config set execution.sandbox_image my-custom:latest
stigmer config set execution.ttl 7200

# Show config file path
stigmer config path

# Edit manually
vim ~/.stigmer/config.yaml
```

**When to use:**
- Daily development preferences
- Persistent team settings
- Default behavior configuration

### Method 4: Defaults

Built-in defaults if nothing is configured:

```go
execution:
  mode: local                                           # Fast, no Docker
  sandbox_image: ghcr.io/stigmer/agent-sandbox-basic:latest
  auto_pull: true
  cleanup: true
  ttl: 3600  // 1 hour
```

## Examples

### Example 1: Quick Testing (CLI Flags)

Test sandbox mode once without changing config:

```bash
stigmer server start --execution-mode=sandbox
```

### Example 2: CI/CD Pipeline (Environment Variables)

```yaml
# .github/workflows/test.yml
jobs:
  test:
    runs-on: ubuntu-latest
    env:
      STIGMER_EXECUTION_MODE: sandbox
      STIGMER_SANDBOX_AUTO_PULL: true
    steps:
      - run: stigmer server start
```

### Example 3: Daily Development (Config File)

Set persistent preference for sandbox mode:

```bash
stigmer config set execution.mode sandbox
stigmer server start  # Always uses sandbox mode
```

### Example 4: Override Hierarchy

See how priority works:

```bash
# Config file says: local
# Env var says: sandbox
# CLI flag says: auto
# Result: auto (CLI flag wins)

export STIGMER_EXECUTION_MODE=sandbox
stigmer server start --execution-mode=auto
# Uses auto mode (CLI flag overrides env var and config)
```

## Common Patterns

### Pattern 1: Default Local, Override for Testing

**Config file** (`~/.stigmer/config.yaml`):
```yaml
execution:
  mode: local  # Fast by default
```

**When testing:**
```bash
stigmer server start --execution-mode=sandbox  # One-off override
```

### Pattern 2: Team Standard in Config, Personal Override

**Config file** (team standard):
```yaml
execution:
  mode: local
```

**Personal preference** (in ~/.zshrc):
```bash
export STIGMER_EXECUTION_MODE=sandbox  # Override for yourself
```

### Pattern 3: CI Uses Sandbox, Local Uses Local

**CI/CD** (environment variables):
```bash
export STIGMER_EXECUTION_MODE=sandbox
stigmer server start
```

**Local development** (config file):
```yaml
execution:
  mode: local  # Fast local development
```

## Configuration Keys Reference

### Execution Configuration

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `execution.mode` | string | `local` | Execution mode: local, sandbox, or auto |
| `execution.sandbox_image` | string | `ghcr.io/stigmer/agent-sandbox-basic:latest` | Docker image for sandbox mode |
| `execution.auto_pull` | bool | `true` | Auto-pull sandbox image if missing |
| `execution.cleanup` | bool | `true` | Cleanup containers after execution |
| `execution.ttl` | int | `3600` | Container reuse TTL in seconds |

### LLM Configuration

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `llm.provider` | string | `ollama` | LLM provider: ollama, anthropic, openai |
| `llm.model` | string | `qwen2.5-coder:7b` | Model name |
| `llm.base_url` | string | `http://localhost:11434` | API base URL |
| `llm.api_key` | string | - | API key (sensitive) |

### Temporal Configuration

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `temporal.managed` | bool | `true` | Auto-download and manage Temporal |

## Best Practices

### 1. Use Config File for Defaults

Set your daily preferences in config file:
```bash
stigmer config set execution.mode local
stigmer config set llm.provider ollama
```

### 2. Use Environment Variables for CI/CD

Let pipelines override via env vars:
```yaml
env:
  STIGMER_EXECUTION_MODE: sandbox
  STIGMER_SANDBOX_AUTO_PULL: true
```

### 3. Use CLI Flags for Quick Tests

Override temporarily without changing config:
```bash
stigmer server start --execution-mode=sandbox
```

### 4. Don't Mix Methods Unnecessarily

Choose one primary method:
- **Developers**: Config file
- **CI/CD**: Environment variables
- **Testing**: CLI flags

### 5. Document Team Standards

If your team has conventions, document them:
```bash
# team-config.md
Our Standard Setup:
- Config file: execution.mode = local (fast development)
- CI/CD env var: STIGMER_EXECUTION_MODE=sandbox (isolated tests)
```

## Troubleshooting

### "Which setting is being used?"

Check resolution with debug mode:
```bash
stigmer server start --debug
# Shows: Resolved execution configuration
```

### "My config file changes aren't working"

Check if overridden by env var or CLI flag:
```bash
# Check env vars
env | grep STIGMER_

# View effective config
stigmer config list
```

### "How do I reset to defaults?"

Remove config file and env vars:
```bash
# Remove config
rm ~/.stigmer/config.yaml

# Unset env vars
unset STIGMER_EXECUTION_MODE
unset STIGMER_SANDBOX_IMAGE

# Restart server
stigmer server start  # Uses defaults
```

## Industry Standard Comparison

Stigmer's cascade pattern matches these tools:

### Docker
```bash
docker run --memory="512m" nginx        # CLI flag
export DOCKER_HOST=tcp://...            # Env var
~/.docker/config.json                   # Config file
```

### kubectl
```bash
kubectl get pods --namespace=prod       # CLI flag
export KUBECTL_NAMESPACE=prod           # Env var
~/.kube/config                          # Config file
```

### AWS CLI
```bash
aws s3 ls --region us-west-2            # CLI flag
export AWS_REGION=us-west-2             # Env var
~/.aws/config                           # Config file
```

### Terraform
```bash
terraform apply -var="region=us-west-2" # CLI flag
export TF_VAR_region=us-west-2          # Env var
terraform.tfvars                        # Config file
```

## Summary

**Three ways to configure, one clear priority:**

1. **CLI Flags** → Quick overrides
2. **Environment Variables** → Session/pipeline config
3. **Config File** → Persistent preferences
4. **Defaults** → Zero-config experience

**Use the right tool for the right job:**
- Daily work? → Config file
- CI/CD? → Environment variables
- Testing? → CLI flags

---

*"Configuration should be flexible, not confusing."*
