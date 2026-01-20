# Fix CLI Configuration Architecture - Hardcode Managed Infrastructure

**Date**: 2026-01-20
**Type**: Fix (Architecture)
**Scope**: CLI Configuration, Daemon Management
**Impact**: High - Prevents misconfiguration, improves UX

## Summary

Fixed fundamental architectural flaws in CLI configuration by applying the principle: **"If the CLI manages the infrastructure, don't make it configurable."**

Hardcoded all managed infrastructure settings (endpoint, data directory, Temporal version/port) to prevent user misconfiguration. Added comprehensive configuration documentation with clean examples. Improved API key handling for convenience.

## Problem

Multiple configuration fields allowed users to "configure" infrastructure that the CLI actually manages, creating potential for misconfiguration and data loss:

### Issue 1: Misleading Connection Success Message
- `grpc.DialContext()` doesn't actually connect - creates connection object only
- Real connection happens on first RPC call
- CLI showed "✓ Connected to backend" before verifying server was reachable
- Users saw success message followed by "Cannot connect" error - confusing!

### Issue 2: Endpoint Configurable (But Ignored by Daemon)
- Config allowed: `endpoint: localhost:XXXX`
- Daemon manager hardcoded: `GRPC_PORT=7234`
- User could change config → CLI connects to wrong port → connection fails
- Daemon and CLI could be looking at different ports

### Issue 3: Data Directory Configurable (Risk of Data Loss)
- Config allowed: `data_dir: /some/path`
- If user changed it:
  - Daemon keeps running at old location with all data
  - CLI looks for daemon at new location (PID file not found)
  - Tries to start second daemon → port conflict or data loss
- No data migration - data effectively "lost"

### Issue 4: Temporal Version/Port Configurable
- Config allowed: `version: 1.2.0`, `port: 9999`
- If user changed version → might break (untested version)
- If user changed port → workers can't find Temporal (hardcoded to 7233)

### Issue 5: API Keys Only in Environment Variables
- Required `export ANTHROPIC_API_KEY=...` separately
- Extra step, not persisted across sessions
- Less convenient than config file

### Issue 6: Confusing base_url in Examples
- Showed `base_url` for Anthropic/OpenAI when not needed
- Users shouldn't configure standard service URLs

## Solution

Applied consistent architectural principle across all managed settings.

### Fix 1: Add Connection Verification ✅

**File**: `client-apps/cli/internal/cli/backend/client.go`

Added `verifyConnection()` method that makes actual RPC call after creating connection:

```go
func (c *Client) verifyConnection(ctx context.Context) error {
    // Make lightweight RPC call to verify server is reachable
    ref := &apiresource.ApiResourceReference{}
    _, err := c.agentQuery.GetByReference(ctx, ref)
    
    // NotFound/InvalidArgument = server up (expected for empty ref)
    // Unavailable = server not running
    if err != nil {
        if st, ok := status.FromError(err); ok {
            if st.Code() != codes.NotFound && st.Code() != codes.InvalidArgument {
                return errors.Wrapf(err, "server not reachable at %s", c.endpoint)
            }
        }
    }
    return nil
}
```

**Modified** `Connect()` to call `verifyConnection()` before showing success:
- If verification fails → closes connection, returns error immediately
- Only shows "✓ Connected to backend" when server actually responds

**Impact**: No more false "Connected" messages. Errors happen immediately during connection phase.

### Fix 2: Hardcode Endpoint for Local Mode ✅

**File**: `client-apps/cli/internal/cli/backend/client.go`

```go
case config.BackendTypeLocal:
    // Always use hardcoded port 7234 (daemon manager controls this)
    // Endpoint is not configurable for local mode - CLI manages the daemon
    endpoint = "localhost:7234" // Ignores config value
```

**File**: `internal/cli/config/config.go`

```go
type LocalBackendConfig struct {
    Endpoint string `yaml:"endpoint,omitempty"` // DEPRECATED: Not used
    ...
}
```

Removed from `GetDefault()` and `backend set` command.

**Impact**: Users cannot misconfigure endpoint. Always connects to correct port.

### Fix 3: Hardcode Data Directory ✅

**File**: `cmd/stigmer/root/apply.go`

```go
// Always use hardcoded data directory - not configurable
dataDir, err := config.GetDataDir()  // Ignores config value
```

**File**: `internal/cli/config/config.go`

```go
type LocalBackendConfig struct {
    DataDir string `yaml:"data_dir,omitempty"` // DEPRECATED: Not used
    ...
}
```

**Impact**: Users cannot change data directory and orphan their data. Always uses `~/.stigmer/data`.

### Fix 4: Hardcode Temporal Version and Port ✅

**File**: `internal/cli/config/config.go`

```go
// ResolveTemporalVersion - Always returns tested version
func (c *LocalBackendConfig) ResolveTemporalVersion() string {
    // Ignore config value - use hardcoded tested version
    return "1.5.1"
}

// ResolveTemporalPort - Always returns standard port
func (c *LocalBackendConfig) ResolveTemporalPort() int {
    // Ignore config value - use standard Temporal port
    return 7233
}
```

```go
type TemporalConfig struct {
    Managed bool   `yaml:"managed"`
    Version string `yaml:"version,omitempty"` // DEPRECATED: Not used
    Port    int    `yaml:"port,omitempty"`    // DEPRECATED: Not used
    Address string `yaml:"address,omitempty"` // Only for external mode
}
```

**Impact**: Users cannot break Temporal with wrong version/port. Always uses tested defaults.

### Fix 5: Support API Keys in Config ✅

**File**: `internal/cli/config/config.go`

```go
type LLMConfig struct {
    Provider string `yaml:"provider"`
    Model    string `yaml:"model,omitempty"`
    APIKey   string `yaml:"api_key,omitempty"`   // NEW: Optional API key
    BaseURL  string `yaml:"base_url,omitempty"`  // Optional
}

func (c *LocalBackendConfig) ResolveLLMAPIKey() string {
    provider := c.ResolveLLMProvider()
    
    // 1. Check environment variable (highest priority)
    var envKey string
    switch provider {
    case "anthropic":
        envKey = os.Getenv("ANTHROPIC_API_KEY")
    case "openai":
        envKey = os.Getenv("OPENAI_API_KEY")
    }
    if envKey != "" {
        return envKey
    }
    
    // 2. Check config file
    if c.LLM != nil && c.LLM.APIKey != "" {
        return c.LLM.APIKey
    }
    
    return ""
}
```

**Precedence**: Environment variable > Config file

**Impact**: Users can put API keys directly in config for convenience. Still supports env vars for security.

### Fix 6: Clean Configuration Documentation ✅

**File**: `docs/cli/configuration.md` (566 lines)

**Created comprehensive guide covering**:
- All 3 LLM providers (Ollama, Anthropic, OpenAI)
- API key configuration (config file or env var)
- Temporal configuration (managed vs external)
- Complete examples for common scenarios
- Security considerations
- Troubleshooting guide
- Best practices

**Updated config generation** to include documentation link:

```yaml
# Stigmer CLI Configuration
# For configuration options and examples, see:
# https://github.com/stigmer/stigmer/blob/main/docs/cli/configuration.md
```

**Examples now show clean, user-friendly configs**:

```yaml
# Anthropic
llm:
    provider: anthropic
    model: claude-sonnet-4.5
    api_key: sk-ant-...  # Just put it here!

# OpenAI  
llm:
    provider: openai
    model: gpt-4
    api_key: sk-proj-...

# Ollama (no key needed, base_url only shown for Ollama)
llm:
    provider: ollama
    model: qwen2.5-coder:7b
    base_url: http://localhost:11434
```

**Impact**: Users see only what they need to configure. Documentation link provides comprehensive guide.

## Generated Config (New Minimal Format)

```yaml
# Stigmer CLI Configuration
# For configuration options and examples, see:
# https://github.com/stigmer/stigmer/blob/main/docs/cli/configuration.md

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

**Not shown** (hardcoded, not configurable):
- Endpoint: `localhost:7234`
- Data directory: `~/.stigmer/data`
- Temporal version: `1.5.1`
- Temporal port: `7233`

## Files Modified

### CLI Backend (Connection & Config Resolution)
- `client-apps/cli/internal/cli/backend/client.go`
  - Added `verifyConnection()` method with actual RPC call
  - Modified `Connect()` to verify before success message
  - Hardcoded endpoint for local mode (ignores config)
  - Added imports: `google.golang.org/grpc/codes`, `google.golang.org/grpc/status`, apiresource

### CLI Configuration (Structure & Defaults)
- `client-apps/cli/internal/cli/config/config.go`
  - Marked `Endpoint`, `DataDir`, `Version`, `Port` as deprecated
  - Added `APIKey` field to `LLMConfig`
  - Added `ResolveLLMAPIKey()` method (env var > config)
  - Modified `ResolveTemporalVersion()` to ignore config (always 1.5.1)
  - Modified `ResolveTemporalPort()` to ignore config (always 7233)
  - Updated `GetDefault()` to not set deprecated fields
  - Updated `Save()` to add documentation link header

### CLI Commands (Apply & Backend Set)
- `cmd/stigmer/root/apply.go`
  - Modified to always use `config.GetDataDir()` (ignores config)
- `cmd/stigmer/root/backend.go`
  - Removed endpoint/data_dir setting when creating local config

### Documentation
- `docs/cli/configuration.md` (NEW - 566 lines)
  - Complete configuration guide
  - All 3 LLM providers with examples
  - API key configuration (config or env var)
  - Temporal configuration (managed vs external)
  - Security considerations
  - Troubleshooting
  - Best practices

## Architectural Principle

**"Infrastructure the CLI manages ≠ Configuration users set"**

| Setting | Type | Configurable? | Reason |
|---------|------|---------------|--------|
| `endpoint` | Infrastructure | ❌ Hardcoded 7234 | CLI manages daemon |
| `data_dir` | Infrastructure | ❌ Hardcoded ~/.stigmer/data | CLI manages storage |
| `temporal.version` | Infrastructure | ❌ Hardcoded 1.5.1 | CLI manages Temporal |
| `temporal.port` | Infrastructure | ❌ Hardcoded 7233 | CLI manages Temporal |
| `llm.provider` | User Choice | ✅ Configurable | User picks service |
| `llm.model` | User Choice | ✅ Configurable | User picks model |
| `llm.api_key` | User Choice | ✅ Configurable | User provides key |
| `temporal.managed` | User Choice | ✅ Configurable | User picks mode |

## Benefits

### User Experience
- ✅ Cannot misconfigure managed infrastructure
- ✅ Clear error messages (no false "Connected" messages)
- ✅ Simpler configuration (only shows what users control)
- ✅ API keys in config (more convenient)
- ✅ Comprehensive documentation with link in config
- ✅ Clean examples showing only necessary fields

### Reliability
- ✅ Connection verified before success message
- ✅ Endpoint always matches daemon port
- ✅ Data directory always correct (no data loss risk)
- ✅ Temporal version always tested
- ✅ Workers always find Temporal (correct port)

### Maintainability
- ✅ Consistent architectural principle applied
- ✅ Less configuration surface area
- ✅ Backward compatible (old configs work, fields just ignored)
- ✅ Clear separation: infrastructure vs user choices

## Testing

```bash
# Verify config package compiles
cd client-apps/cli
go build ./internal/cli/config/...  # ✅ Compiles

# Verify all CLI packages compile
go build ./...  # ✅ Compiles
```

## Migration Path

**Old configs continue to work**:
- Deprecated fields (endpoint, data_dir, version, port) are ignored
- No manual migration needed
- Next time user runs `stigmer server` or `stigmer backend set local`, config regenerates without deprecated fields

**Fresh installations**:
- Generate clean config automatically
- Only show configurable settings
- Include documentation link

## User-Facing Changes

### Before (Confusing)
```yaml
backend:
    local:
        endpoint: localhost:50051  # Can change, breaks things
        data_dir: /Users/x/.stigmer/data  # Can change, loses data
        llm:
            provider: anthropic
            model: claude-sonnet-4.5
            base_url: https://api.anthropic.com  # Why show this?
        temporal:
            managed: true
            version: 1.5.1  # Can change, might break
            port: 7233  # Can change, breaks workers
```

```bash
# Separate step for API key
export ANTHROPIC_API_KEY="sk-ant-..."
```

### After (Clean)
```yaml
backend:
    local:
        llm:
            provider: anthropic
            model: claude-sonnet-4.5
            api_key: sk-ant-...  # Just put it here!
        temporal:
            managed: true
```

**Hardcoded** (not shown, not configurable):
- Endpoint: localhost:7234
- Data dir: ~/.stigmer/data
- Temporal version: 1.5.1
- Temporal port: 7233

## Documentation Created

**`docs/cli/configuration.md`** - Comprehensive configuration guide:
- Quick start section
- Backend types explanation
- Infrastructure settings (not configurable) section
- LLM provider detailed documentation:
  - Ollama (with supported models list)
  - Anthropic (with API key setup)
  - OpenAI (with API key setup, Azure example)
- Temporal configuration:
  - Managed mode (zero config)
  - External server setup
- Configuration precedence (env var > config > defaults)
- Complete examples (8 scenarios)
- Security considerations
- Troubleshooting guide
- Best practices

**Config generation** updated to include link to documentation.

## Security Considerations

**API keys in config**:
- Config file has 0600 permissions (owner only)
- Environment variables still supported (and take precedence)
- Added security warning in documentation
- Recommendation: Use env vars on shared/production systems

## Backward Compatibility

✅ **Fully backward compatible**:
- Old configs with deprecated fields work (values ignored)
- No breaking changes to APIs
- No database migrations needed
- Users can continue using env vars if preferred

## Related Issues

This fix addresses the root cause of connection errors reported in:
- Error: "Cannot connect to stigmer-server" after showing "Connected"
- Port mismatches between daemon and CLI
- Data directory confusion when users tried custom paths

## Future Work

None required - architecture is now sound.

**Optional enhancements**:
- Environment variable override for data_dir if advanced users request it
- Migration tool if users need to move existing data (rare)

## Learnings

1. **gRPC DialContext is lazy** - doesn't actually connect until first RPC
2. **Configuration != Control** - just because something is in config doesn't mean users should change it
3. **Hardcode managed infrastructure** - prevents misconfiguration
4. **Separate infrastructure from user choices** - clearer mental model
5. **Document defaults explicitly** - users should know what's managed for them

## Conclusion

This fix fundamentally improves the CLI's architecture by applying a consistent principle: **managed infrastructure should not be user-configurable**.

Users can no longer misconfigure the daemon endpoint, lose data by changing directories, or break Temporal with wrong versions/ports. Configuration is simpler, showing only actual user choices. Comprehensive documentation guides users through all supported scenarios.

The CLI now "just works" with sane defaults while providing clear configuration options for the things users actually need to choose (LLM provider, API keys, managed vs external Temporal).

---

**Credits**: All architectural improvements discovered through conversation with user who asked excellent questions:
- "Why is endpoint configurable if CLI controls the daemon?"
- "What happens if user changes data_dir - is data migrated?"
- "Why let users configure Temporal version/port if CLI manages it?"
- "Can't we put API keys in config instead of requiring env vars?"
- "Why show base_url for Anthropic/OpenAI when we know the URLs?"

Each question revealed a design flaw. Applying the same principle consistently across all settings resulted in much cleaner architecture.
