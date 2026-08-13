# Context Management

How AgentExecution manages context windows for long-running conversations — automatic summarization, configuration options, and observability.

---

## The Problem: Context Window Limits

Every LLM has a maximum context window — the total number of tokens it can process in a single call, including the system prompt, conversation history, tool calls, and tool results. For long-running agents that make many tool calls or have extended conversations, the accumulated context can approach or exceed this limit.

| Model | Context Window |
|---|---|
| claude-sonnet-4.5 | 200,000 tokens |
| gpt-4o | 128,000 tokens |
| gpt-4-turbo | 128,000 tokens |

Without intervention, an agent that exceeds its model's context window will fail with a context length error.

---

## Automatic Context Summarization

Stigmer monitors token usage during every AgentExecution and automatically summarizes older conversation history before the context window limit is reached.

**How it works:**

1. After each LLM call, the runner checks the current token count
2. When the token count exceeds the **trigger threshold** (default: ~90% of the model's context window), summarization is triggered
3. A lightweight economy model (e.g., `claude-haiku-4` for Anthropic, `gpt-4o-mini` for OpenAI) generates a summary of the older conversation history
4. The older messages are replaced by the summary, reducing context to approximately the **target token count** (default: ~80% of the context window)
5. The agent continues from the summary — no interruption, no data loss

**Default thresholds (derived from Model Registry):**

| Model | Context Window | Trigger Threshold (~90%) | Target Tokens (~80%) |
|---|---|---|---|
| claude-sonnet-4.5 | 200,000 | 180,000 | 160,000 |
| gpt-4o | 128,000 | 115,200 | 102,400 |

Summarization is enabled by default for all models. No configuration is needed unless you want to customize the behavior.

---

## Configuration

Override context management behavior per execution via `spec.execution_config.context_management`.

### Disable Summarization

```yaml
spec:
  agent_id: agt_abc123
  message: "Short task that won't approach context limits"
  execution_config:
    model_name: "claude-sonnet-4.5"
    context_management:
      disable_summarization: true
```

**Warning:** If summarization is disabled and the context exceeds the model's limit, the execution will fail. Only disable for short-lived executions you are confident will not approach the context window.

### Custom Thresholds

```yaml
spec:
  agent_id: agt_abc123
  message: "Long-running analysis task"
  execution_config:
    model_name: "claude-sonnet-4.5"
    context_management:
      custom_trigger_threshold: 100000  # summarize earlier (50% of window)
      custom_target_tokens: 80000       # reduce to this size
```

**Constraints:**
- `custom_trigger_threshold` must be greater than `custom_target_tokens`
- Set to `0` to use the model registry default for either field

---

## `ContextManagementConfig` Fields

Defined in `ai/stigmer/agentic/agentexecution/v1/spec.proto`.

| Field | Type | Default | Description |
|---|---|---|---|
| `disable_summarization` | `bool` | `false` | Disable automatic context summarization entirely. |
| `custom_trigger_threshold` | `int32` | `0` (model default) | Token count that triggers summarization. `0` = use model default. |
| `custom_target_tokens` | `int32` | `0` (model default) | Target token count after summarization. `0` = use model default. |

---

## Observability: `ContextInfo`

The `status.context_info` field provides real-time visibility into context window utilization and summarization history.

```yaml
status:
  context_info:
    current_token_count: 145230
    context_window_limit: 200000
    summarization_trigger_threshold: 180000
    summarization_target_tokens: 160000
    summarization_enabled: true
    utilization_percent: 72.6
    summarization_events:
      - timestamp: "2026-02-28T10:15:00.123Z"
        tokens_before: 181500
        tokens_after: 74200
        compression_ratio: 0.59
        duration_ms: 2340
        summarization_model: "claude-haiku-4"
        messages_before: 48
        messages_after: 12
```

### `ContextInfo` Fields

Defined in `ai/stigmer/agentic/agentexecution/v1/api.proto`.

| Field | Type | Description |
|---|---|---|
| `current_token_count` | `int32` | Most recent token count. Updated after each LLM call. |
| `context_window_limit` | `int32` | Model's maximum context window size. Retrieved from Model Registry. |
| `summarization_trigger_threshold` | `int32` | Effective threshold — model default or custom override. |
| `summarization_target_tokens` | `int32` | Effective target — model default or custom override. |
| `summarization_enabled` | `bool` | `false` if `disable_summarization: true` was set. `true` otherwise. |
| `utilization_percent` | `float` | `(current_token_count / context_window_limit) * 100`. Updated progressively. |
| `summarization_events` | `repeated SummarizationEvent` | History of all summarization events during this execution. Ordered chronologically. |

### Health Bands for UIs

| Utilization | Indicator | Action |
|---|---|---|
| 0–70% | Green — Healthy | No action needed |
| 70–90% | Yellow — Approaching threshold | Monitor; summarization will trigger soon |
| 90–100% | Red — At or above trigger | Summarization active or about to trigger |

### `SummarizationEvent` Fields

Each entry in `summarization_events` records one summarization occurrence:

| Field | Type | Description |
|---|---|---|
| `timestamp` | `string` | ISO 8601 timestamp when summarization occurred. |
| `tokens_before` | `int32` | Token count before summarization (the value that exceeded the trigger threshold). |
| `tokens_after` | `int32` | Token count after summarization (approximately at or below `target_tokens`). |
| `compression_ratio` | `float` | `1 - (tokens_after / tokens_before)`. A value of `0.6` means 60% reduction. |
| `duration_ms` | `int32` | Time to perform summarization in milliseconds (includes LLM call, processing, and injection). |
| `summarization_model` | `string` | Economy-tier model used for summarization. Example: `"claude-haiku-4"`, `"gpt-4o-mini"`. |
| `messages_before` | `int32` | Number of messages in the conversation before summarization. |
| `messages_after` | `int32` | Number of messages after summarization (historical messages collapsed into summary). |

---

## Summarization Models

Summarization uses cost-effective economy-tier models to minimize expense:

| Provider | Summarization Model |
|---|---|
| Anthropic | `claude-haiku-4` |
| OpenAI | `gpt-4o-mini` |
| Ollama | Local model (same as execution model) |

The summarization model is determined by the provider of the main execution model — not configurable per execution.

---

## Multiple Summarization Events

A very long-running execution may trigger summarization multiple times. Each event is recorded in `summarization_events`:

```yaml
summarization_events:
  - timestamp: "2026-02-28T10:15:00Z"
    tokens_before: 181500
    tokens_after: 74200
    compression_ratio: 0.59
    duration_ms: 2340
    summarization_model: "claude-haiku-4"

  - timestamp: "2026-02-28T11:42:30Z"
    tokens_before: 180100
    tokens_after: 76400
    compression_ratio: 0.58
    duration_ms: 2100
    summarization_model: "claude-haiku-4"
```

Multiple events indicate a very long-running conversation. If you see frequent summarization:
- The agent may be accumulating large tool call results
- Consider breaking the task into multiple shorter executions
- Evaluate whether a smaller context target could reduce summarization cost

---

## Common Use Cases

### Short Task — Disable Summarization

```yaml
spec:
  agent_id: agt_abc123
  message: "What is 2 + 2?"
  execution_config:
    context_management:
      disable_summarization: true
```

### Long-Running Analysis — Aggressive Summarization

Summarize earlier to keep costs low and avoid approaching the limit:

```yaml
spec:
  agent_id: agt_abc123
  message: "Analyze all 500 files in this repository"
  execution_config:
    model_name: "claude-sonnet-4.5"
    context_management:
      custom_trigger_threshold: 50000   # summarize at 25% of window
      custom_target_tokens: 30000       # reduce to 15%
```

### Debugging Context Issues

Check `context_info` to understand what happened:

```bash
stigmer agent execution get aex_abc123 --output yaml | grep -A20 context_info
```

Look for:
- `utilization_percent` approaching 100% — may explain a context-related failure
- `summarization_events` with high `compression_ratio` — heavy summarization
- `summarization_enabled: false` combined with high `utilization_percent` — execution at risk
