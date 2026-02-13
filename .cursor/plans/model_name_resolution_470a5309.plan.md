---
name: Model Name Resolution
overview: "Consolidate model name resolution into ModelRegistry as the single source of truth, enabling agent-runner to correctly map user-friendly names (like \"claude-sonnet-4.5\") to actual API model IDs (like \"claude-sonnet-4-5-20250929\"). Keep it simple: Python-first approach with future extensibility for CLI."
todos:
  - id: enhance-metadata
    content: Add api_model_id field to ModelMetadata dataclass in model_registry.py
    status: completed
  - id: update-model-entries
    content: Update all model entries in _MODELS dict with correct api_model_id values
    status: completed
  - id: add-resolve-method
    content: Implement ModelRegistry.resolve() method with resolution priority logic
    status: completed
  - id: update-agent-runner
    content: Modify execute_graphton.py to use ModelRegistry.resolve() before creating LLM instances
    status: completed
  - id: refactor-models-py
    content: Remove duplicate ANTHROPIC_MODEL_MAP from models.py, use ModelRegistry instead
    status: completed
  - id: add-tests
    content: Add unit tests for resolution logic in test_model_registry.py
    status: completed
isProject: false
---

# Model Name Resolution - Consolidated Approach

## Problem Statement

Users specify model names like `claude-sonnet-4.5`, but Anthropic's API expects `claude-sonnet-4-5-20250929`. Currently:

- `models.py` has the mapping but agent-runner doesn't use it
- `ModelRegistry` has metadata but no API IDs
- Model names are passed as raw strings without resolution

## Design Decision

**Location**: Keep in Python (`graphton/core/model_registry.py`) for now.

**Rationale**: 

- Agent-runner is the primary consumer
- ModelRegistry is already the metadata authority
- CLI can query the platform API for model info when needed (future)
- Avoids premature complexity of YAML + codegen

---

## Implementation

### 1. Enhance ModelMetadata with API Model ID

Add `api_model_id` field to [model_registry.py](backend/libs/python/graphton/src/graphton/core/model_registry.py):

```python
@dataclass(frozen=True, slots=True)
class ModelMetadata:
    model_id: str              # Platform alias: "claude-sonnet-4.5"
    api_model_id: str          # Actual API ID: "claude-sonnet-4-5-20250929"
    provider: str
    # ... existing fields
```

### 2. Add Resolution Method to ModelRegistry

```python
@classmethod
def resolve(cls, user_input: str) -> tuple[str, ModelMetadata]:
    """Resolve user input to (api_model_id, metadata).
    
    Accepts: exact platform ID, API ID, or case-insensitive alias.
    Returns: (api_model_id, metadata) tuple
    Raises: KeyError if no match found
    """
```

Resolution priority:

1. Exact match on `model_id` (e.g., "claude-sonnet-4.5")
2. Exact match on `api_model_id` (e.g., "claude-sonnet-4-5-20250929")
3. Case-insensitive match with normalization

### 3. Update Agent-Runner to Use Resolution

In [execute_graphton.py](backend/services/agent-runner/worker/activities/execute_graphton.py) lines ~885-907:

```python
# Before creating LLM instance, resolve the model name
api_model_id, model_metadata = ModelRegistry.resolve(model_name)

if worker_config.llm.provider == "anthropic":
    llm_model = ChatAnthropic(
        model=api_model_id,  # Use resolved API ID
        api_key=worker_config.llm.api_key,
    )
```

### 4. Deprecate models.py Mappings

Remove `ANTHROPIC_MODEL_MAP` and `OLLAMA_MODEL_MAP` from [models.py](backend/libs/python/graphton/src/graphton/core/models.py) and have `parse_model_string()` use `ModelRegistry.resolve()` instead.

---

## Files to Modify


| File                                         | Change                                            |
| -------------------------------------------- | ------------------------------------------------- |
| `graphton/core/model_registry.py`            | Add `api_model_id` field, add `resolve()` method  |
| `graphton/core/models.py`                    | Remove duplicate mappings, use ModelRegistry      |
| `agent-runner/.../execute_graphton.py`       | Use `ModelRegistry.resolve()` before LLM creation |
| `graphton/tests/core/test_model_registry.py` | Add tests for resolution logic                    |


---

## Model Data Updates

Update existing model entries with API IDs:


| Platform ID         | API Model ID                 |
| ------------------- | ---------------------------- |
| `claude-sonnet-4.5` | `claude-sonnet-4-5-20250929` |
| `claude-opus-4`     | `claude-opus-4-20250514`     |
| `claude-haiku-4`    | `claude-haiku-4-20250313`    |
| `claude-sonnet-3.5` | `claude-3-5-sonnet-20241022` |
| `claude-haiku-3.5`  | `claude-3-5-haiku-20241022`  |


OpenAI/Ollama models: `api_model_id` = `model_id` (no mapping needed)

---

## Future Extensibility (Not in Scope)

- **CLI model listing**: `stigmer list models` - can call platform API
- **YAML extraction**: If Go CLI needs offline resolution, extract to shared YAML
- **Alias expansion**: Support "sonnet 4.5" -> "claude-sonnet-4.5" (normalize spaces/case)

