---
name: Context Summarization Hardening
overview: Address code quality issues, close test coverage gaps, and create comprehensive documentation for the context summarization feature to ensure production-grade quality.
todos:
  - id: type-safety
    content: Replace Any types with proper typed definitions using TYPE_CHECKING across summarization_middleware.py, token_counter.py, and message_utils.py
    status: completed
  - id: provider-detection
    content: Refactor provider detection in summarization_middleware.py to use ModelRegistry instead of string matching
    status: completed
  - id: validation
    content: Add threshold validation in SummarizationConfig and method validation in TokenCounter
    status: completed
  - id: error-handling
    content: Improve error handling with specific exception types, exc_info=True, and consistent logging
    status: completed
  - id: test-tiktoken
    content: Create comprehensive tiktoken integration tests in test_token_counter.py
    status: completed
  - id: test-model-creation
    content: Add model creation error handling tests in test_summarization_middleware.py
    status: completed
  - id: test-message-selection
    content: Add _select_recent_messages boundary condition tests
    status: completed
  - id: test-deserialization
    content: Add deserialization error handling and edge case tests
    status: completed
  - id: doc-new-models
    content: Create docs/engineering/adding-new-models.md with 9 required fields and PR checklist
    status: completed
  - id: doc-architecture
    content: Create docs/architecture/context-summarization.md with component diagram and data flow
    status: completed
  - id: doc-user-guide
    content: Create docs/guides/context-management.md with configuration, best practices, and troubleshooting
    status: completed
isProject: false
---

# Context Summarization Hardening Plan

This plan addresses three critical areas to bring the context summarization implementation to production-grade quality: code hardening, test coverage, and documentation.

---

## Phase 1: Code Quality Hardening

### 1.1 Type Safety Improvements

Replace excessive `Any` types with proper typed definitions using `TYPE_CHECKING` imports:

**File: `backend/libs/python/graphton/src/graphton/core/summarization_middleware.py**`

- Add `TYPE_CHECKING` block for LangChain model types and LangMem types
- Replace `_running_summary: Any` with `RunningSummary | None`
- Type model creation methods with `BaseChatModel` return type
- Properly type `AgentState` and `Runtime` parameters

**File: `backend/libs/python/graphton/src/graphton/core/token_counter.py**`

- Add proper typing for `TokenCounterMethod` parameter
- Type `_get_tiktoken_encoding` return value
- Add runtime validation for method parameter

**File: `backend/libs/python/graphton/src/graphton/core/message_utils.py**`

- Add `TYPE_CHECKING` imports for LangMem types
- Replace `Any` with proper protocol or union types

### 1.2 Provider Detection Refactor

Replace fragile string-based provider detection with ModelRegistry lookup:

**Current (brittle):**

```python
if model_id.startswith("claude"):
    return self._create_anthropic_model(model_id)
elif model_id.startswith("gpt") or model_id.startswith("o1"):
    return self._create_openai_model(model_id)
```

**Target (robust):**

```python
metadata = ModelRegistry.get_or_default(model_id)
if metadata.provider == "anthropic":
    return self._create_anthropic_model(model_id)
elif metadata.provider == "openai":
    return self._create_openai_model(model_id)
elif metadata.provider == "ollama":
    return self._create_ollama_model(model_id)
```

### 1.3 Validation Improvements

Add threshold validation in `SummarizationConfig.for_model()`:

- Ensure `trigger_threshold > target_tokens`
- Ensure `max_context_window >= trigger_threshold`

Add token counter method validation:

- Validate `method` parameter is a valid `TokenCounterMethod`
- Log warning and fallback on invalid input

### 1.4 Error Handling Improvements

- Add exception type to warning logs: `type(e).__name__`
- Add `exc_info=True` for stack traces in error paths
- Replace overly broad `except Exception` with specific exceptions where possible

### 1.5 Logging Consistency

- Promote summarization trigger/completion to `logger.info`
- Ensure all logs include relevant context (model_id, token counts, message counts)
- Standardize log message format across all modules

---

## Phase 2: Test Coverage Completion

### 2.1 Tiktoken Integration Tests

**File: `backend/libs/python/graphton/tests/core/test_token_counter.py**` (new)

Tests to add:

- `test_tiktoken_cl100k_encoding` - GPT-4, GPT-3.5 token counting
- `test_tiktoken_o200k_encoding` - GPT-4o, o1 token counting
- `test_tiktoken_encoding_cache` - Verify encoding is cached
- `test_tiktoken_fallback_on_import_error` - Mock import failure
- `test_tiktoken_invalid_encoding_name` - Error handling
- `test_count_text_with_tiktoken` - Text-only counting

### 2.2 Model Creation Error Handling Tests

**File: `backend/libs/python/graphton/tests/core/test_summarization_middleware.py**` (new)

Tests to add:

- `test_create_anthropic_model_missing_import` - Mock langchain-anthropic unavailable
- `test_create_openai_model_missing_import` - Mock langchain-openai unavailable
- `test_create_ollama_model_missing_import` - Mock langchain-ollama unavailable
- `test_create_model_missing_api_key` - Test API key validation
- `test_provider_detection_uses_registry` - Verify ModelRegistry is used

### 2.3 Message Selection Logic Tests

Tests for `_select_recent_messages()`:

- `test_select_recent_messages_exact_target` - Boundary at target tokens
- `test_select_recent_messages_over_target` - Exceeds target by one message
- `test_select_recent_messages_single_large_message` - One message exceeds target
- `test_select_recent_messages_empty_input` - Empty message list
- `test_select_recent_messages_preserves_order` - Order maintained

### 2.4 Deserialization Error Handling Tests

Tests for `message_utils.py`:

- `test_deserialize_malformed_data` - Invalid dict structure
- `test_deserialize_missing_fields` - Partial data
- `test_deserialize_langmem_import_error` - Mock import failure
- `test_extract_summary_unknown_result_type` - Unsupported result format

### 2.5 Edge Cases Tests

Tests for `_build_summarized_messages()`:

- `test_build_summarized_no_system_prompt` - Messages without system message
- `test_build_summarized_empty_result` - LangMem returns empty
- `test_build_summarized_very_large_summary` - Summary exceeds reasonable size

---

## Phase 3: Documentation

### 3.1 New Model Onboarding Guide (High Priority)

**File: `docs/engineering/adding-new-models.md**`

Content:

1. **Overview** - Why proper model registration matters
2. **Required Information** - The 9 fields needed:
  - `model_id` - Unique identifier
  - `provider` - Provider name (anthropic, openai, ollama)
  - `max_context_window` - Token limit
  - `summarization_trigger_threshold` - When to summarize
  - `summarization_target_tokens` - Post-summarization target
  - `token_counter_method` - How to count tokens
  - `cost_tier` - ECONOMY, STANDARD, PREMIUM
  - `supports_tools` - Tool calling capability
  - `supports_vision` - Vision capability
3. **Step-by-Step Guide** - Adding a new model
4. **PR Checklist Template** - Required validations
5. **Examples** - Adding Claude, GPT, Ollama models

### 3.2 Context Summarization Architecture (Medium Priority)

**File: `docs/architecture/context-summarization.md**`

Content:

1. **Problem Statement** - Why context management matters
2. **Architecture Overview** - Component diagram
3. **Components** - ModelRegistry, SummarizationConfig, TokenCounter, SummarizationMiddleware
4. **Data Flow** - Request/response lifecycle
5. **Configuration** - Proto definitions, runtime options
6. **Observability** - Metrics, callbacks, status reporting
7. **Design Decisions** - Key choices and rationale

### 3.3 Context Management User Guide (Medium Priority)

**File: `docs/guides/context-management.md**`

Content:

1. **Overview** - What context management does
2. **Configuration Options** - How to configure via ExecutionConfig
3. **Understanding Metrics** - Context utilization, summarization events
4. **Best Practices** - When to enable/disable, threshold tuning
5. **Troubleshooting** - Common issues and solutions
6. **FAQ** - Common questions

---

## Key Files to Modify


| File                                                   | Changes                                         |
| ------------------------------------------------------ | ----------------------------------------------- |
| `graphton/core/summarization_middleware.py`            | Type safety, provider detection, error handling |
| `graphton/core/token_counter.py`                       | Type safety, validation                         |
| `graphton/core/message_utils.py`                       | Type safety                                     |
| `graphton/core/summarization_config.py`                | Threshold validation                            |
| `graphton/tests/core/test_token_counter.py`            | New test file                                   |
| `graphton/tests/core/test_summarization_middleware.py` | New test file                                   |
| `graphton/tests/core/test_summarization.py`            | Additional edge case tests                      |
| `docs/engineering/adding-new-models.md`                | New documentation                               |
| `docs/architecture/context-summarization.md`           | New documentation                               |
| `docs/guides/context-management.md`                    | New documentation                               |


---

## Quality Standards

All code changes will adhere to:

- Full type hints with `TYPE_CHECKING` for optional imports
- Google-style docstrings with Args/Returns/Raises
- Comprehensive error handling with specific exception types
- Consistent logging with context
- No TODOs or FIXMEs left behind
- All new tests must pass
- Zero linter errors

