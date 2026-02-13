# Centralized Model Name Resolution via ModelRegistry

**Date**: February 13, 2026

## Summary

Consolidated model name resolution into `ModelRegistry` as the single source of truth, eliminating duplicate mappings and ensuring correct API model IDs are sent to LLM providers. Users can now use platform-friendly names like `claude-sonnet-4.5` while the agent-runner automatically resolves them to actual API identifiers like `claude-sonnet-4-5-20250929`.

## Problem Statement

The platform had fragmented model name handling across multiple locations, creating maintenance burden and potential for errors:

### Pain Points

- **Duplicate mappings**: `models.py` had `ANTHROPIC_MODEL_MAP` but `agent-runner` didn't use it, passing raw model names to LangChain
- **No API ID tracking**: `ModelRegistry` had metadata for friendly names but didn't know the actual API model IDs
- **User confusion**: Users had to know cryptic API identifiers like `claude-sonnet-4-5-20250929` instead of friendly `claude-sonnet-4.5`
- **Inconsistent resolution**: Different code paths handled model names differently
- **Language silos**: Python had mappings but Go CLI couldn't access them
- **Maintenance overhead**: Adding a new model required updates in multiple places

## Solution

Centralized all model name resolution in `ModelRegistry` with a three-tier resolution strategy:

1. **Platform Alias** (user-friendly): `claude-sonnet-4.5`
2. **API Model ID** (provider-specific): `claude-sonnet-4-5-20250929`
3. **Resolution Logic**: Automatic mapping with fallback support

## Implementation Details

### 1. Enhanced ModelMetadata

Added `api_model_id` field to track the actual API identifier:

```python
@dataclass(frozen=True, slots=True)
class ModelMetadata:
    model_id: str              # Platform alias: "claude-sonnet-4.5"
    api_model_id: str | None   # API ID: "claude-sonnet-4-5-20250929"
    # ... other fields
    
    def get_api_model_id(self) -> str:
        """Returns api_model_id if set, otherwise model_id."""
        return self.api_model_id if self.api_model_id is not None else self.model_id
```

### 2. Updated Model Entries

All Anthropic models now have proper API ID mappings:

| Platform ID | API Model ID |
|-------------|--------------|
| `claude-sonnet-4.5` | `claude-sonnet-4-5-20250929` |
| `claude-opus-4` | `claude-opus-4-20250514` |
| `claude-haiku-4` | `claude-haiku-4-20250313` |
| `claude-sonnet-3.5` | `claude-3-5-sonnet-20241022` |
| `claude-haiku-3.5` | `claude-3-5-haiku-20241022` |

OpenAI and Ollama models use `api_model_id=None` since their platform aliases match API identifiers.

### 3. Resolution Methods

Added two resolution methods to `ModelRegistry`:

#### `resolve(user_input) -> tuple[str, ModelMetadata]`

Strict resolution with three-tier priority:
1. Exact match on `model_id` (e.g., `claude-sonnet-4.5`)
2. Exact match on `api_model_id` (e.g., `claude-sonnet-4-5-20250929`)
3. Case-insensitive match on `model_id` (e.g., `Claude-Sonnet-4.5`)

Raises `KeyError` if no match found.

#### `resolve_or_passthrough(user_input, provider) -> tuple[str, ModelMetadata]`

Graceful resolution with fallback:
- Returns resolved model for known models
- Passes through unknown models with conservative default metadata
- Useful for custom/unlisted models

### 4. Agent-Runner Integration

Updated `execute_graphton.py` to use resolution before creating LLM instances:

```python
# Resolve model name to API model ID
api_model_id, resolved_metadata = ModelRegistry.resolve_or_passthrough(
    model_name,
    provider=worker_config.llm.provider,
)

if api_model_id != model_name:
    activity_logger.info(
        f"Resolved model '{model_name}' to API model ID '{api_model_id}'"
    )

# Pass resolved API ID to LangChain
llm_model = ChatAnthropic(
    model=api_model_id,  # Now uses correct API identifier
    api_key=worker_config.llm.api_key,
)
```

### 5. Refactored models.py

Eliminated duplicate mappings and delegated to `ModelRegistry`:

- Removed `ANTHROPIC_MODEL_MAP` (now in `ModelRegistry`)
- Updated `parse_model_string()` to call `ModelRegistry.resolve_or_passthrough()`
- Retained Ollama short aliases as local convenience mapping

### 6. Comprehensive Tests

Added 30+ unit tests covering:
- `ModelMetadata.get_api_model_id()` for all model types
- `ModelRegistry.resolve()` with exact, API ID, and case-insensitive matching
- `ModelRegistry.resolve_or_passthrough()` with known and unknown models
- Edge cases: empty strings, whitespace, uppercase variations

### 7. Documentation Updates

Fixed incorrect model references in scripts:
- `command.sh`: Changed `claude-sonnet-4-20250514` → `claude-sonnet-4.5`

## Benefits

### For Users
- **Simpler model names**: Use `claude-sonnet-4.5` instead of `claude-sonnet-4-5-20250929`
- **Case-insensitive**: `Claude-Sonnet-4.5` works just as well
- **Clear errors**: Helpful messages when model names are invalid
- **Discoverability**: Future CLI commands can list available models

### For Developers
- **Single source of truth**: All model metadata in one place
- **No duplicate mappings**: One place to add new models
- **Type-safe resolution**: Returns both API ID and metadata
- **Graceful fallback**: Unknown models work with conservative defaults

### For Operations
- **Correct API calls**: Eliminates risk of wrong model IDs
- **Better logging**: Shows when resolution occurs
- **Maintainability**: Adding models is a single-file change

## Impact

### Affected Components
- **agent-runner**: Now resolves all model names before LLM instantiation
- **graphton**: `parse_model_string()` uses centralized resolution
- **ModelRegistry**: Expanded responsibility to include name resolution

### Breaking Changes
None - this is backward compatible. The resolution is transparent to existing code.

### Performance
Negligible impact - resolution is a fast O(n) dictionary lookup where n ≤ 20 models.

### Future Extensibility
This foundation enables:
- CLI command: `stigmer models list` to show available models
- Tab completion for `--model` flags in CLI
- API endpoint: `GET /v1/models` for UI discoverability
- YAML extraction if Go CLI needs offline resolution

## Related Work

### Previous Issues
- Model name confusion in early testing
- Agent-runner passing incorrect model IDs to Anthropic
- Duplicate maintenance of `ANTHROPIC_MODEL_MAP` and `ModelRegistry`

### Related Changelogs
- 2026-01-31: Model Registry foundation (established metadata structure)
- Future: CLI model listing command (depends on this work)

### Technical Debt Eliminated
- Removed duplicate `ANTHROPIC_MODEL_MAP` from `models.py`
- Consolidated model knowledge in `ModelRegistry`
- Fixed incorrect model reference in `command.sh`

---

**Status**: ✅ Production Ready

**Timeline**: Single session implementation with comprehensive tests

**Files Changed**:
- `backend/libs/python/graphton/src/graphton/core/model_registry.py` (+159 lines)
- `backend/services/agent-runner/worker/activities/execute_graphton.py` (+18 lines)
- `backend/libs/python/graphton/src/graphton/core/models.py` (refactored)
- `backend/libs/python/graphton/tests/core/test_model_registry.py` (+188 lines)
- `backend/libs/go/seedpack/drafts/agent-drafter/command.sh` (fixed)
