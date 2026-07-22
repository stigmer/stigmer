import datetime

from google.protobuf import timestamp_pb2 as _timestamp_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class UsageMeteringSource(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    USAGE_METERING_SOURCE_UNSPECIFIED: _ClassVar[UsageMeteringSource]
    USAGE_METERING_SOURCE_PROXY_PROVIDER_REPORTED: _ClassVar[UsageMeteringSource]
    USAGE_METERING_SOURCE_RUNNER_PROVIDER_REPORTED_OSS: _ClassVar[UsageMeteringSource]
    USAGE_METERING_SOURCE_ESTIMATED: _ClassVar[UsageMeteringSource]
    USAGE_METERING_SOURCE_PROVIDER_ADMIN_RECONCILED: _ClassVar[UsageMeteringSource]
    USAGE_METERING_SOURCE_MANUAL_ADJUSTMENT: _ClassVar[UsageMeteringSource]

class UsageTrustLevel(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    USAGE_TRUST_LEVEL_UNSPECIFIED: _ClassVar[UsageTrustLevel]
    USAGE_TRUST_LEVEL_BILLING_AUTHORITY: _ClassVar[UsageTrustLevel]
    USAGE_TRUST_LEVEL_SERVER_OBSERVED: _ClassVar[UsageTrustLevel]
    USAGE_TRUST_LEVEL_DISPLAY_ONLY: _ClassVar[UsageTrustLevel]

class UsageCompletionStatus(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    USAGE_COMPLETION_STATUS_UNSPECIFIED: _ClassVar[UsageCompletionStatus]
    USAGE_COMPLETION_STATUS_COMPLETE: _ClassVar[UsageCompletionStatus]
    USAGE_COMPLETION_STATUS_STREAM_INTERRUPTED: _ClassVar[UsageCompletionStatus]
    USAGE_COMPLETION_STATUS_PROVIDER_ERROR_WITH_USAGE: _ClassVar[UsageCompletionStatus]
    USAGE_COMPLETION_STATUS_PROVIDER_ERROR_NO_USAGE: _ClassVar[UsageCompletionStatus]
    USAGE_COMPLETION_STATUS_ESTIMATED_ONLY: _ClassVar[UsageCompletionStatus]
    USAGE_COMPLETION_STATUS_RECONCILED: _ClassVar[UsageCompletionStatus]
    USAGE_COMPLETION_STATUS_CONFLICT: _ClassVar[UsageCompletionStatus]

class BillingDebitStatus(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    BILLING_DEBIT_STATUS_UNSPECIFIED: _ClassVar[BillingDebitStatus]
    BILLING_DEBIT_STATUS_NOT_APPLICABLE: _ClassVar[BillingDebitStatus]
    BILLING_DEBIT_STATUS_PENDING: _ClassVar[BillingDebitStatus]
    BILLING_DEBIT_STATUS_DEBITED: _ClassVar[BillingDebitStatus]
    BILLING_DEBIT_STATUS_FAILED_RETRYABLE: _ClassVar[BillingDebitStatus]
    BILLING_DEBIT_STATUS_FAILED_TERMINAL: _ClassVar[BillingDebitStatus]
    BILLING_DEBIT_STATUS_CONFLICT: _ClassVar[BillingDebitStatus]

class CostCalculationStatus(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    COST_CALCULATION_STATUS_UNSPECIFIED: _ClassVar[CostCalculationStatus]
    COST_CALCULATION_STATUS_COMPUTED: _ClassVar[CostCalculationStatus]
    COST_CALCULATION_STATUS_ESTIMATED: _ClassVar[CostCalculationStatus]
    COST_CALCULATION_STATUS_PRICE_NOT_FOUND: _ClassVar[CostCalculationStatus]
    COST_CALCULATION_STATUS_RECONCILED: _ClassVar[CostCalculationStatus]
    COST_CALCULATION_STATUS_MANUAL_ADJUSTED: _ClassVar[CostCalculationStatus]
USAGE_METERING_SOURCE_UNSPECIFIED: UsageMeteringSource
USAGE_METERING_SOURCE_PROXY_PROVIDER_REPORTED: UsageMeteringSource
USAGE_METERING_SOURCE_RUNNER_PROVIDER_REPORTED_OSS: UsageMeteringSource
USAGE_METERING_SOURCE_ESTIMATED: UsageMeteringSource
USAGE_METERING_SOURCE_PROVIDER_ADMIN_RECONCILED: UsageMeteringSource
USAGE_METERING_SOURCE_MANUAL_ADJUSTMENT: UsageMeteringSource
USAGE_TRUST_LEVEL_UNSPECIFIED: UsageTrustLevel
USAGE_TRUST_LEVEL_BILLING_AUTHORITY: UsageTrustLevel
USAGE_TRUST_LEVEL_SERVER_OBSERVED: UsageTrustLevel
USAGE_TRUST_LEVEL_DISPLAY_ONLY: UsageTrustLevel
USAGE_COMPLETION_STATUS_UNSPECIFIED: UsageCompletionStatus
USAGE_COMPLETION_STATUS_COMPLETE: UsageCompletionStatus
USAGE_COMPLETION_STATUS_STREAM_INTERRUPTED: UsageCompletionStatus
USAGE_COMPLETION_STATUS_PROVIDER_ERROR_WITH_USAGE: UsageCompletionStatus
USAGE_COMPLETION_STATUS_PROVIDER_ERROR_NO_USAGE: UsageCompletionStatus
USAGE_COMPLETION_STATUS_ESTIMATED_ONLY: UsageCompletionStatus
USAGE_COMPLETION_STATUS_RECONCILED: UsageCompletionStatus
USAGE_COMPLETION_STATUS_CONFLICT: UsageCompletionStatus
BILLING_DEBIT_STATUS_UNSPECIFIED: BillingDebitStatus
BILLING_DEBIT_STATUS_NOT_APPLICABLE: BillingDebitStatus
BILLING_DEBIT_STATUS_PENDING: BillingDebitStatus
BILLING_DEBIT_STATUS_DEBITED: BillingDebitStatus
BILLING_DEBIT_STATUS_FAILED_RETRYABLE: BillingDebitStatus
BILLING_DEBIT_STATUS_FAILED_TERMINAL: BillingDebitStatus
BILLING_DEBIT_STATUS_CONFLICT: BillingDebitStatus
COST_CALCULATION_STATUS_UNSPECIFIED: CostCalculationStatus
COST_CALCULATION_STATUS_COMPUTED: CostCalculationStatus
COST_CALCULATION_STATUS_ESTIMATED: CostCalculationStatus
COST_CALCULATION_STATUS_PRICE_NOT_FOUND: CostCalculationStatus
COST_CALCULATION_STATUS_RECONCILED: CostCalculationStatus
COST_CALCULATION_STATUS_MANUAL_ADJUSTED: CostCalculationStatus

class TokenUsage(_message.Message):
    __slots__ = ("input_tokens", "output_tokens", "total_tokens", "cache_creation_input_tokens", "cache_read_input_tokens", "reasoning_tokens", "tool_use_prompt_tokens", "audio_input_tokens", "audio_output_tokens", "provider_token_details")
    class ProviderTokenDetailsEntry(_message.Message):
        __slots__ = ("key", "value")
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: int
        def __init__(self, key: _Optional[str] = ..., value: _Optional[int] = ...) -> None: ...
    INPUT_TOKENS_FIELD_NUMBER: _ClassVar[int]
    OUTPUT_TOKENS_FIELD_NUMBER: _ClassVar[int]
    TOTAL_TOKENS_FIELD_NUMBER: _ClassVar[int]
    CACHE_CREATION_INPUT_TOKENS_FIELD_NUMBER: _ClassVar[int]
    CACHE_READ_INPUT_TOKENS_FIELD_NUMBER: _ClassVar[int]
    REASONING_TOKENS_FIELD_NUMBER: _ClassVar[int]
    TOOL_USE_PROMPT_TOKENS_FIELD_NUMBER: _ClassVar[int]
    AUDIO_INPUT_TOKENS_FIELD_NUMBER: _ClassVar[int]
    AUDIO_OUTPUT_TOKENS_FIELD_NUMBER: _ClassVar[int]
    PROVIDER_TOKEN_DETAILS_FIELD_NUMBER: _ClassVar[int]
    input_tokens: int
    output_tokens: int
    total_tokens: int
    cache_creation_input_tokens: int
    cache_read_input_tokens: int
    reasoning_tokens: int
    tool_use_prompt_tokens: int
    audio_input_tokens: int
    audio_output_tokens: int
    provider_token_details: _containers.ScalarMap[str, int]
    def __init__(self, input_tokens: _Optional[int] = ..., output_tokens: _Optional[int] = ..., total_tokens: _Optional[int] = ..., cache_creation_input_tokens: _Optional[int] = ..., cache_read_input_tokens: _Optional[int] = ..., reasoning_tokens: _Optional[int] = ..., tool_use_prompt_tokens: _Optional[int] = ..., audio_input_tokens: _Optional[int] = ..., audio_output_tokens: _Optional[int] = ..., provider_token_details: _Optional[_Mapping[str, int]] = ...) -> None: ...

class PricingSnapshot(_message.Message):
    __slots__ = ("pricing_registry_version", "pricing_effective_at", "currency", "input_price_micros_per_million", "output_price_micros_per_million", "cache_creation_price_micros_per_million", "cache_read_price_micros_per_million", "reasoning_price_micros_per_million", "cursor_token_rate_micros_per_million", "markup_policy_version", "cost_tier")
    PRICING_REGISTRY_VERSION_FIELD_NUMBER: _ClassVar[int]
    PRICING_EFFECTIVE_AT_FIELD_NUMBER: _ClassVar[int]
    CURRENCY_FIELD_NUMBER: _ClassVar[int]
    INPUT_PRICE_MICROS_PER_MILLION_FIELD_NUMBER: _ClassVar[int]
    OUTPUT_PRICE_MICROS_PER_MILLION_FIELD_NUMBER: _ClassVar[int]
    CACHE_CREATION_PRICE_MICROS_PER_MILLION_FIELD_NUMBER: _ClassVar[int]
    CACHE_READ_PRICE_MICROS_PER_MILLION_FIELD_NUMBER: _ClassVar[int]
    REASONING_PRICE_MICROS_PER_MILLION_FIELD_NUMBER: _ClassVar[int]
    CURSOR_TOKEN_RATE_MICROS_PER_MILLION_FIELD_NUMBER: _ClassVar[int]
    MARKUP_POLICY_VERSION_FIELD_NUMBER: _ClassVar[int]
    COST_TIER_FIELD_NUMBER: _ClassVar[int]
    pricing_registry_version: str
    pricing_effective_at: _timestamp_pb2.Timestamp
    currency: str
    input_price_micros_per_million: int
    output_price_micros_per_million: int
    cache_creation_price_micros_per_million: int
    cache_read_price_micros_per_million: int
    reasoning_price_micros_per_million: int
    cursor_token_rate_micros_per_million: int
    markup_policy_version: str
    cost_tier: str
    def __init__(self, pricing_registry_version: _Optional[str] = ..., pricing_effective_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., currency: _Optional[str] = ..., input_price_micros_per_million: _Optional[int] = ..., output_price_micros_per_million: _Optional[int] = ..., cache_creation_price_micros_per_million: _Optional[int] = ..., cache_read_price_micros_per_million: _Optional[int] = ..., reasoning_price_micros_per_million: _Optional[int] = ..., cursor_token_rate_micros_per_million: _Optional[int] = ..., markup_policy_version: _Optional[str] = ..., cost_tier: _Optional[str] = ...) -> None: ...

class CostStamp(_message.Message):
    __slots__ = ("currency", "provider_cost_micros", "customer_billable_amount_micros", "calculation_status", "pricing", "cursor_platform_fee_micros")
    CURRENCY_FIELD_NUMBER: _ClassVar[int]
    PROVIDER_COST_MICROS_FIELD_NUMBER: _ClassVar[int]
    CUSTOMER_BILLABLE_AMOUNT_MICROS_FIELD_NUMBER: _ClassVar[int]
    CALCULATION_STATUS_FIELD_NUMBER: _ClassVar[int]
    PRICING_FIELD_NUMBER: _ClassVar[int]
    CURSOR_PLATFORM_FEE_MICROS_FIELD_NUMBER: _ClassVar[int]
    currency: str
    provider_cost_micros: int
    customer_billable_amount_micros: int
    calculation_status: CostCalculationStatus
    pricing: PricingSnapshot
    cursor_platform_fee_micros: int
    def __init__(self, currency: _Optional[str] = ..., provider_cost_micros: _Optional[int] = ..., customer_billable_amount_micros: _Optional[int] = ..., calculation_status: _Optional[_Union[CostCalculationStatus, str]] = ..., pricing: _Optional[_Union[PricingSnapshot, _Mapping]] = ..., cursor_platform_fee_micros: _Optional[int] = ...) -> None: ...

class ProxyTiming(_message.Message):
    __slots__ = ("proxy_received_at", "upstream_request_started_at", "first_response_byte_at", "last_response_byte_at", "proxy_completed_at", "upstream_ttfb_ms", "upstream_ttlb_ms", "stream_duration_ms", "proxy_total_duration_ms", "request_bytes", "response_bytes")
    PROXY_RECEIVED_AT_FIELD_NUMBER: _ClassVar[int]
    UPSTREAM_REQUEST_STARTED_AT_FIELD_NUMBER: _ClassVar[int]
    FIRST_RESPONSE_BYTE_AT_FIELD_NUMBER: _ClassVar[int]
    LAST_RESPONSE_BYTE_AT_FIELD_NUMBER: _ClassVar[int]
    PROXY_COMPLETED_AT_FIELD_NUMBER: _ClassVar[int]
    UPSTREAM_TTFB_MS_FIELD_NUMBER: _ClassVar[int]
    UPSTREAM_TTLB_MS_FIELD_NUMBER: _ClassVar[int]
    STREAM_DURATION_MS_FIELD_NUMBER: _ClassVar[int]
    PROXY_TOTAL_DURATION_MS_FIELD_NUMBER: _ClassVar[int]
    REQUEST_BYTES_FIELD_NUMBER: _ClassVar[int]
    RESPONSE_BYTES_FIELD_NUMBER: _ClassVar[int]
    proxy_received_at: _timestamp_pb2.Timestamp
    upstream_request_started_at: _timestamp_pb2.Timestamp
    first_response_byte_at: _timestamp_pb2.Timestamp
    last_response_byte_at: _timestamp_pb2.Timestamp
    proxy_completed_at: _timestamp_pb2.Timestamp
    upstream_ttfb_ms: int
    upstream_ttlb_ms: int
    stream_duration_ms: int
    proxy_total_duration_ms: int
    request_bytes: int
    response_bytes: int
    def __init__(self, proxy_received_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., upstream_request_started_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., first_response_byte_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., last_response_byte_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., proxy_completed_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., upstream_ttfb_ms: _Optional[int] = ..., upstream_ttlb_ms: _Optional[int] = ..., stream_duration_ms: _Optional[int] = ..., proxy_total_duration_ms: _Optional[int] = ..., request_bytes: _Optional[int] = ..., response_bytes: _Optional[int] = ...) -> None: ...

class BillingLink(_message.Message):
    __slots__ = ("debit_status", "reservation_id", "billing_debit_id", "debited_at", "billing_attempt_count", "last_billing_error")
    DEBIT_STATUS_FIELD_NUMBER: _ClassVar[int]
    RESERVATION_ID_FIELD_NUMBER: _ClassVar[int]
    BILLING_DEBIT_ID_FIELD_NUMBER: _ClassVar[int]
    DEBITED_AT_FIELD_NUMBER: _ClassVar[int]
    BILLING_ATTEMPT_COUNT_FIELD_NUMBER: _ClassVar[int]
    LAST_BILLING_ERROR_FIELD_NUMBER: _ClassVar[int]
    debit_status: BillingDebitStatus
    reservation_id: str
    billing_debit_id: str
    debited_at: _timestamp_pb2.Timestamp
    billing_attempt_count: int
    last_billing_error: str
    def __init__(self, debit_status: _Optional[_Union[BillingDebitStatus, str]] = ..., reservation_id: _Optional[str] = ..., billing_debit_id: _Optional[str] = ..., debited_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., billing_attempt_count: _Optional[int] = ..., last_billing_error: _Optional[str] = ...) -> None: ...

class LlmCallUsageRecord(_message.Message):
    __slots__ = ("usage_record_id", "execution_id", "root_execution_id", "sequence", "idempotency_key", "canonical_payload_hash", "observed_at", "created_at", "metering_source", "trust_level", "usage_status", "is_billable", "provider", "requested_model", "resolved_model", "endpoint", "streaming", "service_tier", "provider_request_id", "harness", "cursor_account_id", "cursor_key_id", "http_status_code", "finish_reason", "error_code", "tokens", "cost", "proxy_timing", "provider_usage_json", "billing", "org_id", "session_id", "labels")
    class LabelsEntry(_message.Message):
        __slots__ = ("key", "value")
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: str
        def __init__(self, key: _Optional[str] = ..., value: _Optional[str] = ...) -> None: ...
    USAGE_RECORD_ID_FIELD_NUMBER: _ClassVar[int]
    EXECUTION_ID_FIELD_NUMBER: _ClassVar[int]
    ROOT_EXECUTION_ID_FIELD_NUMBER: _ClassVar[int]
    SEQUENCE_FIELD_NUMBER: _ClassVar[int]
    IDEMPOTENCY_KEY_FIELD_NUMBER: _ClassVar[int]
    CANONICAL_PAYLOAD_HASH_FIELD_NUMBER: _ClassVar[int]
    OBSERVED_AT_FIELD_NUMBER: _ClassVar[int]
    CREATED_AT_FIELD_NUMBER: _ClassVar[int]
    METERING_SOURCE_FIELD_NUMBER: _ClassVar[int]
    TRUST_LEVEL_FIELD_NUMBER: _ClassVar[int]
    USAGE_STATUS_FIELD_NUMBER: _ClassVar[int]
    IS_BILLABLE_FIELD_NUMBER: _ClassVar[int]
    PROVIDER_FIELD_NUMBER: _ClassVar[int]
    REQUESTED_MODEL_FIELD_NUMBER: _ClassVar[int]
    RESOLVED_MODEL_FIELD_NUMBER: _ClassVar[int]
    ENDPOINT_FIELD_NUMBER: _ClassVar[int]
    STREAMING_FIELD_NUMBER: _ClassVar[int]
    SERVICE_TIER_FIELD_NUMBER: _ClassVar[int]
    PROVIDER_REQUEST_ID_FIELD_NUMBER: _ClassVar[int]
    HARNESS_FIELD_NUMBER: _ClassVar[int]
    CURSOR_ACCOUNT_ID_FIELD_NUMBER: _ClassVar[int]
    CURSOR_KEY_ID_FIELD_NUMBER: _ClassVar[int]
    HTTP_STATUS_CODE_FIELD_NUMBER: _ClassVar[int]
    FINISH_REASON_FIELD_NUMBER: _ClassVar[int]
    ERROR_CODE_FIELD_NUMBER: _ClassVar[int]
    TOKENS_FIELD_NUMBER: _ClassVar[int]
    COST_FIELD_NUMBER: _ClassVar[int]
    PROXY_TIMING_FIELD_NUMBER: _ClassVar[int]
    PROVIDER_USAGE_JSON_FIELD_NUMBER: _ClassVar[int]
    BILLING_FIELD_NUMBER: _ClassVar[int]
    ORG_ID_FIELD_NUMBER: _ClassVar[int]
    SESSION_ID_FIELD_NUMBER: _ClassVar[int]
    LABELS_FIELD_NUMBER: _ClassVar[int]
    usage_record_id: str
    execution_id: str
    root_execution_id: str
    sequence: int
    idempotency_key: str
    canonical_payload_hash: str
    observed_at: _timestamp_pb2.Timestamp
    created_at: _timestamp_pb2.Timestamp
    metering_source: UsageMeteringSource
    trust_level: UsageTrustLevel
    usage_status: UsageCompletionStatus
    is_billable: bool
    provider: str
    requested_model: str
    resolved_model: str
    endpoint: str
    streaming: bool
    service_tier: str
    provider_request_id: str
    harness: str
    cursor_account_id: str
    cursor_key_id: str
    http_status_code: int
    finish_reason: str
    error_code: str
    tokens: TokenUsage
    cost: CostStamp
    proxy_timing: ProxyTiming
    provider_usage_json: str
    billing: BillingLink
    org_id: str
    session_id: str
    labels: _containers.ScalarMap[str, str]
    def __init__(self, usage_record_id: _Optional[str] = ..., execution_id: _Optional[str] = ..., root_execution_id: _Optional[str] = ..., sequence: _Optional[int] = ..., idempotency_key: _Optional[str] = ..., canonical_payload_hash: _Optional[str] = ..., observed_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., created_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., metering_source: _Optional[_Union[UsageMeteringSource, str]] = ..., trust_level: _Optional[_Union[UsageTrustLevel, str]] = ..., usage_status: _Optional[_Union[UsageCompletionStatus, str]] = ..., is_billable: bool = ..., provider: _Optional[str] = ..., requested_model: _Optional[str] = ..., resolved_model: _Optional[str] = ..., endpoint: _Optional[str] = ..., streaming: bool = ..., service_tier: _Optional[str] = ..., provider_request_id: _Optional[str] = ..., harness: _Optional[str] = ..., cursor_account_id: _Optional[str] = ..., cursor_key_id: _Optional[str] = ..., http_status_code: _Optional[int] = ..., finish_reason: _Optional[str] = ..., error_code: _Optional[str] = ..., tokens: _Optional[_Union[TokenUsage, _Mapping]] = ..., cost: _Optional[_Union[CostStamp, _Mapping]] = ..., proxy_timing: _Optional[_Union[ProxyTiming, _Mapping]] = ..., provider_usage_json: _Optional[str] = ..., billing: _Optional[_Union[BillingLink, _Mapping]] = ..., org_id: _Optional[str] = ..., session_id: _Optional[str] = ..., labels: _Optional[_Mapping[str, str]] = ...) -> None: ...

class UsageReportAggregate(_message.Message):
    __slots__ = ("input_tokens", "output_tokens", "total_tokens", "cache_creation_input_tokens", "cache_read_input_tokens", "reasoning_tokens", "llm_call_count", "billable_cost_micros", "provider_cost_micros", "primary_model", "primary_provider")
    INPUT_TOKENS_FIELD_NUMBER: _ClassVar[int]
    OUTPUT_TOKENS_FIELD_NUMBER: _ClassVar[int]
    TOTAL_TOKENS_FIELD_NUMBER: _ClassVar[int]
    CACHE_CREATION_INPUT_TOKENS_FIELD_NUMBER: _ClassVar[int]
    CACHE_READ_INPUT_TOKENS_FIELD_NUMBER: _ClassVar[int]
    REASONING_TOKENS_FIELD_NUMBER: _ClassVar[int]
    LLM_CALL_COUNT_FIELD_NUMBER: _ClassVar[int]
    BILLABLE_COST_MICROS_FIELD_NUMBER: _ClassVar[int]
    PROVIDER_COST_MICROS_FIELD_NUMBER: _ClassVar[int]
    PRIMARY_MODEL_FIELD_NUMBER: _ClassVar[int]
    PRIMARY_PROVIDER_FIELD_NUMBER: _ClassVar[int]
    input_tokens: int
    output_tokens: int
    total_tokens: int
    cache_creation_input_tokens: int
    cache_read_input_tokens: int
    reasoning_tokens: int
    llm_call_count: int
    billable_cost_micros: int
    provider_cost_micros: int
    primary_model: str
    primary_provider: str
    def __init__(self, input_tokens: _Optional[int] = ..., output_tokens: _Optional[int] = ..., total_tokens: _Optional[int] = ..., cache_creation_input_tokens: _Optional[int] = ..., cache_read_input_tokens: _Optional[int] = ..., reasoning_tokens: _Optional[int] = ..., llm_call_count: _Optional[int] = ..., billable_cost_micros: _Optional[int] = ..., provider_cost_micros: _Optional[int] = ..., primary_model: _Optional[str] = ..., primary_provider: _Optional[str] = ...) -> None: ...

class ModelUsage(_message.Message):
    __slots__ = ("model", "provider", "input_tokens", "output_tokens", "cache_creation_input_tokens", "cache_read_input_tokens", "call_count", "billable_cost_micros", "provider_cost_micros")
    MODEL_FIELD_NUMBER: _ClassVar[int]
    PROVIDER_FIELD_NUMBER: _ClassVar[int]
    INPUT_TOKENS_FIELD_NUMBER: _ClassVar[int]
    OUTPUT_TOKENS_FIELD_NUMBER: _ClassVar[int]
    CACHE_CREATION_INPUT_TOKENS_FIELD_NUMBER: _ClassVar[int]
    CACHE_READ_INPUT_TOKENS_FIELD_NUMBER: _ClassVar[int]
    CALL_COUNT_FIELD_NUMBER: _ClassVar[int]
    BILLABLE_COST_MICROS_FIELD_NUMBER: _ClassVar[int]
    PROVIDER_COST_MICROS_FIELD_NUMBER: _ClassVar[int]
    model: str
    provider: str
    input_tokens: int
    output_tokens: int
    cache_creation_input_tokens: int
    cache_read_input_tokens: int
    call_count: int
    billable_cost_micros: int
    provider_cost_micros: int
    def __init__(self, model: _Optional[str] = ..., provider: _Optional[str] = ..., input_tokens: _Optional[int] = ..., output_tokens: _Optional[int] = ..., cache_creation_input_tokens: _Optional[int] = ..., cache_read_input_tokens: _Optional[int] = ..., call_count: _Optional[int] = ..., billable_cost_micros: _Optional[int] = ..., provider_cost_micros: _Optional[int] = ...) -> None: ...

class StreamingUsageSummary(_message.Message):
    __slots__ = ("input_tokens", "output_tokens", "cache_read_tokens", "cache_write_tokens", "total_tokens", "turn_count", "estimated_cost_usd", "model", "observed_at")
    INPUT_TOKENS_FIELD_NUMBER: _ClassVar[int]
    OUTPUT_TOKENS_FIELD_NUMBER: _ClassVar[int]
    CACHE_READ_TOKENS_FIELD_NUMBER: _ClassVar[int]
    CACHE_WRITE_TOKENS_FIELD_NUMBER: _ClassVar[int]
    TOTAL_TOKENS_FIELD_NUMBER: _ClassVar[int]
    TURN_COUNT_FIELD_NUMBER: _ClassVar[int]
    ESTIMATED_COST_USD_FIELD_NUMBER: _ClassVar[int]
    MODEL_FIELD_NUMBER: _ClassVar[int]
    OBSERVED_AT_FIELD_NUMBER: _ClassVar[int]
    input_tokens: int
    output_tokens: int
    cache_read_tokens: int
    cache_write_tokens: int
    total_tokens: int
    turn_count: int
    estimated_cost_usd: float
    model: str
    observed_at: str
    def __init__(self, input_tokens: _Optional[int] = ..., output_tokens: _Optional[int] = ..., cache_read_tokens: _Optional[int] = ..., cache_write_tokens: _Optional[int] = ..., total_tokens: _Optional[int] = ..., turn_count: _Optional[int] = ..., estimated_cost_usd: _Optional[float] = ..., model: _Optional[str] = ..., observed_at: _Optional[str] = ...) -> None: ...
