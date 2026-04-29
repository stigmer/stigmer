from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class UsageMetrics(_message.Message):
    __slots__ = ("prompt_tokens", "completion_tokens", "total_tokens", "llm_call_count", "primary_model", "cache_creation_tokens", "cache_read_tokens", "model_breakdown", "estimated_cost_usd", "tool_result_chars_truncated", "llm_calls", "total_duration_ms", "llm_duration_ms", "tool_duration_ms", "approval_wait_duration_ms", "primary_provider")
    PROMPT_TOKENS_FIELD_NUMBER: _ClassVar[int]
    COMPLETION_TOKENS_FIELD_NUMBER: _ClassVar[int]
    TOTAL_TOKENS_FIELD_NUMBER: _ClassVar[int]
    LLM_CALL_COUNT_FIELD_NUMBER: _ClassVar[int]
    PRIMARY_MODEL_FIELD_NUMBER: _ClassVar[int]
    CACHE_CREATION_TOKENS_FIELD_NUMBER: _ClassVar[int]
    CACHE_READ_TOKENS_FIELD_NUMBER: _ClassVar[int]
    MODEL_BREAKDOWN_FIELD_NUMBER: _ClassVar[int]
    ESTIMATED_COST_USD_FIELD_NUMBER: _ClassVar[int]
    TOOL_RESULT_CHARS_TRUNCATED_FIELD_NUMBER: _ClassVar[int]
    LLM_CALLS_FIELD_NUMBER: _ClassVar[int]
    TOTAL_DURATION_MS_FIELD_NUMBER: _ClassVar[int]
    LLM_DURATION_MS_FIELD_NUMBER: _ClassVar[int]
    TOOL_DURATION_MS_FIELD_NUMBER: _ClassVar[int]
    APPROVAL_WAIT_DURATION_MS_FIELD_NUMBER: _ClassVar[int]
    PRIMARY_PROVIDER_FIELD_NUMBER: _ClassVar[int]
    prompt_tokens: int
    completion_tokens: int
    total_tokens: int
    llm_call_count: int
    primary_model: str
    cache_creation_tokens: int
    cache_read_tokens: int
    model_breakdown: _containers.RepeatedCompositeFieldContainer[ModelUsage]
    estimated_cost_usd: float
    tool_result_chars_truncated: int
    llm_calls: _containers.RepeatedCompositeFieldContainer[LlmCallMetrics]
    total_duration_ms: int
    llm_duration_ms: int
    tool_duration_ms: int
    approval_wait_duration_ms: int
    primary_provider: str
    def __init__(self, prompt_tokens: _Optional[int] = ..., completion_tokens: _Optional[int] = ..., total_tokens: _Optional[int] = ..., llm_call_count: _Optional[int] = ..., primary_model: _Optional[str] = ..., cache_creation_tokens: _Optional[int] = ..., cache_read_tokens: _Optional[int] = ..., model_breakdown: _Optional[_Iterable[_Union[ModelUsage, _Mapping]]] = ..., estimated_cost_usd: _Optional[float] = ..., tool_result_chars_truncated: _Optional[int] = ..., llm_calls: _Optional[_Iterable[_Union[LlmCallMetrics, _Mapping]]] = ..., total_duration_ms: _Optional[int] = ..., llm_duration_ms: _Optional[int] = ..., tool_duration_ms: _Optional[int] = ..., approval_wait_duration_ms: _Optional[int] = ..., primary_provider: _Optional[str] = ...) -> None: ...

class ModelUsage(_message.Message):
    __slots__ = ("model", "provider", "input_tokens", "output_tokens", "cache_creation_tokens", "cache_read_tokens", "call_count", "input_price_per_million", "output_price_per_million", "cache_creation_price_per_million", "cache_read_price_per_million", "estimated_cost_usd")
    MODEL_FIELD_NUMBER: _ClassVar[int]
    PROVIDER_FIELD_NUMBER: _ClassVar[int]
    INPUT_TOKENS_FIELD_NUMBER: _ClassVar[int]
    OUTPUT_TOKENS_FIELD_NUMBER: _ClassVar[int]
    CACHE_CREATION_TOKENS_FIELD_NUMBER: _ClassVar[int]
    CACHE_READ_TOKENS_FIELD_NUMBER: _ClassVar[int]
    CALL_COUNT_FIELD_NUMBER: _ClassVar[int]
    INPUT_PRICE_PER_MILLION_FIELD_NUMBER: _ClassVar[int]
    OUTPUT_PRICE_PER_MILLION_FIELD_NUMBER: _ClassVar[int]
    CACHE_CREATION_PRICE_PER_MILLION_FIELD_NUMBER: _ClassVar[int]
    CACHE_READ_PRICE_PER_MILLION_FIELD_NUMBER: _ClassVar[int]
    ESTIMATED_COST_USD_FIELD_NUMBER: _ClassVar[int]
    model: str
    provider: str
    input_tokens: int
    output_tokens: int
    cache_creation_tokens: int
    cache_read_tokens: int
    call_count: int
    input_price_per_million: float
    output_price_per_million: float
    cache_creation_price_per_million: float
    cache_read_price_per_million: float
    estimated_cost_usd: float
    def __init__(self, model: _Optional[str] = ..., provider: _Optional[str] = ..., input_tokens: _Optional[int] = ..., output_tokens: _Optional[int] = ..., cache_creation_tokens: _Optional[int] = ..., cache_read_tokens: _Optional[int] = ..., call_count: _Optional[int] = ..., input_price_per_million: _Optional[float] = ..., output_price_per_million: _Optional[float] = ..., cache_creation_price_per_million: _Optional[float] = ..., cache_read_price_per_million: _Optional[float] = ..., estimated_cost_usd: _Optional[float] = ...) -> None: ...

class LlmCallMetrics(_message.Message):
    __slots__ = ("sequence", "model", "provider", "input_tokens", "output_tokens", "cache_creation_tokens", "cache_read_tokens", "estimated_cost_usd", "duration_ms", "timestamp", "total_tokens")
    SEQUENCE_FIELD_NUMBER: _ClassVar[int]
    MODEL_FIELD_NUMBER: _ClassVar[int]
    PROVIDER_FIELD_NUMBER: _ClassVar[int]
    INPUT_TOKENS_FIELD_NUMBER: _ClassVar[int]
    OUTPUT_TOKENS_FIELD_NUMBER: _ClassVar[int]
    CACHE_CREATION_TOKENS_FIELD_NUMBER: _ClassVar[int]
    CACHE_READ_TOKENS_FIELD_NUMBER: _ClassVar[int]
    ESTIMATED_COST_USD_FIELD_NUMBER: _ClassVar[int]
    DURATION_MS_FIELD_NUMBER: _ClassVar[int]
    TIMESTAMP_FIELD_NUMBER: _ClassVar[int]
    TOTAL_TOKENS_FIELD_NUMBER: _ClassVar[int]
    sequence: int
    model: str
    provider: str
    input_tokens: int
    output_tokens: int
    cache_creation_tokens: int
    cache_read_tokens: int
    estimated_cost_usd: float
    duration_ms: int
    timestamp: str
    total_tokens: int
    def __init__(self, sequence: _Optional[int] = ..., model: _Optional[str] = ..., provider: _Optional[str] = ..., input_tokens: _Optional[int] = ..., output_tokens: _Optional[int] = ..., cache_creation_tokens: _Optional[int] = ..., cache_read_tokens: _Optional[int] = ..., estimated_cost_usd: _Optional[float] = ..., duration_ms: _Optional[int] = ..., timestamp: _Optional[str] = ..., total_tokens: _Optional[int] = ...) -> None: ...
