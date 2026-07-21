import datetime

from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf import timestamp_pb2 as _timestamp_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class ModelPricingBaselineStatus(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    model_pricing_baseline_status_unspecified: _ClassVar[ModelPricingBaselineStatus]
    pricing_baseline_active: _ClassVar[ModelPricingBaselineStatus]
    pricing_baseline_superseded: _ClassVar[ModelPricingBaselineStatus]
    pricing_baseline_retired: _ClassVar[ModelPricingBaselineStatus]
model_pricing_baseline_status_unspecified: ModelPricingBaselineStatus
pricing_baseline_active: ModelPricingBaselineStatus
pricing_baseline_superseded: ModelPricingBaselineStatus
pricing_baseline_retired: ModelPricingBaselineStatus

class PricingBlock(_message.Message):
    __slots__ = ("input_price_micros_per_million", "output_price_micros_per_million", "cache_write_price_micros_per_million", "cache_read_price_micros_per_million", "cursor_token_rate_micros_per_million", "source", "source_note", "effective_at")
    INPUT_PRICE_MICROS_PER_MILLION_FIELD_NUMBER: _ClassVar[int]
    OUTPUT_PRICE_MICROS_PER_MILLION_FIELD_NUMBER: _ClassVar[int]
    CACHE_WRITE_PRICE_MICROS_PER_MILLION_FIELD_NUMBER: _ClassVar[int]
    CACHE_READ_PRICE_MICROS_PER_MILLION_FIELD_NUMBER: _ClassVar[int]
    CURSOR_TOKEN_RATE_MICROS_PER_MILLION_FIELD_NUMBER: _ClassVar[int]
    SOURCE_FIELD_NUMBER: _ClassVar[int]
    SOURCE_NOTE_FIELD_NUMBER: _ClassVar[int]
    EFFECTIVE_AT_FIELD_NUMBER: _ClassVar[int]
    input_price_micros_per_million: int
    output_price_micros_per_million: int
    cache_write_price_micros_per_million: int
    cache_read_price_micros_per_million: int
    cursor_token_rate_micros_per_million: int
    source: str
    source_note: str
    effective_at: _timestamp_pb2.Timestamp
    def __init__(self, input_price_micros_per_million: _Optional[int] = ..., output_price_micros_per_million: _Optional[int] = ..., cache_write_price_micros_per_million: _Optional[int] = ..., cache_read_price_micros_per_million: _Optional[int] = ..., cursor_token_rate_micros_per_million: _Optional[int] = ..., source: _Optional[str] = ..., source_note: _Optional[str] = ..., effective_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...

class PricingVariant(_message.Message):
    __slots__ = ("pricing", "wire_ids")
    PRICING_FIELD_NUMBER: _ClassVar[int]
    WIRE_IDS_FIELD_NUMBER: _ClassVar[int]
    pricing: PricingBlock
    wire_ids: _containers.RepeatedScalarFieldContainer[str]
    def __init__(self, pricing: _Optional[_Union[PricingBlock, _Mapping]] = ..., wire_ids: _Optional[_Iterable[str]] = ...) -> None: ...

class SummarizationConfig(_message.Message):
    __slots__ = ("trigger_threshold", "target_tokens", "max_summary_tokens")
    TRIGGER_THRESHOLD_FIELD_NUMBER: _ClassVar[int]
    TARGET_TOKENS_FIELD_NUMBER: _ClassVar[int]
    MAX_SUMMARY_TOKENS_FIELD_NUMBER: _ClassVar[int]
    trigger_threshold: int
    target_tokens: int
    max_summary_tokens: int
    def __init__(self, trigger_threshold: _Optional[int] = ..., target_tokens: _Optional[int] = ..., max_summary_tokens: _Optional[int] = ...) -> None: ...

class ModelCapabilities(_message.Message):
    __slots__ = ("tool_use", "vision", "streaming", "thinking", "adaptive_thinking")
    TOOL_USE_FIELD_NUMBER: _ClassVar[int]
    VISION_FIELD_NUMBER: _ClassVar[int]
    STREAMING_FIELD_NUMBER: _ClassVar[int]
    THINKING_FIELD_NUMBER: _ClassVar[int]
    ADAPTIVE_THINKING_FIELD_NUMBER: _ClassVar[int]
    tool_use: bool
    vision: bool
    streaming: bool
    thinking: bool
    adaptive_thinking: bool
    def __init__(self, tool_use: bool = ..., vision: bool = ..., streaming: bool = ..., thinking: bool = ..., adaptive_thinking: bool = ...) -> None: ...

class ModelPricingBaseline(_message.Message):
    __slots__ = ("baseline_id", "model_id", "api_model_id", "provider", "harness", "display_name", "short_description", "speed_tier", "cost_tier", "featured", "pricing", "pricing_variants", "context_window_tokens", "max_output_tokens", "token_counter_method", "summarization", "capabilities", "status", "supersedes_baseline_id", "decided_by", "decided_at", "revision_note", "created_at")
    class PricingVariantsEntry(_message.Message):
        __slots__ = ("key", "value")
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: PricingVariant
        def __init__(self, key: _Optional[str] = ..., value: _Optional[_Union[PricingVariant, _Mapping]] = ...) -> None: ...
    BASELINE_ID_FIELD_NUMBER: _ClassVar[int]
    MODEL_ID_FIELD_NUMBER: _ClassVar[int]
    API_MODEL_ID_FIELD_NUMBER: _ClassVar[int]
    PROVIDER_FIELD_NUMBER: _ClassVar[int]
    HARNESS_FIELD_NUMBER: _ClassVar[int]
    DISPLAY_NAME_FIELD_NUMBER: _ClassVar[int]
    SHORT_DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    SPEED_TIER_FIELD_NUMBER: _ClassVar[int]
    COST_TIER_FIELD_NUMBER: _ClassVar[int]
    FEATURED_FIELD_NUMBER: _ClassVar[int]
    PRICING_FIELD_NUMBER: _ClassVar[int]
    PRICING_VARIANTS_FIELD_NUMBER: _ClassVar[int]
    CONTEXT_WINDOW_TOKENS_FIELD_NUMBER: _ClassVar[int]
    MAX_OUTPUT_TOKENS_FIELD_NUMBER: _ClassVar[int]
    TOKEN_COUNTER_METHOD_FIELD_NUMBER: _ClassVar[int]
    SUMMARIZATION_FIELD_NUMBER: _ClassVar[int]
    CAPABILITIES_FIELD_NUMBER: _ClassVar[int]
    STATUS_FIELD_NUMBER: _ClassVar[int]
    SUPERSEDES_BASELINE_ID_FIELD_NUMBER: _ClassVar[int]
    DECIDED_BY_FIELD_NUMBER: _ClassVar[int]
    DECIDED_AT_FIELD_NUMBER: _ClassVar[int]
    REVISION_NOTE_FIELD_NUMBER: _ClassVar[int]
    CREATED_AT_FIELD_NUMBER: _ClassVar[int]
    baseline_id: str
    model_id: str
    api_model_id: str
    provider: str
    harness: str
    display_name: str
    short_description: str
    speed_tier: str
    cost_tier: str
    featured: bool
    pricing: PricingBlock
    pricing_variants: _containers.MessageMap[str, PricingVariant]
    context_window_tokens: int
    max_output_tokens: int
    token_counter_method: str
    summarization: SummarizationConfig
    capabilities: ModelCapabilities
    status: ModelPricingBaselineStatus
    supersedes_baseline_id: str
    decided_by: str
    decided_at: _timestamp_pb2.Timestamp
    revision_note: str
    created_at: _timestamp_pb2.Timestamp
    def __init__(self, baseline_id: _Optional[str] = ..., model_id: _Optional[str] = ..., api_model_id: _Optional[str] = ..., provider: _Optional[str] = ..., harness: _Optional[str] = ..., display_name: _Optional[str] = ..., short_description: _Optional[str] = ..., speed_tier: _Optional[str] = ..., cost_tier: _Optional[str] = ..., featured: bool = ..., pricing: _Optional[_Union[PricingBlock, _Mapping]] = ..., pricing_variants: _Optional[_Mapping[str, PricingVariant]] = ..., context_window_tokens: _Optional[int] = ..., max_output_tokens: _Optional[int] = ..., token_counter_method: _Optional[str] = ..., summarization: _Optional[_Union[SummarizationConfig, _Mapping]] = ..., capabilities: _Optional[_Union[ModelCapabilities, _Mapping]] = ..., status: _Optional[_Union[ModelPricingBaselineStatus, str]] = ..., supersedes_baseline_id: _Optional[str] = ..., decided_by: _Optional[str] = ..., decided_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., revision_note: _Optional[str] = ..., created_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...
