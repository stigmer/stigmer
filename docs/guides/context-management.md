# Context Management User Guide

This guide explains how to configure and use Stigmer's automatic context management features for long-running agent conversations.

## Overview

Context management automatically summarizes conversation history when it approaches the model's context window limit. This prevents:

- Token limit errors that would crash your agent
- Degraded model performance from overly long contexts
- Excessive costs from processing unnecessary tokens

**Key Benefit**: Your agents can run indefinitely without losing important context.

## Quick Start

Context management is enabled by default when using supported models. No configuration is required for typical use cases.

```python
# Context management is automatically configured based on your model
agent = create_deep_agent(
    model_name="claude-sonnet-4.5",  # Uses 180K trigger, 160K target
    system_prompt="You are a helpful assistant.",
)
```

## How It Works

1. **Token Counting**: Before each agent turn, the system counts tokens in the conversation
2. **Threshold Check**: If tokens exceed 90% of the context window, summarization triggers
3. **Summarization**: An economy-tier model creates a concise summary of older messages
4. **Message Replacement**: Old messages are replaced with the summary + recent messages
5. **Persistence**: The running summary is saved for the next invocation

### Example Flow

```
Turn 1-10: Normal operation (50K tokens)
Turn 11-20: Context grows (100K tokens)
Turn 21-30: Context grows (170K tokens)
Turn 31: Threshold hit (185K > 180K trigger)
         → Summarization runs
         → Context reduced to ~80K tokens
Turn 32+: Normal operation continues
```

## Configuration Options

### Via ExecutionConfig (Proto)

Configure context management per execution:

```protobuf
message ExecutionConfig {
  ContextManagementConfig context_management = 10;
}

message ContextManagementConfig {
  bool enabled = 1;                          // Enable/disable summarization
  int32 trigger_threshold_override = 2;      // Custom trigger threshold
  int32 target_tokens_override = 3;          // Custom target after summarization
  string summarization_model_override = 4;   // Custom summarization model
}
```

### Python SDK

```python
from graphton.core.summarization_config import SummarizationConfig

# Default configuration (recommended)
config = SummarizationConfig.for_model("claude-sonnet-4.5")

# Custom thresholds
config = SummarizationConfig.for_model(
    "claude-sonnet-4.5",
    trigger_threshold_override=150000,  # Summarize earlier
    target_tokens_override=120000,      # More aggressive compression
)

# Disable summarization
config = SummarizationConfig.disabled()
```

## Default Thresholds by Model

| Model | Context Window | Trigger (90%) | Target (80%) |
|-------|---------------|---------------|--------------|
| **Anthropic** |
| claude-opus-4 | 200K | 180K | 160K |
| claude-sonnet-4.5 | 200K | 180K | 160K |
| claude-haiku-4 | 200K | 180K | 160K |
| **OpenAI** |
| gpt-4 | 8K | 7K | 6K |
| gpt-4-turbo | 128K | 115K | 100K |
| gpt-4o | 128K | 115K | 100K |
| gpt-4o-mini | 128K | 115K | 100K |
| o1 | 200K | 180K | 160K |
| **Ollama** |
| qwen2.5-coder:7b | 32K | 28K | 24K |
| deepseek-coder-v2:16b | 128K | 115K | 100K |
| llama3.2:3b | 128K | 115K | 100K |

## Understanding Metrics

### Context Utilization

The `context_info` field in execution status provides real-time visibility:

```protobuf
message ContextInfo {
  int32 current_token_count = 1;       // Current tokens in context
  int32 max_context_window = 2;        // Model's context limit
  float utilization_percentage = 3;    // current / max * 100
  bool summarization_enabled = 4;      // Is summarization active
  int32 summarization_trigger_threshold = 5;  // When summarization triggers
}
```

### Utilization Levels

| Level | Range | Meaning |
|-------|-------|---------|
| Normal | 0-70% | Plenty of room |
| Elevated | 70-85% | Approaching limit |
| High | 85-90% | Near trigger threshold |
| Summarizing | >90% | Summarization triggered |

### Summarization Events

Each summarization creates an event record:

```protobuf
message SummarizationEvent {
  google.protobuf.Timestamp timestamp = 1;
  int32 tokens_before = 2;        // Tokens before summarization
  int32 tokens_after = 3;         // Tokens after summarization
  float compression_ratio = 4;    // Reduction percentage (0.0-1.0)
  int32 duration_ms = 5;          // Time taken
  string summarization_model = 6; // Model used for summarization
}
```

## Best Practices

### 1. Use Default Thresholds

The 90%/80% thresholds are carefully chosen:
- 90% trigger leaves room for the model's response
- 80% target provides buffer for new messages
- Prevents repeated summarization on boundaries

**Recommendation**: Only override if you have specific requirements.

### 2. Don't Disable Unnecessarily

Disabling summarization means your agent will eventually hit context limits.

**When to disable**:
- Very short conversations (guaranteed <50% context)
- Testing/debugging summarization behavior
- Using a model not in the registry

### 3. Monitor Summarization Events

Track summarization frequency and compression ratios:

```python
# Good: Occasional summarization with high compression
# Event: tokens_before=185000, tokens_after=80000, compression_ratio=0.57

# Warning: Frequent summarization with low compression
# May indicate conversation patterns that don't summarize well
```

### 4. Consider Workflow Design

For very long workflows:
- Design natural breakpoints where context can be summarized
- Consider passing explicit context between workflow steps
- Use execution context for critical data that must persist

### 5. Choose Appropriate Models

Larger context windows = less frequent summarization = better coherence:

| Use Case | Recommended Model |
|----------|------------------|
| Simple tasks | Claude Haiku, GPT-4o-mini |
| Complex reasoning | Claude Sonnet, GPT-4o |
| Very long conversations | Claude Opus, o1 (200K context) |

## Troubleshooting

### Issue: Agent Loses Important Information

**Symptoms**: Agent forgets critical details after summarization

**Solutions**:
1. Use a model with larger context window
2. Store critical information in execution context (not summarized)
3. Include important facts in system prompt (always retained)
4. Increase trigger threshold to summarize less often

### Issue: Summarization Too Frequent

**Symptoms**: Multiple summarizations per conversation

**Solutions**:
1. Check if messages contain large payloads (base64 images, code blocks)
2. Increase trigger threshold
3. Use a model with larger context window
4. Review if tool outputs are unnecessarily verbose

### Issue: High Summarization Latency

**Symptoms**: Summarization takes >5 seconds

**Solutions**:
1. This is normal for first summarization (model loading)
2. Subsequent summarizations should be 2-4 seconds
3. Check network latency to LLM provider
4. Consider using a faster summarization model

### Issue: Summarization Not Triggering

**Symptoms**: Token count shows 95%+ but no summarization

**Possible causes**:
1. Context management disabled in config
2. Model not in registry (using 8K defaults)
3. Token counting method mismatch

**Debug steps**:
```python
from graphton.core.summarization_config import SummarizationConfig
from graphton.core.model_registry import ModelRegistry

# Check model is registered
print(ModelRegistry.is_registered("your-model-id"))

# Check config values
config = SummarizationConfig.for_model("your-model-id")
print(f"Enabled: {config.enabled}")
print(f"Trigger: {config.trigger_threshold}")
```

### Issue: Context Limit Errors Despite Summarization

**Symptoms**: Still hitting token limits

**Possible causes**:
1. Single message exceeds context window (e.g., huge code block)
2. Tool outputs are extremely large
3. Race condition (fast message generation)

**Solutions**:
1. Chunk large inputs before sending
2. Limit tool output sizes
3. Lower trigger threshold significantly (e.g., 70%)

## FAQ

### Q: How much does summarization cost?

Summarization uses economy-tier models:
- Claude Haiku 4: ~$0.001 per summarization
- GPT-4o-mini: ~$0.0005 per summarization

Typical cost is negligible compared to main model usage.

### Q: What information is preserved in summaries?

Summaries preserve:
- Key facts and decisions
- User preferences mentioned
- Task context and progress
- Important tool results

Summaries may lose:
- Exact phrasing of earlier messages
- Detailed intermediate reasoning
- Verbose tool output details

### Q: Can I see the generated summaries?

Yes, check `context_info.summarization_events` in execution status, or enable debug logging:

```python
import logging
logging.getLogger("graphton.core.summarization_middleware").setLevel(logging.DEBUG)
```

### Q: Does summarization work with streaming?

Yes, summarization happens before the agent processes messages. Streaming responses work normally after any needed summarization.

### Q: What happens if summarization fails?

The agent continues without summarization. An error is logged but execution proceeds. This is a fail-safe design to prevent summarization issues from blocking agent work.

### Q: Can I customize the summary format?

Currently no. Future versions may support custom summarization prompts for domain-specific needs.

## Additional Resources

- [Architecture Documentation](../architecture/context-summarization.md) - Technical deep dive
- [Adding New Models](../engineering/adding-new-models.md) - Extend model support
- [Model Registry Source](../../backend/libs/python/graphton/src/graphton/core/model_registry.py) - See all supported models
