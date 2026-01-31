# Task T01: Context Summarization - Implementation Plan

**Created**: 2026-01-31
**Revised**: 2026-01-31 (enhanced with Model Registry)
**Status**: APPROVED
**Type**: Integration + Evaluation

---

## Executive Summary

Implement intelligent context window management using **LangMem's `SummarizationNode`**, backed by a **comprehensive Model Registry** that provides context window metadata for all supported models.

**Key Enhancement**: Instead of hardcoding model defaults in `SummarizationConfig`, we'll create a centralized `ModelRegistry` that serves as the single source of truth for all model metadata, including context windows, summarization thresholds, token counting methods, and cost tiers.

---

## Part 1: Technology Landscape Analysis

### What We Found

| Solution | Stars | What It Does | Fit for Stigmer |
|----------|-------|--------------|-----------------|
| **LangMem** | 1.3K | LangGraph-native memory management with `SummarizationNode` | **HIGH** - Same ecosystem, direct integration |
| **Mem0** | 46K | Cross-session fact extraction, vector-based retrieval | **MEDIUM** - Solves different problem (long-term memory) |
| **Zep** | 3K | Temporal knowledge graphs for enterprise agents | **LOW** - Overkill for summarization |
| **ConversationSummaryMemory** | - | LangChain legacy summarization | **LOW** - Superseded by LangMem |

### LangMem's `SummarizationNode`

From [LangMem documentation](https://langchain-ai.github.io/langmem/reference/short_term/):

```python
from langmem.short_term import SummarizationNode

summarization_node = SummarizationNode(
    model=summarization_model,
    max_tokens=80000,                  # Max tokens in final output
    max_tokens_before_summary=90000,   # When to trigger summarization
    max_summary_tokens=2000,           # Budget for summary itself
    token_counter=model.get_num_tokens_from_messages,  # Accurate counting
)
```

**What it handles automatically**:
- Token counting (approximate or model-specific)
- Running summaries (doesn't re-summarize already summarized content)
- Tool call handling (summarizes tool messages with their AI message)
- Customizable prompts for initial and incremental summaries

### Why LangMem First

1. **Same ecosystem** - Built by LangChain team for LangGraph
2. **Battle-tested** - v0.0.30 released October 2025, active development
3. **Minimal integration** - Works with existing checkpointer infrastructure
4. **No new dependencies** - Just `pip install langmem`

---

## Part 2: Architecture

### Model Registry Design

The Model Registry provides a centralized, single source of truth for all model metadata:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              MODEL REGISTRY                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ModelMetadata (dataclass, frozen=True)                                     │
│  ├─ model_id: str                    # Canonical identifier                 │
│  ├─ provider: str                    # anthropic, openai, ollama            │
│  ├─ display_name: str                # Human-readable name                  │
│  │                                                                          │
│  ├─ context_window_tokens: int       # Total context window size            │
│  ├─ max_output_tokens: int           # Max tokens in completion             │
│  │                                                                          │
│  ├─ summarization_trigger_threshold: int   # When to trigger (~90%)         │
│  ├─ summarization_target_tokens: int       # Target after (~80%)            │
│  ├─ max_summary_tokens: int                # Budget for summary             │
│  │                                                                          │
│  ├─ token_counter_method: TokenCounterMethod  # How to count tokens         │
│  │                                                                          │
│  ├─ cost_tier: CostTier              # economy/standard/premium             │
│  ├─ input_cost_per_1k: float | None  # USD per 1K input tokens              │
│  └─ output_cost_per_1k: float | None # USD per 1K output tokens             │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Supported Models (Complete List)

| Model | Context Window | Trigger | Target | Cost Tier |
|-------|---------------|---------|--------|-----------|
| **Anthropic** |
| claude-opus-4 | 200K | 180K | 160K | Premium |
| claude-sonnet-4.5 | 200K | 180K | 160K | Standard |
| claude-haiku-4 | 200K | 180K | 160K | Economy |
| claude-sonnet-3.5 | 200K | 180K | 160K | Standard |
| claude-haiku-3.5 | 200K | 180K | 160K | Economy |
| **OpenAI** |
| gpt-4 | 8K | 7K | 6K | Premium |
| gpt-4-turbo | 128K | 115K | 100K | Standard |
| gpt-4o | 128K | 115K | 100K | Standard |
| gpt-4o-mini | 128K | 115K | 100K | Economy |
| gpt-3.5-turbo | 16K | 14K | 12K | Economy |
| o1 | 200K | 180K | 160K | Premium |
| o1-mini | 128K | 115K | 100K | Standard |
| **Ollama (Local)** |
| qwen2.5-coder:7b | 32K | 28K | 24K | Economy |
| qwen2.5-coder:14b | 32K | 28K | 24K | Economy |
| codellama:7b | 16K | 14K | 12K | Economy |
| codellama:13b | 16K | 14K | 12K | Economy |
| deepseek-coder-v2:16b | 128K | 115K | 100K | Economy |
| llama3.2:3b | 128K | 115K | 100K | Economy |
| mistral:7b | 32K | 28K | 24K | Economy |

### Implementation Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         IMPLEMENTATION PHASES                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Phase 1: Model Registry + LangMem Evaluation (3 days)                      │
│  ├─ Create ModelMetadata dataclass with all fields                          │
│  ├─ Create ModelRegistry with all supported models                          │
│  ├─ Add langmem dependency and create evaluation script                     │
│  ├─ Test summarization quality with realistic workloads                     │
│  └─ Create new model onboarding documentation                               │
│                                                                             │
│  Phase 2: Integrate into Graphton (3 days)                                  │
│  ├─ Create SummarizationConfig using ModelRegistry                          │
│  ├─ Add SummarizationNode to agent graph                                    │
│  ├─ Wire up configuration in execute_graphton.py                            │
│  └─ Test with existing agent workloads                                      │
│                                                                             │
│  Phase 3: Platform Features (3 days)                                        │
│  ├─ Add ContextManagementConfig to Agent proto                              │
│  ├─ Add ContextInfo to AgentExecutionStatus proto                           │
│  ├─ Track summarization events in StatusBuilder                             │
│  └─ Add metrics and observability                                           │
│                                                                             │
│  Phase 4: Testing & Validation (2 days)                                     │
│  ├─ E2E tests with 100+ turn conversations                                  │
│  ├─ Test unknown model handling (graceful defaults)                         │
│  ├─ Validate key facts preserved > 90%                                      │
│  └─ Verify latency < 2s p95                                                 │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Part 3: Detailed Phase Plans

### Phase 1: Model Registry + LangMem Evaluation (3 days)

**Goal**: Create comprehensive Model Registry and verify LangMem meets quality bar.

#### Task 1.1: Create Model Registry

**File**: `backend/libs/python/graphton/src/graphton/core/model_registry.py`

```python
from dataclasses import dataclass
from enum import Enum
from typing import Callable

class CostTier(Enum):
    """Cost tier for model usage - affects summarization model selection."""
    ECONOMY = "economy"      # Cheapest, fastest
    STANDARD = "standard"    # Balanced
    PREMIUM = "premium"      # Highest quality, expensive

class TokenCounterMethod(Enum):
    """Token counting strategy for the model."""
    TIKTOKEN_CL100K = "tiktoken_cl100k"    # GPT-4, GPT-3.5
    TIKTOKEN_O200K = "tiktoken_o200k"       # GPT-4o, o1
    ANTHROPIC_NATIVE = "anthropic_native"  # Claude models
    APPROXIMATE = "approximate"             # chars/4 fallback

@dataclass(frozen=True)
class ModelMetadata:
    """Immutable metadata for a supported model.
    
    This dataclass serves as the single source of truth for all model
    capabilities and configurations. All model-specific logic should
    query this registry rather than hardcoding values.
    """
    
    # Identity
    model_id: str                      # Canonical model identifier
    provider: str                      # anthropic, openai, ollama
    display_name: str                  # Human-readable name
    
    # Context Window
    context_window_tokens: int         # Total context window size
    max_output_tokens: int             # Max tokens in completion
    
    # Summarization Thresholds (derived from context window)
    summarization_trigger_threshold: int   # When to trigger summarization
    summarization_target_tokens: int       # Target after summarization
    max_summary_tokens: int                # Budget for summary itself
    
    # Token Counting
    token_counter_method: TokenCounterMethod
    
    # Economics
    cost_tier: CostTier
    input_cost_per_1k: float | None = None    # USD per 1K input tokens
    output_cost_per_1k: float | None = None   # USD per 1K output tokens
    
    # Capabilities
    supports_tool_use: bool = True
    supports_vision: bool = False
    supports_streaming: bool = True


class ModelRegistry:
    """Central registry for all supported model metadata.
    
    Design Principles:
    1. Single Source of Truth - All model metadata lives here
    2. Fail-Safe Defaults - Unknown models get conservative defaults
    3. Cost-Aware - Summarization uses economy-tier models by default
    4. Extensible - Adding new models = adding one entry
    """
    
    # Registry populated with all models from table above
    _MODELS: dict[str, ModelMetadata] = {
        # Anthropic models
        "claude-opus-4": ModelMetadata(...),
        "claude-sonnet-4.5": ModelMetadata(...),
        # ... all models from table
    }
    
    @classmethod
    def get(cls, model_id: str) -> ModelMetadata:
        """Get metadata for a model.
        
        Raises:
            KeyError: If model not found in registry
        """
        
    @classmethod
    def get_or_default(cls, model_id: str, provider: str = "unknown") -> ModelMetadata:
        """Get metadata or return sensible defaults for unknown models.
        
        Default: 8K context window, economy tier, approximate token counting.
        This ensures graceful degradation for new/custom models.
        """
        
    @classmethod
    def get_summarization_model(cls, primary_model: str) -> str:
        """Get recommended summarization model for a primary model.
        
        Strategy: Use economy-tier model from same provider.
        - Anthropic models -> claude-haiku-4
        - OpenAI models -> gpt-4o-mini
        - Ollama models -> same model (local, no cost)
        """
        
    @classmethod
    def list_by_provider(cls, provider: str) -> list[ModelMetadata]:
        """List all models for a provider."""
        
    @classmethod
    def validate_model(cls, model_id: str) -> bool:
        """Check if model is in registry."""
```

#### Task 1.2: LangMem Evaluation

**File**: `backend/services/agent-runner/tests/langmem_evaluation.py`

- [ ] Add `langmem` to agent-runner dependencies
- [ ] Test with 50+ message conversations
- [ ] Verify key facts are preserved in summaries
- [ ] Test with tool-heavy conversations
- [ ] Measure latency (<2s p95 target)
- [ ] Document any gaps found

```python
import asyncio
from langmem.short_term import SummarizationNode, summarize_messages
from langchain_openai import ChatOpenAI
from langchain_core.messages import HumanMessage, AIMessage, ToolMessage

async def evaluate_summarization_quality():
    """Evaluate LangMem summarization on realistic conversations."""
    
    model = ChatOpenAI(model="gpt-4o-mini")
    
    messages = [
        HumanMessage(content="My database is PostgreSQL 14 on AWS RDS"),
        AIMessage(content="Got it. I'll use pg_dump for backups."),
        HumanMessage(content="The connection uses SSL mode=verify-full"),
        AIMessage(content="Noted. I'll configure SSL in the backup script."),
        # ... add 50+ realistic messages
    ]
    
    result = summarize_messages(
        messages=messages,
        running_summary=None,
        model=model,
        max_tokens=8000,
        max_tokens_before_summary=10000,
        max_summary_tokens=500,
    )
    
    # Verify key facts are preserved
    summary_text = result.messages[0].content if result.running_summary else ""
    
    assert "PostgreSQL" in summary_text, "Lost database type"
    assert "SSL" in summary_text or "verify-full" in summary_text, "Lost SSL config"
    
    return result
```

#### Task 1.3: New Model Onboarding Document

**File**: `docs/engineering/adding-new-models.md`

Create documentation specifying prerequisites for adding new model support:

**Required Information**:
1. Context window size (tokens)
2. Maximum output tokens
3. Token counting method (tiktoken encoding, native API, approximate)
4. Summarization thresholds (trigger ~90%, target ~80%)
5. Cost per 1K tokens (input/output)
6. Cost tier classification
7. Capabilities (tool use, vision, streaming)
8. LangChain integration class
9. Required environment variables

**Checklist Template** for new models.

#### Deliverables
- ModelRegistry with all supported models
- LangMem evaluation report with test results
- New model onboarding documentation
- Go/no-go decision for integration

---

### Phase 2: Integrate into Graphton (3 days)

**Goal**: Add summarization to the agent execution pipeline using ModelRegistry.

#### Tasks

1. **Create SummarizationConfig Using Registry**
   - [ ] Create `SummarizationConfig` dataclass
   - [ ] Implement `for_model()` factory method using ModelRegistry
   - [ ] Auto-select economy-tier summarization model

2. **Modify Graphton Agent Creation**
   - [ ] Add `SummarizationNode` to agent graph
   - [ ] Position it before the main agent node
   - [ ] Pass through checkpointer for state persistence

3. **Integration with execute_graphton.py**
   - [ ] Load summarization config from agent/execution
   - [ ] Initialize `SummarizationNode` with model-specific thresholds
   - [ ] Handle state updates from summarization

#### Configuration Dataclass

```python
# In: backend/services/agent-runner/worker/config.py

from graphton.core.model_registry import ModelRegistry

@dataclass
class SummarizationConfig:
    """Configuration for context summarization.
    
    Uses ModelRegistry for model-specific defaults. Override thresholds
    only when needed - the registry provides sensible defaults for all
    supported models.
    """
    
    enabled: bool = False
    
    # Override thresholds (None = use registry defaults)
    max_tokens: int | None = None
    trigger_threshold: int | None = None
    max_summary_tokens: int = 2000
    
    # Model for summarization (None = auto-select economy tier)
    summarization_model: str | None = None
    
    @classmethod
    def for_model(cls, model_id: str, enabled: bool = True) -> "SummarizationConfig":
        """Create config with model-appropriate defaults from registry."""
        metadata = ModelRegistry.get_or_default(model_id)
        
        return cls(
            enabled=enabled,
            max_tokens=metadata.summarization_target_tokens,
            trigger_threshold=metadata.summarization_trigger_threshold,
            max_summary_tokens=metadata.max_summary_tokens,
            summarization_model=ModelRegistry.get_summarization_model(model_id),
        )
```

#### Integration Point

```python
# In: backend/libs/python/graphton/src/graphton/core/agent.py

from langmem.short_term import SummarizationNode

def create_deep_agent(
    model,
    system_prompt: str,
    # ... existing params ...
    summarization_config: SummarizationConfig | None = None,  # NEW
):
    """Create a deep agent with optional context summarization."""
    
    # ... existing setup ...
    
    # Add summarization node if configured
    if summarization_config and summarization_config.enabled:
        summarization_node = SummarizationNode(
            model=summarization_config.model or ChatOpenAI(model="gpt-4o-mini"),
            max_tokens=summarization_config.max_tokens,
            max_tokens_before_summary=summarization_config.trigger_threshold,
            max_summary_tokens=summarization_config.max_summary_tokens,
        )
        
        # Insert summarization before agent execution
        workflow.add_node("summarize", summarization_node)
        workflow.add_edge(START, "summarize")
        workflow.add_edge("summarize", "agent")
    else:
        workflow.add_edge(START, "agent")
    
    # ... rest of setup ...
```

---

### Phase 3: Platform Features (3 days)

**Goal**: Add platform-specific capabilities around the core summarization.

#### Tasks

1. **Proto Updates**
   - [ ] Add `ContextManagementConfig` to `AgentSpec`
   - [ ] Add `ContextInfo` to `AgentExecutionStatus`
   - [ ] Add `SummarizationEvent` message

2. **StatusBuilder Integration**
   - [ ] Track when summarization occurs
   - [ ] Report context utilization in status
   - [ ] Emit summarization events

3. **Observability**
   - [ ] Add metrics (summarization count, latency, compression ratio)
   - [ ] Add structured logging
   - [ ] Dashboard for context health

#### Proto Definitions

```protobuf
// In: apis/protos/ai/stigmer/agentic/agent/v1/api.proto

message AgentSpec {
  // ... existing fields ...
  
  // Context management configuration
  ContextManagementConfig context_config = 25;
}

message ContextManagementConfig {
  // Enable automatic context summarization
  bool enable_summarization = 1;
  
  // Override default token thresholds (model-aware defaults used if not set)
  int32 max_tokens = 2;
  int32 trigger_threshold = 3;
  
  // Model for summarization (default: auto-select economy tier)
  string summarization_model = 4;
}

// In: apis/protos/ai/stigmer/agentic/agentexecution/v1/api.proto

message AgentExecutionStatus {
  // ... existing fields ...
  
  // Context utilization info (for UI)
  ContextInfo context_info = 20;
}

message ContextInfo {
  int32 current_tokens = 1;
  int32 max_tokens = 2;
  double utilization_percent = 3;
  bool context_was_summarized = 4;
  repeated SummarizationEvent summarization_events = 5;
}

message SummarizationEvent {
  string thread_id = 1;
  int32 messages_summarized = 2;
  double compression_ratio = 3;
  int32 duration_ms = 4;
  google.protobuf.Timestamp occurred_at = 5;
}
```

---

### Phase 4: Testing & Validation (2 days)

**Goal**: Validate the integration meets requirements.

#### Success Criteria

| Criteria | Target | How to Measure |
|----------|--------|----------------|
| 100+ turn conversations | No failures | E2E test with 100 turns |
| Context utilization | < 90% of limit | Monitor `context_info.utilization_percent` |
| Key facts preserved | > 90% retention | Manual review of summaries |
| Summarization latency | < 2s p95 | Metrics dashboard |
| No data loss | 100% | Full history in DB, verify audit trail |
| Unknown model handling | Graceful defaults | Unit test with unknown model |

#### Test Plan

1. **Unit Tests**
   - ModelRegistry.get() for all supported models
   - ModelRegistry.get_or_default() for unknown models
   - ModelRegistry.get_summarization_model() selection logic
   - SummarizationConfig.for_model() with various models
   - Integration with existing checkpointer

2. **Integration Tests**
   - End-to-end with mock conversations
   - Multi-summarization cycles
   - HITL interrupt/resume with summarization

3. **E2E Tests**
   - 100-turn conversation with GPT-4 (8K context)
   - 100-turn conversation with Claude (200K context, verify trigger)
   - Tool-heavy workflow (file operations)
   - Sub-agent executions

#### Evaluation Decision

After Phase 4, answer:

| Question | If YES | If NO |
|----------|--------|-------|
| Does summarization quality meet bar? | Ship it | Consider custom summarizer |
| Is latency acceptable? | Ship it | Optimize or use faster model |
| Are there critical missing features? | Plan Phase 5 | Ship it |

---

## Part 4: Timeline

| Phase | Duration | Dependencies |
|-------|----------|--------------|
| Phase 1: Model Registry + LangMem Evaluation | 3 days | None |
| Phase 2: Integration | 3 days | Phase 1 go-decision |
| Phase 3: Platform Features | 3 days | Phase 2 complete |
| Phase 4: Testing | 2 days | Phase 3 complete |
| **Total** | **~11 days** | |

Compare to original plan: **4 weeks → ~2 weeks** (50% reduction)

---

## Part 5: What We're NOT Building (For Now)

The original design included these features. We're deferring them pending evaluation:

| Feature | Status | Rationale |
|---------|--------|-----------|
| Three-layer memory (semantic/episodic/working) | **Deferred** | LangMem's single-summary approach may be sufficient |
| Custom fact extraction | **Deferred** | Evaluate if LangMem summaries capture key facts |
| Quality scoring/re-generation | **Deferred** | Test if LangMem quality is good enough |
| Cross-session memory | **Future** | Different problem; consider Mem0 later |

**The original design document is preserved** at `design-decisions/DD001-three-layer-memory-architecture.md` as reference if we need to build custom.

---

## Part 6: Risks and Mitigations

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| LangMem summary quality insufficient | High | Medium | Have custom design ready; evaluate early |
| LangMem doesn't handle tool calls well | Medium | Low | Test specifically; may need wrapper |
| Integration complexity with Graphton | Medium | Medium | Isolated integration; fallback to manual |
| Performance overhead | Medium | Low | Use cheap model from same provider |
| New model missing from registry | Low | Medium | Graceful defaults via get_or_default() |

---

## Part 7: Files to Create/Modify

### New Files

| File | Purpose |
|------|---------|
| `backend/libs/python/graphton/src/graphton/core/model_registry.py` | Centralized model metadata registry |
| `backend/services/agent-runner/worker/context/__init__.py` | Context management module |
| `backend/services/agent-runner/worker/context/summarization.py` | LangMem integration wrapper |
| `backend/services/agent-runner/tests/test_summarization.py` | Unit tests |
| `backend/services/agent-runner/tests/langmem_evaluation.py` | Evaluation script |
| `docs/engineering/adding-new-models.md` | New model onboarding checklist |

### Modified Files

| File | Changes |
|------|---------|
| `backend/libs/python/graphton/src/graphton/core/models.py` | Import and use ModelRegistry |
| `backend/libs/python/graphton/src/graphton/core/agent.py` | Add summarization node |
| `backend/services/agent-runner/worker/config.py` | Add `SummarizationConfig` |
| `backend/services/agent-runner/worker/activities/execute_graphton.py` | Initialize summarization |
| `backend/services/agent-runner/worker/activities/graphton/status_builder.py` | Track summarization events |
| `apis/protos/ai/stigmer/agentic/agent/v1/api.proto` | Add `ContextManagementConfig` |
| `apis/protos/ai/stigmer/agentic/agentexecution/v1/api.proto` | Add `ContextInfo` |

---

## Part 8: Design Principles

These principles ensure this foundational code meets the standards of a world-class platform:

1. **Single Source of Truth**: All model metadata lives in `ModelRegistry` - no scattered hardcoded values
2. **Fail-Safe Defaults**: Unknown models get conservative defaults (8K context) - graceful degradation
3. **Cost-Aware**: Summarization automatically uses economy-tier models from the same provider
4. **Extensible**: Adding new model support = adding one entry to registry + following checklist
5. **Well-Documented**: Prerequisites document ensures consistent onboarding of new models
6. **Immutable Data**: `ModelMetadata` is frozen dataclass - no accidental mutations
7. **Type-Safe**: Full type hints, enums for categories, validation on access

---

**Status**: APPROVED

Proceeding with Phase 1: Model Registry + LangMem Evaluation.
