# Local LLM Configuration Guide

This guide shows how to configure the agent-runner for different LLM providers in local development.

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

## Production Configuration

Production uses Anthropic by default, configured in `overlays/prod/service.yaml`.

To change the production provider, update the prod overlay (requires secrets-group access).

See: `stigmer-cloud/_docs/llm-configuration-setup.md` for production configuration details.
