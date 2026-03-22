# Context Summarization Architecture

This document describes the architecture of Stigmer's context summarization system, which provides intelligent context window management for long-running agent conversations.

## Problem Statement

Large Language Models have finite context windows (8K to 200K+ tokens). Long-running agent conversations can exceed these limits, causing:

1. **Token limit errors** - API calls fail when context exceeds limits
2. **Degraded performance** - Models perform worse as context approaches limits
3. **Increased costs** - Larger contexts cost more per request
4. **Lost context** - Naive truncation loses important information

## Solution Overview

Stigmer implements automatic context summarization using LangMem's `summarize_messages()` function, backed by a comprehensive Model Registry that provides context window metadata for all supported models.

### Key Features

- **Automatic triggering** - Summarizes when token count exceeds configurable threshold
- **Running summary** - Maintains cumulative summary across invocations
- **Cost-effective** - Uses economy-tier models for summarization
- **Provider-aware** - Accurate token counting per provider
- **Observable** - Exposes metrics via callbacks and status

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Agent Execution Flow                             │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌──────────────┐     ┌─────────────────────┐     ┌──────────────────┐  │
│  │   Messages   │────▶│ SummarizationMiddle │────▶│  Agent (LLM)     │  │
│  │   (Input)    │     │       ware          │     │                  │  │
│  └──────────────┘     └─────────────────────┘     └──────────────────┘  │
│                               │                                          │
│                               ▼                                          │
│                       ┌───────────────┐                                  │
│                       │ TokenCounter  │                                  │
│                       └───────┬───────┘                                  │
│                               │                                          │
│           ┌───────────────────┼───────────────────┐                     │
│           ▼                   ▼                   ▼                     │
│   ┌───────────────┐   ┌───────────────┐   ┌───────────────┐           │
│   │   Tiktoken    │   │   Anthropic   │   │  Approximate  │           │
│   │  (cl100k/o200k)│   │   Native      │   │   (chars/4)   │           │
│   └───────────────┘   └───────────────┘   └───────────────┘           │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│                         Supporting Components                            │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌──────────────────┐      ┌────────────────────┐                       │
│  │  ModelRegistry   │◀────▶│ SummarizationConfig│                       │
│  │                  │      │                    │                       │
│  │ • Model metadata │      │ • Thresholds       │                       │
│  │ • Cost tiers     │      │ • Target tokens    │                       │
│  │ • Token methods  │      │ • Summarizer model │                       │
│  └──────────────────┘      └────────────────────┘                       │
│                                                                          │
│  ┌──────────────────┐      ┌────────────────────┐                       │
│  │  message_utils   │      │ SummarizationCall  │                       │
│  │                  │      │      back          │                       │
│  │ • ensure_ids     │      │ • on_summarization │                       │
│  │ • serialize      │      │ • on_token_count   │                       │
│  │ • deserialize    │      │                    │                       │
│  └──────────────────┘      └────────────────────┘                       │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

## Components

### 1. ModelRegistry

**Location**: `graphton/core/model_registry.py`

The ModelRegistry is the single source of truth for all model metadata. It contains:

| Field | Purpose |
|-------|---------|
| `model_id` | Canonical model identifier |
| `provider` | Provider name (anthropic, openai, ollama) |
| `context_window_tokens` | Total context window size |
| `summarization_trigger_threshold` | Token count to trigger summarization |
| `summarization_target_tokens` | Target token count after summarization |
| `token_counter_method` | Strategy for counting tokens |
| `cost_tier` | ECONOMY, STANDARD, or PREMIUM |

**Key Methods**:
- `get(model_id)` - Get metadata, raises KeyError if not found
- `get_or_default(model_id)` - Get metadata with fallback defaults
- `get_summarization_model(model_id)` - Get economy-tier model for summarization

### 2. SummarizationConfig

**Location**: `graphton/core/summarization_config.py`

Immutable configuration for the summarization middleware:

```python
@dataclass(frozen=True)
class SummarizationConfig:
    enabled: bool
    trigger_threshold: int      # When to summarize
    target_tokens: int          # Target after summarization
    max_summary_tokens: int     # Max tokens for summary itself
    summarization_model: str    # Model to use for summarization
    token_counter_method: TokenCounterMethod
```

**Factory Methods**:
- `for_model(model_id)` - Create config from ModelRegistry
- `disabled()` - Create disabled config

### 3. TokenCounter

**Location**: `graphton/core/token_counter.py`

Provider-specific token counting with method dispatch:

| Method | Models | Implementation |
|--------|--------|----------------|
| `TIKTOKEN_CL100K` | GPT-4, GPT-3.5 | tiktoken cl100k_base |
| `TIKTOKEN_O200K` | GPT-4o, o1 | tiktoken o200k_base |
| `ANTHROPIC_NATIVE` | Claude | Calibrated ~3.8 chars/token |
| `APPROXIMATE` | Ollama, fallback | Conservative ~4 chars/token |

Features:
- Encoding caching via `@lru_cache`
- Graceful fallback on errors
- Tool call token counting

### 4. SummarizationMiddleware

**Location**: `graphton/core/summarization_middleware.py`

AgentMiddleware that implements the summarization lifecycle:

```
┌─────────────────────────────────────────────────────────────────┐
│                   Middleware Lifecycle                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  abefore_agent()                                                 │
│  ├── Load running_summary from state                            │
│  ├── Count tokens in messages                                    │
│  ├── Report token count via callback                            │
│  │                                                               │
│  ├── if tokens >= trigger_threshold:                            │
│  │   ├── Call LangMem summarize_messages()                      │
│  │   ├── Build new message list with summary                    │
│  │   ├── Update running_summary                                  │
│  │   ├── Report summarization event via callback                │
│  │   └── Return modified messages                                │
│  │                                                               │
│  └── else: return None (no modification)                        │
│                                                                  │
│  aafter_step()                                                   │
│  └── Reserved for future mid-execution summarization            │
│                                                                  │
│  aafter_agent()                                                  │
│  └── Save running_summary to state for persistence              │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 5. Message Utilities

**Location**: `graphton/core/message_utils.py`

Helper functions for LangMem integration:

| Function | Purpose |
|----------|---------|
| `ensure_message_ids()` | Add UUIDs to messages (LangMem requirement) |
| `extract_summary_from_result()` | Extract summary text from SummarizationResult |
| `serialize_running_summary()` | Convert RunningSummary to JSON-serializable dict |
| `deserialize_running_summary()` | Restore RunningSummary from stored dict |
| `create_summary_system_message()` | Create SystemMessage with formatted summary |

### 6. SummarizationCallback

**Location**: `graphton/core/summarization_callback.py`

Protocol for external observability:

```python
@runtime_checkable
class SummarizationCallback(Protocol):
    def on_summarization_complete(self, event: SummarizationEventData) -> None:
        """Called after successful summarization."""
        ...
    
    def on_token_count_updated(self, token_count: int) -> None:
        """Called when token count is calculated."""
        ...
```

`SummarizationEventData` contains:
- `tokens_before`, `tokens_after`
- `compression_ratio`
- `duration_ms`
- `summarization_model`
- `messages_before`, `messages_after`

## Data Flow

### 1. Configuration Phase

```
create_deep_agent(model_name="claude-sonnet-4.5", ...)
    │
    ▼
SummarizationConfig.for_model("claude-sonnet-4.5")
    │
    ├── ModelRegistry.get_or_default("claude-sonnet-4.5")
    │   └── Returns: trigger=180K, target=160K, method=ANTHROPIC_NATIVE
    │
    ├── ModelRegistry.get_summarization_model("claude-sonnet-4.5")
    │   └── Returns: "claude-haiku-4"
    │
    └── Returns: SummarizationConfig(
            enabled=True,
            trigger_threshold=180000,
            target_tokens=160000,
            summarization_model="claude-haiku-4",
            ...
        )
```

### 2. Execution Phase

```
Agent invocation with 175K tokens in messages
    │
    ▼
SummarizationMiddleware.abefore_agent()
    │
    ├── TokenCounter.count_messages(messages, ANTHROPIC_NATIVE)
    │   └── Returns: 175000
    │
    ├── callback.on_token_count_updated(175000)
    │
    ├── config.should_summarize(175000)?
    │   └── 175000 < 180000 → False
    │
    └── Returns: None (no summarization needed)

Agent invocation with 185K tokens in messages
    │
    ▼
SummarizationMiddleware.abefore_agent()
    │
    ├── TokenCounter.count_messages(messages, ANTHROPIC_NATIVE)
    │   └── Returns: 185000
    │
    ├── config.should_summarize(185000)?
    │   └── 185000 >= 180000 → True
    │
    ├── _perform_summarization()
    │   ├── ensure_message_ids(messages)
    │   ├── _create_summarization_model("claude-haiku-4")
    │   ├── langmem.summarize_messages(...)
    │   └── _build_summarized_messages()
    │
    ├── callback.on_summarization_complete(SummarizationEventData(...))
    │
    └── Returns: {"messages": [summarized_messages]}
```

### 3. Persistence Phase

```
Agent completes execution
    │
    ▼
SummarizationMiddleware.aafter_agent()
    │
    ├── serialize_running_summary(self._running_summary)
    │   └── Returns: {"summary": "...", "summarized_message_ids": [...]}
    │
    └── state[RUNNING_SUMMARY_STATE_KEY] = serialized

Next invocation
    │
    ▼
SummarizationMiddleware.abefore_agent()
    │
    ├── _load_running_summary_from_state()
    │   ├── state.get(RUNNING_SUMMARY_STATE_KEY)
    │   └── deserialize_running_summary(data)
    │
    └── self._running_summary = restored RunningSummary
```

## Proto Definitions

### ContextManagementConfig

```protobuf
message ContextManagementConfig {
  bool enabled = 1;
  int32 trigger_threshold_override = 2;
  int32 target_tokens_override = 3;
  string summarization_model_override = 4;
}
```

### ContextInfo

```protobuf
message ContextInfo {
  int32 current_token_count = 1;
  int32 max_context_window = 2;
  float utilization_percentage = 3;
  repeated SummarizationEvent summarization_events = 4;
  bool summarization_enabled = 5;
  int32 summarization_trigger_threshold = 6;
}
```

### SummarizationEvent

```protobuf
message SummarizationEvent {
  google.protobuf.Timestamp timestamp = 1;
  int32 tokens_before = 2;
  int32 tokens_after = 3;
  float compression_ratio = 4;
  int32 duration_ms = 5;
  string summarization_model = 6;
}
```

## Design Decisions

### 1. LangMem Integration

**Decision**: Use LangMem's `summarize_messages()` instead of custom implementation.

**Rationale**:
- Battle-tested summarization logic
- Running summary support built-in
- Maintained by LangChain team
- Avoids reinventing complex logic

### 2. Callback Protocol Pattern

**Decision**: Use Protocol-based callbacks for observability.

**Rationale**:
- Clean separation between library (graphton) and service (agent-runner)
- StatusBuilder can implement protocol without tight coupling
- Easy to mock in tests
- Failures don't break agent execution

### 3. Economy-Tier Summarization

**Decision**: Use cheapest available model for summarization.

**Rationale**:
- Summarization doesn't need premium reasoning
- Cost savings can be significant at scale
- Same provider ensures compatible tokenization
- Quality is sufficient for summary generation

### 4. Threshold-Based Triggering

**Decision**: Trigger at 90% context, target 80% context.

**Rationale**:
- 90% leaves buffer for response generation
- 80% target ensures room for new messages
- Prevents repeated summarization on edge
- Configurable via overrides for special cases

### 5. Message ID Generation

**Decision**: Auto-generate UUIDs for messages without IDs.

**Rationale**:
- LangMem requires all messages to have IDs
- Non-destructive (original messages preserved)
- Deterministic within invocation
- Enables accurate summarization tracking

## Error Handling

| Scenario | Behavior |
|----------|----------|
| LangMem not installed | ImportError with install instructions |
| Summarization fails | Log error, continue without summarization |
| Callback fails | Log warning, continue execution |
| Unknown model | Use conservative defaults (8K context) |
| Invalid thresholds | ValueError at config creation |

## Performance Considerations

1. **Token counting overhead**: ~1-2ms for typical conversations
2. **Summarization latency**: 2-5 seconds depending on model
3. **Memory usage**: Running summary typically <10KB
4. **Encoding caching**: Tiktoken encodings cached via `@lru_cache`

## Monitoring

Key metrics to track:
- `context_token_count` - Current token count
- `context_utilization_pct` - Percentage of context used
- `summarization_count` - Number of summarizations
- `summarization_duration_ms` - Time to summarize
- `compression_ratio` - Tokens reduced per summarization

## Future Enhancements

1. **Mid-execution summarization** - Summarize during long tool sequences
2. **Semantic chunking** - Smart message grouping before summarization
3. **Summary quality metrics** - Track information retention
4. **Custom summarization prompts** - Domain-specific summary formats
