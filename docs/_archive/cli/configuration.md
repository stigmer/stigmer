# Stigmer CLI Configuration Guide

Configuration file location: `~/.stigmer/config.yaml`

## Quick Start

The CLI auto-generates a default configuration on first run. For most users, **no manual configuration is needed** — just run `stigmer server` and it works.

If `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` is set in your environment, the CLI picks up the provider automatically.

On first server start, the seedpack bootstraps a `default` organization and the CLI sets it as the active context. All commands target this organization automatically.

---

## Configuration File

```yaml
backend:
    type: local      # "local" (default) or "cloud"
    local:
        llm:
            provider: anthropic
            model: claude-sonnet-4.5
            api_key: sk-ant-api03-...
        temporal:
            managed: true
        execution:
            mode: local  # "local" (default), "sandbox", or "auto"
context:
    organization: default  # active organization slug
```

`backend.type` selects which sub-section is active. Use `local:` for local mode and `cloud:` for Stigmer Cloud. The daemon endpoint (`localhost:7234`) and data directory (`~/.stigmer/data`) are managed by the CLI and cannot be configured.

---

## Organization Context

Every Stigmer command operates within an organization. The CLI resolves the active organization through a priority chain, from highest to lowest:

```
1. --org flag              (per-command override)
    ↓
2. stigmer.yaml metadata.org  (project-level, apply commands only)
    ↓
3. context.organization    (config file — persistent default)
    ↓
4. Backend.Cloud.OrgID     (backward compat for existing cloud configs)
    ↓
5. Error                   (no org found)
```

### Automatic Setup

On first `stigmer server start`, the CLI bootstraps a `default` organization from the seedpack and sets `context.organization: default` in the config file. No manual steps required for single-org use.

### Viewing and Switching Context

```bash
# See the active organization
stigmer config context show

# Switch to a different organization
stigmer config context set --org acme-corp

# Override for a single command (does not change saved context)
stigmer list agents --org acme-corp
```

The `--org` flag is a global persistent flag available on all commands.

### Managing Context via Config

```bash
# Read the active organization
stigmer config get context.organization

# Set it directly
stigmer config set context.organization acme-corp
```

### `STIGMER_ORG_ID` Runtime Injection

When the CLI runs an agent (`stigmer run`) or synthesizes SDK output (`stigmer project apply` with an entry point), it injects the resolved organization as `STIGMER_ORG_ID` into the execution environment. Agents and SDK programs can read this variable to know which organization they are operating in.

If the user explicitly provides `--env STIGMER_ORG_ID=custom-value`, the user's value takes precedence.

---

## LLM Provider

The LLM provider is the main configuration choice. Three providers are supported.

### Option 1: Anthropic Claude (Recommended)

**Best for**: Production agents, high-quality reasoning, tool use.

```yaml
backend:
    local:
        llm:
            provider: anthropic
            model: claude-sonnet-4.5
            api_key: sk-ant-api03-...
```

Set the API key via environment variable instead of the config file (recommended):

```bash
export ANTHROPIC_API_KEY="sk-ant-api03-..."
```

Get an API key at https://console.anthropic.com/.

**Supported models**:
- `claude-sonnet-4.5` (default - best balance)
- `claude-opus-4` (highest quality, slower)
- `claude-haiku-3.5` (fastest, cheapest)

---

### Option 2: OpenAI

**Best for**: GPT-4 usage, Azure OpenAI compatibility.

```yaml
backend:
    local:
        llm:
            provider: openai
            model: gpt-4
            api_key: sk-proj-...
```

Set the API key via environment variable instead of the config file (recommended):

```bash
export OPENAI_API_KEY="sk-proj-..."
```

Get an API key at https://platform.openai.com/api-keys.

**Supported models**:
- `gpt-4` (default)
- `gpt-4-turbo` (faster, cheaper)
- `gpt-4o` (latest, multimodal)

**Azure OpenAI**: Set `base_url` to your deployment endpoint:

```yaml
llm:
    provider: openai
    model: gpt-4
    api_key: your-azure-api-key
    base_url: https://your-resource.openai.azure.com/openai/deployments/your-deployment
```

---

### Option 3: Ollama (Local, No API Key Required)

**Best for**: Local development, privacy, offline usage.

```yaml
backend:
    local:
        llm:
            provider: ollama
            model: qwen2.5-coder:7b
            base_url: http://localhost:11434  # optional, this is the default
```

When you run `stigmer server`, the CLI automatically downloads the Ollama binary, starts the server in the background, and downloads the model. No manual installation needed.

To run Ollama on a different machine, set `base_url` to its address (e.g., `http://192.168.1.100:11434`).

**Supported models**:
- `qwen2.5-coder:7b` (default - good balance of speed and quality)
- `codellama:7b` (alternative coding model)
- `qwen2.5-coder:14b` (better quality, slower)

---

## Execution Mode

Controls how agent tool code runs.

```yaml
backend:
    local:
        execution:
            mode: local          # "local" (default), "sandbox", or "auto"
            sandbox_image: ...   # Docker image (sandbox mode only)
            auto_pull: true      # Auto-pull image if missing
            cleanup: true        # Remove containers after execution
            ttl: 3600            # Container reuse TTL in seconds
```

| Mode | Description |
|------|-------------|
| `local` | Runs directly on your machine (default) |
| `sandbox` | Runs in an isolated Docker container |
| `auto` | Uses sandbox if Docker is available, otherwise local |

---

## Temporal Workflow Engine

Temporal runs your workflows and agent executions. It is managed automatically by default.

### Managed (Default)

```yaml
backend:
    local:
        temporal:
            managed: true
```

The CLI downloads, starts, and stops Temporal automatically. No setup required.

### External Temporal Server

Use an external Temporal server (self-hosted or Temporal Cloud):

```yaml
backend:
    local:
        temporal:
            managed: false
            address: temporal.example.com:7233
```

---

## Cloud Backend

Use Stigmer Cloud instead of the local daemon:

```yaml
backend:
    type: cloud
    cloud:
        endpoint: api.stigmer.ai:443   # default
        token: your-auth-token
        org_id: your-org-id
        env_id: your-env-id
```

When `type: cloud` is set, the `local:` section is ignored. The `cloud.org_id` field is read as a fallback if `context.organization` is not set (backward compatibility).

---

## Configuration Precedence

Configuration is resolved from highest to lowest priority:

```
1. CLI Flags            (highest — per-command override)
    ↓
2. Environment Variables
    ↓
3. Config File          (~/.stigmer/config.yaml)
    ↓
4. Defaults             (lowest — zero-config experience)
```

This follows the same cascade pattern as kubectl, Docker, and AWS CLI.

**When to use each method:**

| Method | Use Case |
|--------|----------|
| CLI flags | Quick testing, one-off overrides |
| Environment variables | CI/CD pipelines, session-level config |
| Config file | Daily development preferences |
| Defaults | First-time zero-config experience |

---

## Environment Variables

| Config Setting | Environment Variable |
|----------------|---------------------|
| LLM provider | `STIGMER_LLM_PROVIDER` |
| LLM model | `STIGMER_LLM_MODEL` |
| LLM base URL | `STIGMER_LLM_BASE_URL` |
| Anthropic API key | `ANTHROPIC_API_KEY` |
| OpenAI API key | `OPENAI_API_KEY` |
| Execution mode | `STIGMER_EXECUTION_MODE` |
| Sandbox image | `STIGMER_SANDBOX_IMAGE` |
| Sandbox auto-pull | `STIGMER_SANDBOX_AUTO_PULL` |
| Sandbox cleanup | `STIGMER_SANDBOX_CLEANUP` |
| Sandbox TTL | `STIGMER_SANDBOX_TTL` |
| Temporal address | `TEMPORAL_SERVICE_ADDRESS` |

**Runtime environment (injected by CLI into agent/SDK execution):**

| Variable | Description |
|----------|-------------|
| `STIGMER_ORG_ID` | Resolved organization slug — available to agents and SDK entry points |
| `STIGMER_OUT_DIR` | Output directory for SDK synthesis |

---

## CLI Commands for Config Management

```bash
# View all config values
stigmer config list

# Get a specific value
stigmer config get llm.provider
stigmer config get context.organization

# Set a value
stigmer config set llm.provider anthropic
stigmer config set context.organization acme-corp
stigmer config set execution.mode sandbox

# Show config file path
stigmer config path

# View and switch org context
stigmer config context show
stigmer config context set --org acme-corp
```

---

## Troubleshooting

### "ANTHROPIC_API_KEY not set"

```bash
export ANTHROPIC_API_KEY="sk-ant-..."
# Add to ~/.zshrc or ~/.bashrc to persist
```

### "OPENAI_API_KEY not set"

```bash
export OPENAI_API_KEY="sk-..."
# Add to ~/.zshrc or ~/.bashrc to persist
```

### "Cannot connect to Ollama"

The Stigmer daemon manages Ollama automatically. If you see this error, verify the daemon is running:

```bash
stigmer server status
stigmer server start
```

### "Cannot connect to Temporal"

Verify the Temporal address is correct and the server is reachable. To fall back to managed mode:

```yaml
temporal:
    managed: true
```

### "Which setting is being used?"

```bash
# Check env vars that may override config
env | grep STIGMER_

# View effective config
stigmer config list

# Check active context
stigmer config context show
```

### "My config file changes are not working"

Environment variables and CLI flags take precedence over the config file. Check for overrides:

```bash
env | grep STIGMER_
```

---

## Security

- The config file has restricted permissions (`0600` — owner only).
- Use environment variables for API keys on shared or production systems.
- Do not commit `config.yaml` to git if it contains API keys. Add it to `.gitignore`.
- Rotate keys immediately if accidentally exposed.

---

## Getting Help

- **Documentation**: https://github.com/stigmer/stigmer/docs
- **Issues**: https://github.com/stigmer/stigmer/issues
- **Discussions**: https://github.com/stigmer/stigmer/discussions
