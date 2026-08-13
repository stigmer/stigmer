from ai.stigmer.agentic.agentexecution.v1 import enum_pb2 as _enum_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class SummarizationEvent(_message.Message):
    __slots__ = ("timestamp", "tokens_before", "tokens_after", "compression_ratio", "duration_ms", "summarization_model", "messages_before", "messages_after", "source", "summarization_input_tokens", "summarization_output_tokens", "summarization_cost_usd")
    TIMESTAMP_FIELD_NUMBER: _ClassVar[int]
    TOKENS_BEFORE_FIELD_NUMBER: _ClassVar[int]
    TOKENS_AFTER_FIELD_NUMBER: _ClassVar[int]
    COMPRESSION_RATIO_FIELD_NUMBER: _ClassVar[int]
    DURATION_MS_FIELD_NUMBER: _ClassVar[int]
    SUMMARIZATION_MODEL_FIELD_NUMBER: _ClassVar[int]
    MESSAGES_BEFORE_FIELD_NUMBER: _ClassVar[int]
    MESSAGES_AFTER_FIELD_NUMBER: _ClassVar[int]
    SOURCE_FIELD_NUMBER: _ClassVar[int]
    SUMMARIZATION_INPUT_TOKENS_FIELD_NUMBER: _ClassVar[int]
    SUMMARIZATION_OUTPUT_TOKENS_FIELD_NUMBER: _ClassVar[int]
    SUMMARIZATION_COST_USD_FIELD_NUMBER: _ClassVar[int]
    timestamp: str
    tokens_before: int
    tokens_after: int
    compression_ratio: float
    duration_ms: int
    summarization_model: str
    messages_before: int
    messages_after: int
    source: _enum_pb2.SummarizationSource
    summarization_input_tokens: int
    summarization_output_tokens: int
    summarization_cost_usd: float
    def __init__(self, timestamp: _Optional[str] = ..., tokens_before: _Optional[int] = ..., tokens_after: _Optional[int] = ..., compression_ratio: _Optional[float] = ..., duration_ms: _Optional[int] = ..., summarization_model: _Optional[str] = ..., messages_before: _Optional[int] = ..., messages_after: _Optional[int] = ..., source: _Optional[_Union[_enum_pb2.SummarizationSource, str]] = ..., summarization_input_tokens: _Optional[int] = ..., summarization_output_tokens: _Optional[int] = ..., summarization_cost_usd: _Optional[float] = ...) -> None: ...

class ContextInfo(_message.Message):
    __slots__ = ("current_token_count", "context_window_limit", "summarization_trigger_threshold", "summarization_target_tokens", "summarization_enabled", "summarization_events", "utilization_percent")
    CURRENT_TOKEN_COUNT_FIELD_NUMBER: _ClassVar[int]
    CONTEXT_WINDOW_LIMIT_FIELD_NUMBER: _ClassVar[int]
    SUMMARIZATION_TRIGGER_THRESHOLD_FIELD_NUMBER: _ClassVar[int]
    SUMMARIZATION_TARGET_TOKENS_FIELD_NUMBER: _ClassVar[int]
    SUMMARIZATION_ENABLED_FIELD_NUMBER: _ClassVar[int]
    SUMMARIZATION_EVENTS_FIELD_NUMBER: _ClassVar[int]
    UTILIZATION_PERCENT_FIELD_NUMBER: _ClassVar[int]
    current_token_count: int
    context_window_limit: int
    summarization_trigger_threshold: int
    summarization_target_tokens: int
    summarization_enabled: bool
    summarization_events: _containers.RepeatedCompositeFieldContainer[SummarizationEvent]
    utilization_percent: float
    def __init__(self, current_token_count: _Optional[int] = ..., context_window_limit: _Optional[int] = ..., summarization_trigger_threshold: _Optional[int] = ..., summarization_target_tokens: _Optional[int] = ..., summarization_enabled: bool = ..., summarization_events: _Optional[_Iterable[_Union[SummarizationEvent, _Mapping]]] = ..., utilization_percent: _Optional[float] = ...) -> None: ...
