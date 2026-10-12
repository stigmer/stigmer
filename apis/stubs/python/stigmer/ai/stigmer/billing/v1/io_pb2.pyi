import datetime

from ai.stigmer.agentic.run.v1 import enum_pb2 as _enum_pb2
from ai.stigmer.agentic.run.v1 import usage_pb2 as _usage_pb2
from ai.stigmer.billing.v1 import model_pricing_baseline_pb2 as _model_pricing_baseline_pb2
from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf import timestamp_pb2 as _timestamp_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class GetOrCreateBillingAccountInput(_message.Message):
    __slots__ = ("org",)
    ORG_FIELD_NUMBER: _ClassVar[int]
    org: str
    def __init__(self, org: _Optional[str] = ...) -> None: ...

class RecordLlmCallUsageInput(_message.Message):
    __slots__ = ("run_id", "sequence", "call_id", "provider", "resolved_model", "requested_model", "tokens", "usage_status", "provider_request_id", "http_status_code", "streaming", "finish_reason", "proxy_timing", "provider_usage_json", "harness", "served_service_tier", "metered_run", "provider_key_source")
    RUN_ID_FIELD_NUMBER: _ClassVar[int]
    SEQUENCE_FIELD_NUMBER: _ClassVar[int]
    CALL_ID_FIELD_NUMBER: _ClassVar[int]
    PROVIDER_FIELD_NUMBER: _ClassVar[int]
    RESOLVED_MODEL_FIELD_NUMBER: _ClassVar[int]
    REQUESTED_MODEL_FIELD_NUMBER: _ClassVar[int]
    TOKENS_FIELD_NUMBER: _ClassVar[int]
    USAGE_STATUS_FIELD_NUMBER: _ClassVar[int]
    PROVIDER_REQUEST_ID_FIELD_NUMBER: _ClassVar[int]
    HTTP_STATUS_CODE_FIELD_NUMBER: _ClassVar[int]
    STREAMING_FIELD_NUMBER: _ClassVar[int]
    FINISH_REASON_FIELD_NUMBER: _ClassVar[int]
    PROXY_TIMING_FIELD_NUMBER: _ClassVar[int]
    PROVIDER_USAGE_JSON_FIELD_NUMBER: _ClassVar[int]
    HARNESS_FIELD_NUMBER: _ClassVar[int]
    SERVED_SERVICE_TIER_FIELD_NUMBER: _ClassVar[int]
    METERED_RUN_FIELD_NUMBER: _ClassVar[int]
    PROVIDER_KEY_SOURCE_FIELD_NUMBER: _ClassVar[int]
    run_id: str
    sequence: int
    call_id: str
    provider: str
    resolved_model: str
    requested_model: str
    tokens: _usage_pb2.TokenUsage
    usage_status: _usage_pb2.UsageCompletionStatus
    provider_request_id: str
    http_status_code: int
    streaming: bool
    finish_reason: str
    proxy_timing: _usage_pb2.ProxyTiming
    provider_usage_json: str
    harness: str
    served_service_tier: str
    metered_run: MeteredRun
    provider_key_source: _usage_pb2.ProviderKeySource
    def __init__(self, run_id: _Optional[str] = ..., sequence: _Optional[int] = ..., call_id: _Optional[str] = ..., provider: _Optional[str] = ..., resolved_model: _Optional[str] = ..., requested_model: _Optional[str] = ..., tokens: _Optional[_Union[_usage_pb2.TokenUsage, _Mapping]] = ..., usage_status: _Optional[_Union[_usage_pb2.UsageCompletionStatus, str]] = ..., provider_request_id: _Optional[str] = ..., http_status_code: _Optional[int] = ..., streaming: bool = ..., finish_reason: _Optional[str] = ..., proxy_timing: _Optional[_Union[_usage_pb2.ProxyTiming, _Mapping]] = ..., provider_usage_json: _Optional[str] = ..., harness: _Optional[str] = ..., served_service_tier: _Optional[str] = ..., metered_run: _Optional[_Union[MeteredRun, _Mapping]] = ..., provider_key_source: _Optional[_Union[_usage_pb2.ProviderKeySource, str]] = ...) -> None: ...

class MeteredRun(_message.Message):
    __slots__ = ("session_id", "pinned_model", "requested_service_tier", "requested_thinking_mode")
    SESSION_ID_FIELD_NUMBER: _ClassVar[int]
    PINNED_MODEL_FIELD_NUMBER: _ClassVar[int]
    REQUESTED_SERVICE_TIER_FIELD_NUMBER: _ClassVar[int]
    REQUESTED_THINKING_MODE_FIELD_NUMBER: _ClassVar[int]
    session_id: str
    pinned_model: str
    requested_service_tier: _enum_pb2.ServiceTier
    requested_thinking_mode: _enum_pb2.ThinkingMode
    def __init__(self, session_id: _Optional[str] = ..., pinned_model: _Optional[str] = ..., requested_service_tier: _Optional[_Union[_enum_pb2.ServiceTier, str]] = ..., requested_thinking_mode: _Optional[_Union[_enum_pb2.ThinkingMode, str]] = ...) -> None: ...

class RecordLlmCallUsageResponse(_message.Message):
    __slots__ = ("usage_record_id", "is_duplicate")
    USAGE_RECORD_ID_FIELD_NUMBER: _ClassVar[int]
    IS_DUPLICATE_FIELD_NUMBER: _ClassVar[int]
    usage_record_id: str
    is_duplicate: bool
    def __init__(self, usage_record_id: _Optional[str] = ..., is_duplicate: bool = ...) -> None: ...

class CreateBillingPortalSessionInput(_message.Message):
    __slots__ = ("org", "return_url")
    ORG_FIELD_NUMBER: _ClassVar[int]
    RETURN_URL_FIELD_NUMBER: _ClassVar[int]
    org: str
    return_url: str
    def __init__(self, org: _Optional[str] = ..., return_url: _Optional[str] = ...) -> None: ...

class CreateBillingPortalSessionResponse(_message.Message):
    __slots__ = ("portal_url",)
    PORTAL_URL_FIELD_NUMBER: _ClassVar[int]
    portal_url: str
    def __init__(self, portal_url: _Optional[str] = ...) -> None: ...

class CreatePaymentMethodSetupSessionInput(_message.Message):
    __slots__ = ("org", "success_url", "cancel_url")
    ORG_FIELD_NUMBER: _ClassVar[int]
    SUCCESS_URL_FIELD_NUMBER: _ClassVar[int]
    CANCEL_URL_FIELD_NUMBER: _ClassVar[int]
    org: str
    success_url: str
    cancel_url: str
    def __init__(self, org: _Optional[str] = ..., success_url: _Optional[str] = ..., cancel_url: _Optional[str] = ...) -> None: ...

class CreatePaymentMethodSetupSessionResponse(_message.Message):
    __slots__ = ("setup_url", "checkout_session_id")
    SETUP_URL_FIELD_NUMBER: _ClassVar[int]
    CHECKOUT_SESSION_ID_FIELD_NUMBER: _ClassVar[int]
    setup_url: str
    checkout_session_id: str
    def __init__(self, setup_url: _Optional[str] = ..., checkout_session_id: _Optional[str] = ...) -> None: ...

class GetBillingAccountInput(_message.Message):
    __slots__ = ("org",)
    ORG_FIELD_NUMBER: _ClassVar[int]
    org: str
    def __init__(self, org: _Optional[str] = ...) -> None: ...

class GetBillingUsageReportInput(_message.Message):
    __slots__ = ("org", "start_time", "end_time")
    ORG_FIELD_NUMBER: _ClassVar[int]
    START_TIME_FIELD_NUMBER: _ClassVar[int]
    END_TIME_FIELD_NUMBER: _ClassVar[int]
    org: str
    start_time: _timestamp_pb2.Timestamp
    end_time: _timestamp_pb2.Timestamp
    def __init__(self, org: _Optional[str] = ..., start_time: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., end_time: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...

class BillingUsageReportResponse(_message.Message):
    __slots__ = ("run_count", "llm_call_count", "model_breakdown")
    RUN_COUNT_FIELD_NUMBER: _ClassVar[int]
    LLM_CALL_COUNT_FIELD_NUMBER: _ClassVar[int]
    MODEL_BREAKDOWN_FIELD_NUMBER: _ClassVar[int]
    run_count: int
    llm_call_count: int
    model_breakdown: _containers.RepeatedCompositeFieldContainer[ModelBillingBreakdown]
    def __init__(self, run_count: _Optional[int] = ..., llm_call_count: _Optional[int] = ..., model_breakdown: _Optional[_Iterable[_Union[ModelBillingBreakdown, _Mapping]]] = ...) -> None: ...

class ModelBillingBreakdown(_message.Message):
    __slots__ = ("model", "harness", "call_count")
    MODEL_FIELD_NUMBER: _ClassVar[int]
    HARNESS_FIELD_NUMBER: _ClassVar[int]
    CALL_COUNT_FIELD_NUMBER: _ClassVar[int]
    model: str
    harness: str
    call_count: int
    def __init__(self, model: _Optional[str] = ..., harness: _Optional[str] = ..., call_count: _Optional[int] = ...) -> None: ...

class UpsertModelPricingBaselineInput(_message.Message):
    __slots__ = ("baseline", "revision_note")
    BASELINE_FIELD_NUMBER: _ClassVar[int]
    REVISION_NOTE_FIELD_NUMBER: _ClassVar[int]
    baseline: _model_pricing_baseline_pb2.ModelPricingBaseline
    revision_note: str
    def __init__(self, baseline: _Optional[_Union[_model_pricing_baseline_pb2.ModelPricingBaseline, _Mapping]] = ..., revision_note: _Optional[str] = ...) -> None: ...

class RetireModelPricingBaselineInput(_message.Message):
    __slots__ = ("model_id", "provider", "harness", "revision_note")
    MODEL_ID_FIELD_NUMBER: _ClassVar[int]
    PROVIDER_FIELD_NUMBER: _ClassVar[int]
    HARNESS_FIELD_NUMBER: _ClassVar[int]
    REVISION_NOTE_FIELD_NUMBER: _ClassVar[int]
    model_id: str
    provider: str
    harness: str
    revision_note: str
    def __init__(self, model_id: _Optional[str] = ..., provider: _Optional[str] = ..., harness: _Optional[str] = ..., revision_note: _Optional[str] = ...) -> None: ...

class ListModelPricingBaselinesInput(_message.Message):
    __slots__ = ("include_history",)
    INCLUDE_HISTORY_FIELD_NUMBER: _ClassVar[int]
    include_history: bool
    def __init__(self, include_history: bool = ...) -> None: ...

class ModelPricingBaselinesResponse(_message.Message):
    __slots__ = ("baselines",)
    BASELINES_FIELD_NUMBER: _ClassVar[int]
    baselines: _containers.RepeatedCompositeFieldContainer[_model_pricing_baseline_pb2.ModelPricingBaseline]
    def __init__(self, baselines: _Optional[_Iterable[_Union[_model_pricing_baseline_pb2.ModelPricingBaseline, _Mapping]]] = ...) -> None: ...
