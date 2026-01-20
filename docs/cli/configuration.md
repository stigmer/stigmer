# Stigmer CLI Configuration Guide

This guide explains all available configuration options for the Stigmer CLI.

Configuration file location: `~/.stigmer/config.yaml`

## Quick Start

The CLI auto-generates a default configuration on first run. For most users, **no manual configuration is needed** - just run `stigmer server` and it works!

## Configuration Structure

```yaml
backend:
    type: local  # or "cloud"
    local:
        # LLM provider configuration
        llm:
            provider: ollama
            model: qwen2.5-coder:7b
            base_url: http://localhost:11434
        
        # Temporal workflow engine configuration
        temporal:
            managed: true
            version: 1.5.1
            port: 7233
```

---

## Backend Types

### `backend.type`

Determines where your agents and workflows are stored.

| Type | Description | Use Case |
|------|-------------|----------|
| `local` | Local daemon on your machine | Development, personal use |
| `cloud` | Stigmer Cloud service | Team collaboration, production |

**Default**: `local`

**Example**:
```yaml
backend:
    type: local
```

---

## Local Backend Configuration

### Infrastructure Settings (Not Configurable)

These are **managed by the CLI** and cannot be configured:

| Setting | Value | Location |
|---------|-------|----------|
| **Endpoint** | `localhost:7234` | Hardcoded in CLI |
| **Data Directory** | `~/.stigmer/data` | Hardcoded in CLI |

*Note: If you need a custom data directory, use a symlink:*
```bash
ln -s /path/to/custom/location ~/.stigmer/data
```

### LLM Provider Configuration

The CLI supports three LLM providers for running agents.

---

#### Option 1: Ollama (Default - No API Key Required)

**Best for**: Local development, privacy, offline usage

**Configuration**:
```yaml
backend:
    local:
        llm:
            provider: ollama
            model: qwen2.5-coder:7b
            base_url: http://localhost:11434
```

**Setup**:
1. Install Ollama: https://ollama.ai
2. Pull a model:
   ```bash
   ollama pull qwen2.5-coder:7b
   ```
3. Start Ollama (runs automatically on macOS/Linux)

**Supported Models**:
- `qwen2.5-coder:7b` (Default - good balance of speed/quality)
- `qwen2.5-coder:14b` (Better quality, slower)
- `deepseek-coder:6.7b` (Fast, code-focused)
- `codestral:latest` (Mistral's code model)
- `llama3.1:8b` (General purpose)

**Configuration Options**:
```yaml
llm:
    provider: ollama
    model: qwen2.5-coder:7b        # Any model from ollama.ai/library
    base_url: http://localhost:11434  # Ollama server URL
```

---

#### Option 2: Anthropic Claude

**Best for**: Production agents, high-quality reasoning, function calling

**Configuration**:
```yaml
backend:
    local:
        llm:
            provider: anthropic
            model: claude-sonnet-4.5
            api_key: sk-ant-api03-...  # Your API key
```

**Setup**:
1. Get API key: https://console.anthropic.com/
2. **Option A**: Put API key in config (shown above)
3. **Option B**: Use environment variable (higher priority):
   ```bash
   export ANTHROPIC_API_KEY="sk-ant-..."
   ```

**Note**: Environment variable takes precedence over config file.

**Supported Models**:
- `claude-sonnet-4.5` (Default - best balance)
- `claude-opus-4` (Highest quality, slower, expensive)
- `claude-sonnet-3.5` (Previous generation)
- `claude-haiku-3.5` (Fastest, cheapest)

**Configuration Options**:
```yaml
llm:
    provider: anthropic
    model: claude-sonnet-4.5  # Or claude-opus-4, claude-haiku-3.5
    api_key: sk-ant-api03-...  # Put key here, or use env var
```

**Environment Variable** (optional, takes precedence over config):
```bash
export ANTHROPIC_API_KEY="sk-ant-api03-..."
```

---

#### Option 3: OpenAI

**Best for**: GPT-4 usage, Azure OpenAI compatibility

**Configuration**:
```yaml
backend:
    local:
        llm:
            provider: openai
            model: gpt-4
            api_key: sk-proj-...  # Your API key
```

**Setup**:
1. Get API key: https://platform.openai.com/api-keys
2. **Option A**: Put API key in config (shown above)
3. **Option B**: Use environment variable (higher priority):
   ```bash
   export OPENAI_API_KEY="sk-..."
   ```

**Note**: Environment variable takes precedence over config file.

**Supported Models**:
- `gpt-4` (Default - balanced)
- `gpt-4-turbo` (Faster, cheaper)
- `gpt-4o` (Latest, multimodal)
- `gpt-3.5-turbo` (Fastest, cheapest)

**Configuration Options**:
```yaml
llm:
    provider: openai
    model: gpt-4  # Or gpt-4-turbo, gpt-4o, gpt-3.5-turbo
    api_key: sk-proj-...  # Put key here, or use env var
```

**Environment Variable** (optional, takes precedence over config):
```bash
export OPENAI_API_KEY="sk-..."
```

**Azure OpenAI Example**:
```yaml
llm:
    provider: openai
    model: gpt-4
    api_key: your-azure-api-key  # Azure key
    base_url: https://your-resource.openai.azure.com/openai/deployments/your-deployment
```

**Note**: `base_url` is only needed for Azure OpenAI or custom endpoints.

---

### Temporal Configuration

Temporal is the workflow engine that runs your workflows and agent executions.

#### Option 1: Managed Temporal (Default - Zero Config)

**Best for**: Most users, local development

The CLI automatically downloads, installs, and manages Temporal for you.

**Configuration**:
```yaml
backend:
    local:
        temporal:
            managed: true  # That's it!
```

**What happens**:
1. First run: CLI downloads Temporal CLI binary (version 1.5.1)
2. Start: CLI starts Temporal server on port 7233 automatically
3. Stop: CLI stops Temporal when daemon stops
4. No manual setup needed!

**Managed Infrastructure** (not configurable):
- **Version**: Always 1.5.1 (tested and verified)
- **Port**: Always 7233 (standard Temporal port)

These are hardcoded to prevent configuration errors. CLI manages this infrastructure for you.

---

#### Option 2: External Temporal Server

**Best for**: Production deployments, shared Temporal cluster

Use an external Temporal server (self-hosted or Temporal Cloud).

**Configuration**:
```yaml
backend:
    local:
        temporal:
            managed: false
            address: temporal.example.com:7233
```

**Configuration Options**:
```yaml
temporal:
    managed: false                          # Don't manage Temporal
    address: temporal.example.com:7233      # External Temporal server address
```

**Examples**:

**Self-hosted Temporal**:
```yaml
temporal:
    managed: false
    address: localhost:7233  # Your Temporal server
```

**Temporal Cloud**:
```yaml
temporal:
    managed: false
    address: my-namespace.tmprl.cloud:7233
```

**Environment Variable Override**:
```bash
export TEMPORAL_SERVICE_ADDRESS="temporal.example.com:7233"
# This overrides config and forces external mode
```

---

## Cloud Backend Configuration

*Coming soon: Documentation for Stigmer Cloud backend*

---

## Configuration Precedence

Settings are resolved in this order (highest to lowest priority):

1. **Environment variables** (highest priority)
2. **Config file** (`~/.stigmer/config.yaml`)
3. **Default values** (lowest priority)

### Environment Variable Overrides

You can override any config setting with environment variables:

| Config Setting | Environment Variable |
|---------------|---------------------|
| LLM Provider | `STIGMER_LLM_PROVIDER` |
| LLM Model | `STIGMER_LLM_MODEL` |
| LLM Base URL | `STIGMER_LLM_BASE_URL` |
| Temporal Address | `TEMPORAL_SERVICE_ADDRESS` |
| Anthropic API Key | `ANTHROPIC_API_KEY` |
| OpenAI API Key | `OPENAI_API_KEY` |

**Example**:
```bash
# Temporarily use different model without changing config
export STIGMER_LLM_MODEL="claude-opus-4"
stigmer apply
```

---

## Complete Configuration Examples

### Example 1: Default (Ollama + Managed Temporal)

```yaml
backend:
    type: local
    local:
        llm:
            provider: ollama
            model: qwen2.5-coder:7b
            base_url: http://localhost:11434
        temporal:
            managed: true
```

**Use case**: Local development, no API keys needed

**Note**: Temporal version (1.5.1) and port (7233) are hardcoded - not shown in config.

---

### Example 2: Anthropic Claude + Managed Temporal

```yaml
backend:
    type: local
    local:
        llm:
            provider: anthropic
            model: claude-sonnet-4.5
            api_key: sk-ant-api03-...  # Your Anthropic API key
        temporal:
            managed: true
```

**Use case**: High-quality agents with managed infrastructure

**Note**: You can use environment variable instead: `export ANTHROPIC_API_KEY="sk-ant-..."`

---

### Example 3: OpenAI + External Temporal

```yaml
backend:
    type: local
    local:
        llm:
            provider: openai
            model: gpt-4-turbo
            api_key: sk-proj-...  # Your OpenAI API key
        temporal:
            managed: false
            address: temporal.prod.example.com:7233
```

**Use case**: Production setup with shared Temporal cluster

**Note**: You can use environment variable instead: `export OPENAI_API_KEY="sk-..."`

---

### Example 4: Minimal (All Defaults)

```yaml
backend:
    type: local
    local:
        llm:
            provider: ollama
            model: qwen2.5-coder:7b
        temporal:
            managed: true
```

**Use case**: Keep config minimal, use all defaults

**Hardcoded defaults** (not shown in config):
- Temporal version: 1.5.1
- Temporal port: 7233
- Stigmer endpoint: localhost:7234
- Data directory: ~/.stigmer/data

---

## Switching LLM Providers

To switch providers, update the config and set required API keys:

### From Ollama → Anthropic

1. Update config:
   ```yaml
   llm:
       provider: anthropic
       model: claude-sonnet-4.5
   ```

2. Set API key:
   ```bash
   export ANTHROPIC_API_KEY="sk-ant-..."
   ```

3. Restart daemon:
   ```bash
   stigmer server restart
   ```

### From Anthropic → OpenAI

1. Update config:
   ```yaml
   llm:
       provider: openai
       model: gpt-4
   ```

2. Set API key:
   ```bash
   export OPENAI_API_KEY="sk-..."
   ```

3. Restart daemon:
   ```bash
   stigmer server restart
   ```

---

## Troubleshooting

### "Cannot connect to Ollama"

**Problem**: Ollama is not running

**Solution**:
```bash
# Install Ollama
brew install ollama  # macOS
# or download from https://ollama.ai

# Pull a model
ollama pull qwen2.5-coder:7b

# Verify Ollama is running
ollama list
```

### "ANTHROPIC_API_KEY not set"

**Problem**: Missing Anthropic API key

**Solution**:
```bash
export ANTHROPIC_API_KEY="sk-ant-..."
# Add to ~/.zshrc or ~/.bashrc to persist
```

### "OPENAI_API_KEY not set"

**Problem**: Missing OpenAI API key

**Solution**:
```bash
export OPENAI_API_KEY="sk-..."
# Add to ~/.zshrc or ~/.bashrc to persist
```

### "Cannot connect to Temporal"

**Problem**: External Temporal server not reachable

**Solution**:
1. Verify Temporal address is correct
2. Check network connectivity
3. Or switch to managed mode:
   ```yaml
   temporal:
       managed: true
   ```

---

## Advanced Configuration

### Custom Ollama Instance

If running Ollama on a different machine:

```yaml
llm:
    provider: ollama
    model: qwen2.5-coder:7b
    base_url: http://192.168.1.100:11434
```

### Custom Temporal Port

If you need Temporal on a different port:

```yaml
temporal:
    managed: true
    port: 8233  # Custom port
```

*Note: Stigmer daemon will still use port 7234*

---

## Security Considerations

### API Keys in Config vs Environment Variables

You can put API keys in **either** location:

**Option 1: Config file** (convenient):
```yaml
llm:
    provider: anthropic
    api_key: sk-ant-...
```

**Option 2: Environment variable** (more secure for shared machines):
```bash
export ANTHROPIC_API_KEY="sk-ant-..."
```

**Precedence**: Environment variable > Config file

### ⚠️ Security Warning

- Config file has restricted permissions (0600 - owner only)
- **DO NOT** commit config with API keys to git
- Add `config.yaml` to `.gitignore` if sharing code
- Rotate keys immediately if accidentally exposed

**Recommended**: Use environment variables on shared/production systems.

## Configuration Best Practices

### ✅ Do

- Keep config file minimal - only set what you need to change
- Use environment variables for API keys on shared systems
- Use managed Temporal for local development
- Add config.yaml to .gitignore if your project is versioned

### ❌ Don't

- Don't commit config file with API keys to git repositories
- Don't try to change `endpoint` or `data_dir` (managed by CLI)
- Don't share config files containing API keys
- Don't use external Temporal unless you need it

---

## Getting Help

- **Documentation**: https://github.com/stigmer/stigmer/docs
- **Issues**: https://github.com/stigmer/stigmer/issues
- **Discussions**: https://github.com/stigmer/stigmer/discussions

---

**Last Updated**: 2025-01-20
