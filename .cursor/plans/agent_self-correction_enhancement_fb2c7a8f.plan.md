---
name: Agent Self-Correction Enhancement
overview: Enhance the graphton library to make agents self-correcting and resilient by adding Cursor-style error recovery guidance, tuning loop detection thresholds, and improving error message quality - all with configurable parameters and optimal defaults.
todos:
  - id: prompt-enhancement
    content: Rewrite prompt_enhancement.py with resilience preamble and error recovery sections (~800 words total)
    status: completed
  - id: loop-detection-params
    content: Add loop_history_size, loop_consecutive_threshold, loop_total_threshold params to create_deep_agent() with optimal defaults
    status: completed
  - id: loop-middleware-update
    content: Update LoopDetectionMiddleware to accept configurable thresholds from agent.py
    status: completed
  - id: config-validation
    content: Add validation for new loop detection parameters in config.py
    status: completed
  - id: error-enrichment
    content: Add _enrich_error_message() helper to authenticated_tool_node.py for contextual recovery hints
    status: completed
  - id: testing
    content: Add unit tests for new prompt sections and loop detection configuration
    status: completed
isProject: false
---

# Agent Self-Correction Enhancement Plan

## Problem Summary

The current agent implementation lacks self-correcting behavior because:

1. System prompt has no error recovery guidance
2. Loop detection kills agents after just 3-5 attempts
3. Error messages provide no recovery hints
4. No explicit strategies for alternative approaches

## Architecture Changes

### 1. Enhanced Prompt Structure (`prompt_enhancement.py`)

Restructure the prompt to follow Cursor's pattern:

```
RESILIENCE_PREAMBLE (always included)
  └── Error recovery philosophy
  └── Never give up on first failure
  └── Try alternative approaches

CAPABILITY_SECTIONS (conditional)
  └── Planning system (if enabled)
  └── File system tools (if sandbox enabled)
  └── MCP tools (if configured)
  └── Execute tool (if sandbox enabled)

ERROR_RECOVERY_STRATEGIES (conditional per tool type)
  └── File operation recovery (read before edit, backup strategies)
  └── MCP tool recovery (retry with different params, fallback)
  └── Execution recovery (check prerequisites, validate paths)

USER_INSTRUCTIONS (appended last, highest LLM priority)
```

**Key sections to add:**

- **Resilience Preamble** (~300 words): Core philosophy on error handling, never giving up, trying alternatives
- **File Operation Recovery** (~200 words): Read before edit, backup strategies, path validation
- **Tool Failure Recovery** (~150 words): Analyze errors, try alternatives, escalate gracefully
- **Execution Recovery** (~150 words): Check prerequisites, validate environment, handle timeouts

### 2. Tuned Loop Detection (`loop_detection.py`)

Add new parameters to `create_deep_agent()` with optimal defaults:

| Parameter | Current | New Default | Reasoning |

|-----------|---------|-------------|-----------|

| `loop_history_size` | 10 | 20 | Track more context for better pattern detection |

| `loop_consecutive_threshold` | 3 | 7 | Allow 7 retries before warning |

| `loop_total_threshold` | 5 | 20 | Allow 20 total attempts at a problem |

These flow through `create_deep_agent()` → `LoopDetectionMiddleware`.

### 3. Contextual Error Messages (`authenticated_tool_node.py`)

Add a helper to enrich error messages with recovery hints:

```python
def _enrich_error_message(tool_name: str, error: str) -> str:
    """Add contextual recovery hints based on tool type and error pattern."""
    hints = []
    
    if "not found" in error.lower():
        hints.append("Try using ls or glob to discover available files/resources")
    if "permission" in error.lower():
        hints.append("Check if the path is correct and accessible")
    if "edit" in tool_name.lower() or "write" in tool_name.lower():
        hints.append("Try reading the target first to understand its current state")
    
    return f"Error: {error}\n\nRecovery suggestions:\n" + "\n".join(f"- {h}" for h in hints)
```

### 4. File Changes

| File | Change Type | Description |

|------|-------------|-------------|

| `graphton/core/prompt_enhancement.py` | Major rewrite | Add resilience preamble, error recovery sections |

| `graphton/core/agent.py` | Add parameters | New `loop_*` params with optimal defaults |

| `graphton/core/loop_detection.py` | Constructor change | Accept configurable thresholds |

| `graphton/core/config.py` | Add validation | Validate new loop detection parameters |

| `graphton/core/authenticated_tool_node.py` | Add helper | Error message enrichment function |

## Implementation Details

### prompt_enhancement.py - New Structure

```python
RESILIENCE_PREAMBLE = """
## Error Recovery Philosophy

You are a resilient agent. When you encounter errors or obstacles:

1. **Never give up on first failure** - Most errors are recoverable with a different approach
2. **Analyze before retrying** - Understand WHY something failed before trying again
3. **Try alternative strategies** - If direct approach fails, try indirect approaches
4. **Validate assumptions** - Check that files exist, paths are correct, prerequisites are met
5. **Read before writing** - Always understand current state before attempting modifications

When a tool returns an error:
- Parse the error message for clues about what went wrong
- Consider what prerequisite steps might be missing
- Try a different tool or approach that achieves the same goal
- If stuck after 3+ attempts, step back and reassess the overall strategy
"""

FILE_RECOVERY_SECTION = """
## File Operation Recovery Strategies

When file operations fail:
- **Cannot edit file**: Read it first to understand structure, then retry with correct content
- **File not found**: Use `ls` or `glob` to discover actual file locations
- **Permission denied**: Check path correctness, try alternative locations
- **Edit conflict**: Read current content, merge your changes, write complete file
- **Large file issues**: Work with smaller chunks or specific line ranges
"""
```

### agent.py - New Parameters

```python
def create_deep_agent(
    # ... existing params ...
    
    # Loop detection configuration (new)
    loop_history_size: int = 20,
    loop_consecutive_threshold: int = 7,
    loop_total_threshold: int = 20,
    
    # ... rest of params ...
)
```

## Testing Strategy

1. **Unit tests** for new prompt enhancement functions
2. **Integration test** verifying loop detection respects new thresholds
3. **Manual test** with a scenario that previously caused early termination

## Backward Compatibility

- All new parameters have defaults matching "optimal" values
- Existing code calling `create_deep_agent()` without new params continues to work
- No breaking changes to public API