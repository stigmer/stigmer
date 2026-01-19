# Local LLM Configuration Guide

This guide shows how to configure the agent-runner for different LLM providers in local development.

## Quick Start (CLI - Recommended)

**For most users**, the Stigmer CLI provides zero-config local development:

```bash
# First time: Initialize Stigmer
$ stigmer init
✓ Created config directory: ~/.stigmer
✓ Downloaded Temporal CLI v1.25.1
✓ Created default config with Ollama
✓ Configured for zero-dependency local mode

# Start the local daemon (auto-manages Temporal + uses Ollama)
$ stigmer local start
✓ Using Ollama (no API key required)
✓ Starting managed Temporal server...
✓ Temporal started on localhost:7233
✓ Starting stigmer-server...
✓ Starting agent-runner with ollama
✓ Daemon started successfully

# Check status
$ stigmer local status
Daemon Status:
─────────────────────────────────────
  Status:   ✓ Running
  PID:      12345
  Port:     50051
  Data:     ~/.stigmer/data

Configuration:
  LLM:      ollama (qwen2.5-coder:7b)
  Temporal: Managed (running on port 7233)
```

**That's it!** No Docker, no API keys, no manual configuration.

### Switching Providers

**Option 1: Edit config file** (`~/.stigmer/config.yaml`):

```yaml
backend:
  type: local
  local:
    llm:
      provider: anthropic  # or "openai", "ollama"
      model: claude-sonnet-4.5
```

**Option 2: Use environment variables**:

```bash
# Use Anthropic
export STIGMER_LLM_PROVIDER=anthropic
export ANTHROPIC_API_KEY=sk-ant-...
stigmer local start

# Use OpenAI
export STIGMER_LLM_PROVIDER=openai
export OPENAI_API_KEY=sk-...
stigmer local start
```

**See [CLI Configuration Reference](#cli-configuration-reference) below for all options.**

---

## Manual Deployment (Kubernetes/Kustomize)

If you're deploying the agent-runner manually (not using the CLI), follow these instructions:

## Option 1: Ollama (Default - Zero Cost)

**Recommended for most local development.**

### Setup

1. Install Ollama:
   ```bash
   # macOS
   brew install ollama
   
   # Or download from https://ollama.ai
   ```

2. Start Ollama:
   ```bash
   ollama serve
   ```

3. Pull the model:
   ```bash
   ollama pull qwen2.5-coder:7b
   ```

4. Deploy with local overlay:
   ```bash
   # The default local overlay already uses Ollama
   # No additional configuration needed!
   ```

### Configuration (Already Set in Local Overlay)

```yaml
STIGMER_LLM_PROVIDER: ollama
STIGMER_LLM_MODEL: qwen2.5-coder:7b
STIGMER_LLM_BASE_URL: http://localhost:11434
STIGMER_LLM_MAX_TOKENS: "8192"
STIGMER_LLM_TEMPERATURE: "0.0"
# No API key needed!
```

---

## Option 2: OpenAI (Requires API Key)

**Use if you have an OpenAI API key and want to use GPT-4/GPT-4 Turbo locally.**

### Setup

1. Get your OpenAI API key from https://platform.openai.com/api-keys

2. Update `overlays/local/service.yaml`:
   ```yaml
   variables:
     # ... other variables ...
     
     # LLM Configuration - Override for OpenAI
     STIGMER_LLM_PROVIDER:
       value: openai
     STIGMER_LLM_MODEL:
       value: gpt-4  # or gpt-4-turbo, gpt-3.5-turbo
     
   secrets:
     # Add API key
     STIGMER_LLM_API_KEY:
       value: sk-...your-openai-key...
   ```

3. Deploy with local overlay

### Alternative: Environment Variable

Instead of modifying the overlay, you can set an environment variable:

```bash
export STIGMER_LLM_PROVIDER=openai
export STIGMER_LLM_MODEL=gpt-4
export STIGMER_LLM_API_KEY=sk-...your-openai-key...
```

---

## Option 3: Anthropic (Requires API Key)

**Use if you have an Anthropic API key and want to use Claude locally.**

### Setup

1. Get your Anthropic API key from https://console.anthropic.com/

2. Update `overlays/local/service.yaml`:
   ```yaml
   variables:
     # ... other variables ...
     
     # LLM Configuration - Override for Anthropic
     STIGMER_LLM_PROVIDER:
       value: anthropic
     STIGMER_LLM_MODEL:
       value: claude-sonnet-4.5  # or claude-opus-4, claude-haiku-4
     
   secrets:
     # Add API key
     STIGMER_LLM_API_KEY:
       value: sk-ant-...your-anthropic-key...
   ```

3. Deploy with local overlay

### Alternative: Environment Variable

```bash
export STIGMER_LLM_PROVIDER=anthropic
export STIGMER_LLM_MODEL=claude-sonnet-4.5
export STIGMER_LLM_API_KEY=sk-ant-...your-anthropic-key...
```

---

## Comparison

| Provider | Cost | Speed | Quality | Setup Complexity |
|----------|------|-------|---------|------------------|
| **Ollama** | Free | Fast (local) | Good | Low (just install) |
| **OpenAI** | Paid ($) | Medium (API) | Excellent | Low (just API key) |
| **Anthropic** | Paid ($$) | Medium (API) | Excellent | Low (just API key) |

---

## Configuration Reference

### Required Environment Variables

| Variable | Type | Ollama | OpenAI | Anthropic |
|----------|------|--------|--------|-----------|
| `STIGMER_LLM_PROVIDER` | String | `ollama` | `openai` | `anthropic` |
| `STIGMER_LLM_MODEL` | String | `qwen2.5-coder:7b` | `gpt-4` | `claude-sonnet-4.5` |
| `STIGMER_LLM_API_KEY` | Secret | Not needed | Required | Required |
| `STIGMER_LLM_BASE_URL` | String | `http://localhost:11434` | Not needed | Not needed |
| `STIGMER_LLM_MAX_TOKENS` | Integer | `8192` | Auto | Auto |
| `STIGMER_LLM_TEMPERATURE` | Float | `0.0` | Optional | Optional |

### Model Options

**Ollama** (install via `ollama pull <model>`):
- `qwen2.5-coder:7b` - Fast, code-focused (recommended)
- `llama3.2:3b` - Very fast, smaller
- `deepseek-coder-v2:16b` - Slower, more capable
- `codellama:13b` - Good balance

**OpenAI**:
- `gpt-4` - Most capable
- `gpt-4-turbo` - Faster, cheaper
- `gpt-3.5-turbo` - Fast, inexpensive

**Anthropic**:
- `claude-opus-4` - Most capable
- `claude-sonnet-4.5` - Balanced (recommended)
- `claude-haiku-4` - Fastest, cheapest

---

## Using secrets-group References (Advanced)

If you want to avoid putting API keys in your local overlay file, you can create a personal secrets group:

### 1. Create Personal Secrets Group

In stigmer-cloud repo:

```yaml
# _ops/planton/service-hub/secrets-group/personal-openai.yaml
apiVersion: service-hub.planton.ai/v1
kind: SecretsGroup
metadata:
  name: personal-openai
  org: stigmer
spec:
  description: Personal OpenAI credentials for local dev
  entries:
    - name: local.api-key
      value: sk-...your-key...
```

### 2. Reference in Local Overlay

```yaml
secrets:
  STIGMER_LLM_API_KEY:
    value: $secrets-group/personal-openai/local.api-key
```

This keeps your API key out of the OSS repo.

---

## Troubleshooting

### Ollama Not Running

**Error**: `Failed to connect to Ollama at http://localhost:11434`

**Solution**:
```bash
# Start Ollama
ollama serve

# Verify it's running
curl http://localhost:11434/api/tags
```

### Model Not Pulled

**Error**: `Model 'qwen2.5-coder:7b' not found`

**Solution**:
```bash
# Pull the model
ollama pull qwen2.5-coder:7b

# Verify
ollama list
```

### Invalid API Key

**Error**: `401 Unauthorized` or `Invalid API key`

**Solution**:
- Verify your API key is correct
- Check for extra spaces or quotes in the key
- Ensure the key hasn't expired
- For OpenAI: Check https://platform.openai.com/api-keys
- For Anthropic: Check https://console.anthropic.com/

### Wrong Model Name

**Error**: `Model 'gpt4' not found` (missing dash)

**Solution**: Use correct model names:
- ✅ `gpt-4` (with dash)
- ❌ `gpt4` (no dash)
- ✅ `claude-sonnet-4.5`
- ❌ `claude-sonnet-4` (missing .5)

---

## Best Practices

1. **Use Ollama for most development**: It's free, fast, and works offline
2. **Use cloud providers for testing prod-like behavior**: Test with the same model that production uses
3. **Never commit API keys**: Always use environment variables or secrets-group references
4. **Test with multiple providers**: Ensure your code works with different LLMs
5. **Monitor costs**: Cloud LLMs can get expensive with high token usage

---

## Examples

### Quick Start with Ollama

```bash
# 1. Install and start Ollama
brew install ollama
ollama serve

# 2. Pull model
ollama pull qwen2.5-coder:7b

# 3. Deploy agent-runner
# (default local overlay already uses Ollama)

# 4. Test
# Your agents will now use local Ollama!
```

### Switch to OpenAI for Testing

```bash
# Set environment variables (temporary override)
export STIGMER_LLM_PROVIDER=openai
export STIGMER_LLM_MODEL=gpt-4
export STIGMER_LLM_API_KEY=sk-...

# Deploy and test
# Your agents will now use OpenAI
```

### Switch Back to Ollama

```bash
# Unset overrides
unset STIGMER_LLM_PROVIDER
unset STIGMER_LLM_MODEL
unset STIGMER_LLM_API_KEY

# Deploy
# Back to local Ollama (default)
```

---

## CLI Configuration Reference

### Configuration File

**Location**: `~/.stigmer/config.yaml`

**Full Schema**:

```yaml
backend:
  type: local  # or "cloud"
  local:
    endpoint: localhost:50051
    data_dir: ~/.stigmer/data
    
    # LLM Configuration
    llm:
      provider: ollama  # "ollama", "anthropic", "openai"
      model: qwen2.5-coder:7b
      base_url: http://localhost:11434
    
    # Temporal Configuration
    temporal:
      managed: true  # Auto-download and manage Temporal
      version: 1.25.1
      port: 7233
      # For external Temporal (when managed: false):
      # address: temporal.example.com:7233
```

### Environment Variable Overrides

Environment variables take precedence over config file settings:

| Env Var | Overrides | Example |
|---------|-----------|---------|
| `STIGMER_LLM_PROVIDER` | `backend.local.llm.provider` | `ollama`, `anthropic`, `openai` |
| `STIGMER_LLM_MODEL` | `backend.local.llm.model` | `qwen2.5-coder:7b`, `claude-sonnet-4.5` |
| `STIGMER_LLM_BASE_URL` | `backend.local.llm.base_url` | `http://localhost:11434` |
| `ANTHROPIC_API_KEY` | API key for Anthropic | `sk-ant-api-...` |
| `OPENAI_API_KEY` | API key for OpenAI | `sk-...` |
| `TEMPORAL_SERVICE_ADDRESS` | Temporal address (disables managed) | `my-temporal:7233` |

### Configuration Cascade

**Priority order** (highest to lowest):

1. **Environment variables** - Explicit user override
2. **Config file** (`~/.stigmer/config.yaml`)
3. **Smart defaults** - Provider-specific defaults

### Provider-Specific Defaults

**Ollama**:
- Model: `qwen2.5-coder:7b`
- Base URL: `http://localhost:11434`
- API Key: Not required

**Anthropic**:
- Model: `claude-sonnet-4.5`
- Base URL: `https://api.anthropic.com`
- API Key: Required (prompted on start if not set)

**OpenAI**:
- Model: `gpt-4`
- Base URL: `https://api.openai.com/v1`
- API Key: Required (prompted on start if not set)

### Common Workflows

#### First Time Setup

```bash
# Initialize Stigmer (creates config, downloads Temporal)
$ stigmer init

# Start daemon (uses defaults: Ollama + managed Temporal)
$ stigmer local start
```

#### Switch to Anthropic (via config file)

```bash
# Edit config
$ cat ~/.stigmer/config.yaml
backend:
  local:
    llm:
      provider: anthropic
      model: claude-sonnet-4.5

# Restart daemon
$ stigmer local restart
Enter Anthropic API key: [enter your key]
```

#### Switch to Anthropic (via env vars)

```bash
export STIGMER_LLM_PROVIDER=anthropic
export ANTHROPIC_API_KEY=sk-ant-...

stigmer local restart
# Uses Anthropic without prompting
```

#### Use External Temporal

```bash
# Via config file
$ cat ~/.stigmer/config.yaml
backend:
  local:
    temporal:
      managed: false
      address: my-temporal.example.com:7233

# Or via env var
$ export TEMPORAL_SERVICE_ADDRESS=my-temporal:7233
$ stigmer local start
```

#### Check Current Configuration

```bash
$ stigmer local status
Daemon Status:
─────────────────────────────────────
  Status:   ✓ Running
  PID:      12345
  Port:     50051
  Data:     ~/.stigmer/data

Configuration:
  LLM:      anthropic (claude-sonnet-4.5)
  Temporal: Managed (running on port 7233)
```

#### Reset to Defaults

```bash
# Remove config file
$ rm ~/.stigmer/config.yaml

# Re-initialize
$ stigmer init

# Restart
$ stigmer local start
# Back to Ollama + managed Temporal
```

### Managed Temporal

**What it does**:
- Auto-downloads Temporal CLI binary on first run
- Starts Temporal dev server as a subprocess
- Manages lifecycle (start/stop with daemon)
- Stores data in `~/.stigmer/temporal-data`

**Disable managed Temporal**:

```yaml
backend:
  local:
    temporal:
      managed: false
      address: localhost:7233  # Your external Temporal
```

**Binary location**: `~/.stigmer/bin/temporal`

**Data location**: `~/.stigmer/temporal-data/`

**Logs**: `~/.stigmer/logs/temporal.log`

### Troubleshooting CLI

#### Config not loading

```bash
# Verify config file exists and is valid YAML
$ cat ~/.stigmer/config.yaml

# Check for syntax errors
$ stigmer local status
```

#### Temporal download fails

```bash
# Check internet connection
# Check GitHub releases page: https://github.com/temporalio/cli/releases

# Manual download
$ mkdir -p ~/.stigmer/bin
$ # Download appropriate binary for your OS/arch
$ chmod +x ~/.stigmer/bin/temporal
```

#### Wrong provider being used

```bash
# Check for environment variable overrides
$ env | grep STIGMER_LLM

# Unset overrides
$ unset STIGMER_LLM_PROVIDER
$ unset STIGMER_LLM_MODEL

# Restart daemon
$ stigmer local restart
```

#### API key not persisting

Environment variables are not saved - they're temporary. To persist:

**Option 1**: Add to shell profile
```bash
# ~/.zshrc or ~/.bashrc
export ANTHROPIC_API_KEY=sk-ant-...
```

**Option 2**: Use config file (less secure, not recommended)

---

## Production Configuration

Production uses Anthropic by default, configured in `overlays/prod/service.yaml`.

To change the production provider, update the prod overlay (requires secrets-group access).

See: `stigmer-cloud/_docs/llm-configuration-setup.md` for production configuration details.
