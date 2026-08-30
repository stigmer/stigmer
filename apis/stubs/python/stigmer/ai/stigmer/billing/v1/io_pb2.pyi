import datetime

from ai.stigmer.agentic.agentexecution.v1 import usage_pb2 as _usage_pb2
from ai.stigmer.billing.v1 import credit_pb2 as _credit_pb2
from ai.stigmer.billing.v1 import enum_pb2 as _enum_pb2
from ai.stigmer.billing.v1 import model_pricing_baseline_pb2 as _model_pricing_baseline_pb2
from ai.stigmer.billing.v1 import pricing_override_pb2 as _pricing_override_pb2
from ai.stigmer.commons.rpc import pagination_pb2 as _pagination_pb2
from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf import timestamp_pb2 as _timestamp_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class GetOrCreateBillingAccountInput(_message.Message):
    __slots__ = ("org_id",)
    ORG_ID_FIELD_NUMBER: _ClassVar[int]
    org_id: str
    def __init__(self, org_id: _Optional[str] = ...) -> None: ...

class AdjustCreditsInput(_message.Message):
    __slots__ = ("org_id", "amount_micros", "reason", "idempotency_key")
    ORG_ID_FIELD_NUMBER: _ClassVar[int]
    AMOUNT_MICROS_FIELD_NUMBER: _ClassVar[int]
    REASON_FIELD_NUMBER: _ClassVar[int]
    IDEMPOTENCY_KEY_FIELD_NUMBER: _ClassVar[int]
    org_id: str
    amount_micros: int
    reason: str
    idempotency_key: str
    def __init__(self, org_id: _Optional[str] = ..., amount_micros: _Optional[int] = ..., reason: _Optional[str] = ..., idempotency_key: _Optional[str] = ...) -> None: ...

class GrantCreditsInput(_message.Message):
    __slots__ = ("org_id", "amount_micros", "expires_at", "reason", "idempotency_key")
    ORG_ID_FIELD_NUMBER: _ClassVar[int]
    AMOUNT_MICROS_FIELD_NUMBER: _ClassVar[int]
    EXPIRES_AT_FIELD_NUMBER: _ClassVar[int]
    REASON_FIELD_NUMBER: _ClassVar[int]
    IDEMPOTENCY_KEY_FIELD_NUMBER: _ClassVar[int]
    org_id: str
    amount_micros: int
    expires_at: _timestamp_pb2.Timestamp
    reason: str
    idempotency_key: str
    def __init__(self, org_id: _Optional[str] = ..., amount_micros: _Optional[int] = ..., expires_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., reason: _Optional[str] = ..., idempotency_key: _Optional[str] = ...) -> None: ...

class AuthorizeExecutionInput(_message.Message):
    __slots__ = ("org_id", "execution_id", "harness", "expected_cost_cap_micros")
    ORG_ID_FIELD_NUMBER: _ClassVar[int]
    EXECUTION_ID_FIELD_NUMBER: _ClassVar[int]
    HARNESS_FIELD_NUMBER: _ClassVar[int]
    EXPECTED_COST_CAP_MICROS_FIELD_NUMBER: _ClassVar[int]
    org_id: str
    execution_id: str
    harness: str
    expected_cost_cap_micros: int
    def __init__(self, org_id: _Optional[str] = ..., execution_id: _Optional[str] = ..., harness: _Optional[str] = ..., expected_cost_cap_micros: _Optional[int] = ...) -> None: ...

class AuthorizeExecutionResponse(_message.Message):
    __slots__ = ("authorized", "reservation_id", "reserved_micros", "available_balance_micros", "denial_reason")
    AUTHORIZED_FIELD_NUMBER: _ClassVar[int]
    RESERVATION_ID_FIELD_NUMBER: _ClassVar[int]
    RESERVED_MICROS_FIELD_NUMBER: _ClassVar[int]
    AVAILABLE_BALANCE_MICROS_FIELD_NUMBER: _ClassVar[int]
    DENIAL_REASON_FIELD_NUMBER: _ClassVar[int]
    authorized: bool
    reservation_id: str
    reserved_micros: int
    available_balance_micros: int
    denial_reason: str
    def __init__(self, authorized: bool = ..., reservation_id: _Optional[str] = ..., reserved_micros: _Optional[int] = ..., available_balance_micros: _Optional[int] = ..., denial_reason: _Optional[str] = ...) -> None: ...

class RecordLlmCallUsageInput(_message.Message):
    __slots__ = ("execution_id", "sequence", "provider", "resolved_model", "requested_model", "tokens", "usage_status", "provider_request_id", "http_status_code", "streaming", "finish_reason", "proxy_timing", "provider_usage_json", "harness", "cursor_account_id", "cursor_key_id", "cursor_key_source", "served_service_tier")
    EXECUTION_ID_FIELD_NUMBER: _ClassVar[int]
    SEQUENCE_FIELD_NUMBER: _ClassVar[int]
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
    CURSOR_ACCOUNT_ID_FIELD_NUMBER: _ClassVar[int]
    CURSOR_KEY_ID_FIELD_NUMBER: _ClassVar[int]
    CURSOR_KEY_SOURCE_FIELD_NUMBER: _ClassVar[int]
    SERVED_SERVICE_TIER_FIELD_NUMBER: _ClassVar[int]
    execution_id: str
    sequence: int
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
    cursor_account_id: str
    cursor_key_id: str
    cursor_key_source: _usage_pb2.CursorKeySource
    served_service_tier: str
    def __init__(self, execution_id: _Optional[str] = ..., sequence: _Optional[int] = ..., provider: _Optional[str] = ..., resolved_model: _Optional[str] = ..., requested_model: _Optional[str] = ..., tokens: _Optional[_Union[_usage_pb2.TokenUsage, _Mapping]] = ..., usage_status: _Optional[_Union[_usage_pb2.UsageCompletionStatus, str]] = ..., provider_request_id: _Optional[str] = ..., http_status_code: _Optional[int] = ..., streaming: bool = ..., finish_reason: _Optional[str] = ..., proxy_timing: _Optional[_Union[_usage_pb2.ProxyTiming, _Mapping]] = ..., provider_usage_json: _Optional[str] = ..., harness: _Optional[str] = ..., cursor_account_id: _Optional[str] = ..., cursor_key_id: _Optional[str] = ..., cursor_key_source: _Optional[_Union[_usage_pb2.CursorKeySource, str]] = ..., served_service_tier: _Optional[str] = ...) -> None: ...

class RecordLlmCallUsageResponse(_message.Message):
    __slots__ = ("usage_record_id", "provider_cost_micros", "customer_billable_amount_micros", "is_billable", "is_duplicate")
    USAGE_RECORD_ID_FIELD_NUMBER: _ClassVar[int]
    PROVIDER_COST_MICROS_FIELD_NUMBER: _ClassVar[int]
    CUSTOMER_BILLABLE_AMOUNT_MICROS_FIELD_NUMBER: _ClassVar[int]
    IS_BILLABLE_FIELD_NUMBER: _ClassVar[int]
    IS_DUPLICATE_FIELD_NUMBER: _ClassVar[int]
    usage_record_id: str
    provider_cost_micros: int
    customer_billable_amount_micros: int
    is_billable: bool
    is_duplicate: bool
    def __init__(self, usage_record_id: _Optional[str] = ..., provider_cost_micros: _Optional[int] = ..., customer_billable_amount_micros: _Optional[int] = ..., is_billable: bool = ..., is_duplicate: bool = ...) -> None: ...

class FinalizeExecutionInput(_message.Message):
    __slots__ = ("execution_id",)
    EXECUTION_ID_FIELD_NUMBER: _ClassVar[int]
    execution_id: str
    def __init__(self, execution_id: _Optional[str] = ...) -> None: ...

class FinalizeExecutionResponse(_message.Message):
    __slots__ = ("total_provider_cost_micros", "total_billable_amount_micros", "released_reservation_micros", "billed_call_count")
    TOTAL_PROVIDER_COST_MICROS_FIELD_NUMBER: _ClassVar[int]
    TOTAL_BILLABLE_AMOUNT_MICROS_FIELD_NUMBER: _ClassVar[int]
    RELEASED_RESERVATION_MICROS_FIELD_NUMBER: _ClassVar[int]
    BILLED_CALL_COUNT_FIELD_NUMBER: _ClassVar[int]
    total_provider_cost_micros: int
    total_billable_amount_micros: int
    released_reservation_micros: int
    billed_call_count: int
    def __init__(self, total_provider_cost_micros: _Optional[int] = ..., total_billable_amount_micros: _Optional[int] = ..., released_reservation_micros: _Optional[int] = ..., billed_call_count: _Optional[int] = ...) -> None: ...

class RearmForRecoveryInput(_message.Message):
    __slots__ = ("execution_id",)
    EXECUTION_ID_FIELD_NUMBER: _ClassVar[int]
    execution_id: str
    def __init__(self, execution_id: _Optional[str] = ...) -> None: ...

class CreateCreditCheckoutSessionInput(_message.Message):
    __slots__ = ("org_id", "pack_id", "success_url", "cancel_url")
    ORG_ID_FIELD_NUMBER: _ClassVar[int]
    PACK_ID_FIELD_NUMBER: _ClassVar[int]
    SUCCESS_URL_FIELD_NUMBER: _ClassVar[int]
    CANCEL_URL_FIELD_NUMBER: _ClassVar[int]
    org_id: str
    pack_id: str
    success_url: str
    cancel_url: str
    def __init__(self, org_id: _Optional[str] = ..., pack_id: _Optional[str] = ..., success_url: _Optional[str] = ..., cancel_url: _Optional[str] = ...) -> None: ...

class CreateCreditCheckoutSessionResponse(_message.Message):
    __slots__ = ("checkout_url", "purchase_id", "checkout_session_id")
    CHECKOUT_URL_FIELD_NUMBER: _ClassVar[int]
    PURCHASE_ID_FIELD_NUMBER: _ClassVar[int]
    CHECKOUT_SESSION_ID_FIELD_NUMBER: _ClassVar[int]
    checkout_url: str
    purchase_id: str
    checkout_session_id: str
    def __init__(self, checkout_url: _Optional[str] = ..., purchase_id: _Optional[str] = ..., checkout_session_id: _Optional[str] = ...) -> None: ...

class CreateBillingPortalSessionInput(_message.Message):
    __slots__ = ("org_id", "return_url")
    ORG_ID_FIELD_NUMBER: _ClassVar[int]
    RETURN_URL_FIELD_NUMBER: _ClassVar[int]
    org_id: str
    return_url: str
    def __init__(self, org_id: _Optional[str] = ..., return_url: _Optional[str] = ...) -> None: ...

class CreateBillingPortalSessionResponse(_message.Message):
    __slots__ = ("portal_url",)
    PORTAL_URL_FIELD_NUMBER: _ClassVar[int]
    portal_url: str
    def __init__(self, portal_url: _Optional[str] = ...) -> None: ...

class SetAutoRechargeConfigInput(_message.Message):
    __slots__ = ("org_id", "enabled", "threshold_micros", "recharge_amount_micros", "monthly_cap_micros")
    ORG_ID_FIELD_NUMBER: _ClassVar[int]
    ENABLED_FIELD_NUMBER: _ClassVar[int]
    THRESHOLD_MICROS_FIELD_NUMBER: _ClassVar[int]
    RECHARGE_AMOUNT_MICROS_FIELD_NUMBER: _ClassVar[int]
    MONTHLY_CAP_MICROS_FIELD_NUMBER: _ClassVar[int]
    org_id: str
    enabled: bool
    threshold_micros: int
    recharge_amount_micros: int
    monthly_cap_micros: int
    def __init__(self, org_id: _Optional[str] = ..., enabled: bool = ..., threshold_micros: _Optional[int] = ..., recharge_amount_micros: _Optional[int] = ..., monthly_cap_micros: _Optional[int] = ...) -> None: ...

class GetBillingAccountInput(_message.Message):
    __slots__ = ("org_id",)
    ORG_ID_FIELD_NUMBER: _ClassVar[int]
    org_id: str
    def __init__(self, org_id: _Optional[str] = ...) -> None: ...

class GetCreditBalanceInput(_message.Message):
    __slots__ = ("org_id",)
    ORG_ID_FIELD_NUMBER: _ClassVar[int]
    org_id: str
    def __init__(self, org_id: _Optional[str] = ...) -> None: ...

class GetCreditLedgerInput(_message.Message):
    __slots__ = ("org_id", "page", "type_filter", "start_time", "end_time", "view")
    ORG_ID_FIELD_NUMBER: _ClassVar[int]
    PAGE_FIELD_NUMBER: _ClassVar[int]
    TYPE_FILTER_FIELD_NUMBER: _ClassVar[int]
    START_TIME_FIELD_NUMBER: _ClassVar[int]
    END_TIME_FIELD_NUMBER: _ClassVar[int]
    VIEW_FIELD_NUMBER: _ClassVar[int]
    org_id: str
    page: _pagination_pb2.PageInfo
    type_filter: _containers.RepeatedScalarFieldContainer[_enum_pb2.LedgerEntryType]
    start_time: _timestamp_pb2.Timestamp
    end_time: _timestamp_pb2.Timestamp
    view: _enum_pb2.LedgerView
    def __init__(self, org_id: _Optional[str] = ..., page: _Optional[_Union[_pagination_pb2.PageInfo, _Mapping]] = ..., type_filter: _Optional[_Iterable[_Union[_enum_pb2.LedgerEntryType, str]]] = ..., start_time: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., end_time: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., view: _Optional[_Union[_enum_pb2.LedgerView, str]] = ...) -> None: ...

class CreditLedgerResponse(_message.Message):
    __slots__ = ("entries", "total_pages")
    ENTRIES_FIELD_NUMBER: _ClassVar[int]
    TOTAL_PAGES_FIELD_NUMBER: _ClassVar[int]
    entries: _containers.RepeatedCompositeFieldContainer[_credit_pb2.CreditLedgerEntry]
    total_pages: int
    def __init__(self, entries: _Optional[_Iterable[_Union[_credit_pb2.CreditLedgerEntry, _Mapping]]] = ..., total_pages: _Optional[int] = ...) -> None: ...

class GetBillingUsageReportInput(_message.Message):
    __slots__ = ("org_id", "start_time", "end_time")
    ORG_ID_FIELD_NUMBER: _ClassVar[int]
    START_TIME_FIELD_NUMBER: _ClassVar[int]
    END_TIME_FIELD_NUMBER: _ClassVar[int]
    org_id: str
    start_time: _timestamp_pb2.Timestamp
    end_time: _timestamp_pb2.Timestamp
    def __init__(self, org_id: _Optional[str] = ..., start_time: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., end_time: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...

class BillingUsageReportResponse(_message.Message):
    __slots__ = ("total_provider_cost_micros", "total_billable_amount_micros", "execution_count", "llm_call_count", "model_breakdown")
    TOTAL_PROVIDER_COST_MICROS_FIELD_NUMBER: _ClassVar[int]
    TOTAL_BILLABLE_AMOUNT_MICROS_FIELD_NUMBER: _ClassVar[int]
    EXECUTION_COUNT_FIELD_NUMBER: _ClassVar[int]
    LLM_CALL_COUNT_FIELD_NUMBER: _ClassVar[int]
    MODEL_BREAKDOWN_FIELD_NUMBER: _ClassVar[int]
    total_provider_cost_micros: int
    total_billable_amount_micros: int
    execution_count: int
    llm_call_count: int
    model_breakdown: _containers.RepeatedCompositeFieldContainer[ModelBillingBreakdown]
    def __init__(self, total_provider_cost_micros: _Optional[int] = ..., total_billable_amount_micros: _Optional[int] = ..., execution_count: _Optional[int] = ..., llm_call_count: _Optional[int] = ..., model_breakdown: _Optional[_Iterable[_Union[ModelBillingBreakdown, _Mapping]]] = ...) -> None: ...

class ModelBillingBreakdown(_message.Message):
    __slots__ = ("model", "harness", "cost_tier", "provider_cost_micros", "billable_amount_micros", "call_count")
    MODEL_FIELD_NUMBER: _ClassVar[int]
    HARNESS_FIELD_NUMBER: _ClassVar[int]
    COST_TIER_FIELD_NUMBER: _ClassVar[int]
    PROVIDER_COST_MICROS_FIELD_NUMBER: _ClassVar[int]
    BILLABLE_AMOUNT_MICROS_FIELD_NUMBER: _ClassVar[int]
    CALL_COUNT_FIELD_NUMBER: _ClassVar[int]
    model: str
    harness: str
    cost_tier: str
    provider_cost_micros: int
    billable_amount_micros: int
    call_count: int
    def __init__(self, model: _Optional[str] = ..., harness: _Optional[str] = ..., cost_tier: _Optional[str] = ..., provider_cost_micros: _Optional[int] = ..., billable_amount_micros: _Optional[int] = ..., call_count: _Optional[int] = ...) -> None: ...

class GetCustomerModelPricingInput(_message.Message):
    __slots__ = ("org_id",)
    ORG_ID_FIELD_NUMBER: _ClassVar[int]
    org_id: str
    def __init__(self, org_id: _Optional[str] = ...) -> None: ...

class CustomerModelPricingResponse(_message.Message):
    __slots__ = ("entries",)
    ENTRIES_FIELD_NUMBER: _ClassVar[int]
    entries: _containers.RepeatedCompositeFieldContainer[CustomerModelPricingEntry]
    def __init__(self, entries: _Optional[_Iterable[_Union[CustomerModelPricingEntry, _Mapping]]] = ...) -> None: ...

class GetModelPricingGovernanceInput(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class ModelPricingGovernanceResponse(_message.Message):
    __slots__ = ("entries", "pending_overrides")
    ENTRIES_FIELD_NUMBER: _ClassVar[int]
    PENDING_OVERRIDES_FIELD_NUMBER: _ClassVar[int]
    entries: _containers.RepeatedCompositeFieldContainer[ModelPricingGovernanceEntry]
    pending_overrides: _containers.RepeatedCompositeFieldContainer[_pricing_override_pb2.ModelPricingOverride]
    def __init__(self, entries: _Optional[_Iterable[_Union[ModelPricingGovernanceEntry, _Mapping]]] = ..., pending_overrides: _Optional[_Iterable[_Union[_pricing_override_pb2.ModelPricingOverride, _Mapping]]] = ...) -> None: ...

class ModelPricingGovernanceEntry(_message.Message):
    __slots__ = ("model_id", "display_name", "provider", "harness", "cost_tier", "variant", "baseline_input_micros_per_million", "baseline_output_micros_per_million", "baseline_cache_write_micros_per_million", "baseline_cache_read_micros_per_million", "baseline_cursor_token_rate_micros_per_million", "effective_input_micros_per_million", "effective_output_micros_per_million", "effective_cache_write_micros_per_million", "effective_cache_read_micros_per_million", "effective_cursor_token_rate_micros_per_million", "active_overrides", "ledger_reconcilable")
    MODEL_ID_FIELD_NUMBER: _ClassVar[int]
    DISPLAY_NAME_FIELD_NUMBER: _ClassVar[int]
    PROVIDER_FIELD_NUMBER: _ClassVar[int]
    HARNESS_FIELD_NUMBER: _ClassVar[int]
    COST_TIER_FIELD_NUMBER: _ClassVar[int]
    VARIANT_FIELD_NUMBER: _ClassVar[int]
    BASELINE_INPUT_MICROS_PER_MILLION_FIELD_NUMBER: _ClassVar[int]
    BASELINE_OUTPUT_MICROS_PER_MILLION_FIELD_NUMBER: _ClassVar[int]
    BASELINE_CACHE_WRITE_MICROS_PER_MILLION_FIELD_NUMBER: _ClassVar[int]
    BASELINE_CACHE_READ_MICROS_PER_MILLION_FIELD_NUMBER: _ClassVar[int]
    BASELINE_CURSOR_TOKEN_RATE_MICROS_PER_MILLION_FIELD_NUMBER: _ClassVar[int]
    EFFECTIVE_INPUT_MICROS_PER_MILLION_FIELD_NUMBER: _ClassVar[int]
    EFFECTIVE_OUTPUT_MICROS_PER_MILLION_FIELD_NUMBER: _ClassVar[int]
    EFFECTIVE_CACHE_WRITE_MICROS_PER_MILLION_FIELD_NUMBER: _ClassVar[int]
    EFFECTIVE_CACHE_READ_MICROS_PER_MILLION_FIELD_NUMBER: _ClassVar[int]
    EFFECTIVE_CURSOR_TOKEN_RATE_MICROS_PER_MILLION_FIELD_NUMBER: _ClassVar[int]
    ACTIVE_OVERRIDES_FIELD_NUMBER: _ClassVar[int]
    LEDGER_RECONCILABLE_FIELD_NUMBER: _ClassVar[int]
    model_id: str
    display_name: str
    provider: str
    harness: str
    cost_tier: str
    variant: str
    baseline_input_micros_per_million: int
    baseline_output_micros_per_million: int
    baseline_cache_write_micros_per_million: int
    baseline_cache_read_micros_per_million: int
    baseline_cursor_token_rate_micros_per_million: int
    effective_input_micros_per_million: int
    effective_output_micros_per_million: int
    effective_cache_write_micros_per_million: int
    effective_cache_read_micros_per_million: int
    effective_cursor_token_rate_micros_per_million: int
    active_overrides: _containers.RepeatedCompositeFieldContainer[_pricing_override_pb2.ModelPricingOverride]
    ledger_reconcilable: bool
    def __init__(self, model_id: _Optional[str] = ..., display_name: _Optional[str] = ..., provider: _Optional[str] = ..., harness: _Optional[str] = ..., cost_tier: _Optional[str] = ..., variant: _Optional[str] = ..., baseline_input_micros_per_million: _Optional[int] = ..., baseline_output_micros_per_million: _Optional[int] = ..., baseline_cache_write_micros_per_million: _Optional[int] = ..., baseline_cache_read_micros_per_million: _Optional[int] = ..., baseline_cursor_token_rate_micros_per_million: _Optional[int] = ..., effective_input_micros_per_million: _Optional[int] = ..., effective_output_micros_per_million: _Optional[int] = ..., effective_cache_write_micros_per_million: _Optional[int] = ..., effective_cache_read_micros_per_million: _Optional[int] = ..., effective_cursor_token_rate_micros_per_million: _Optional[int] = ..., active_overrides: _Optional[_Iterable[_Union[_pricing_override_pb2.ModelPricingOverride, _Mapping]]] = ..., ledger_reconcilable: bool = ...) -> None: ...

class DecideModelPricingOverrideInput(_message.Message):
    __slots__ = ("override_id", "approve", "decision_note")
    OVERRIDE_ID_FIELD_NUMBER: _ClassVar[int]
    APPROVE_FIELD_NUMBER: _ClassVar[int]
    DECISION_NOTE_FIELD_NUMBER: _ClassVar[int]
    override_id: str
    approve: bool
    decision_note: str
    def __init__(self, override_id: _Optional[str] = ..., approve: bool = ..., decision_note: _Optional[str] = ...) -> None: ...

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

class CustomerModelPricingEntry(_message.Message):
    __slots__ = ("model_id", "display_name", "provider", "harness", "cost_tier", "input_price_micros_per_million", "output_price_micros_per_million", "cache_creation_price_micros_per_million", "cache_read_price_micros_per_million", "pricing_policy_id", "markup_basis_points")
    MODEL_ID_FIELD_NUMBER: _ClassVar[int]
    DISPLAY_NAME_FIELD_NUMBER: _ClassVar[int]
    PROVIDER_FIELD_NUMBER: _ClassVar[int]
    HARNESS_FIELD_NUMBER: _ClassVar[int]
    COST_TIER_FIELD_NUMBER: _ClassVar[int]
    INPUT_PRICE_MICROS_PER_MILLION_FIELD_NUMBER: _ClassVar[int]
    OUTPUT_PRICE_MICROS_PER_MILLION_FIELD_NUMBER: _ClassVar[int]
    CACHE_CREATION_PRICE_MICROS_PER_MILLION_FIELD_NUMBER: _ClassVar[int]
    CACHE_READ_PRICE_MICROS_PER_MILLION_FIELD_NUMBER: _ClassVar[int]
    PRICING_POLICY_ID_FIELD_NUMBER: _ClassVar[int]
    MARKUP_BASIS_POINTS_FIELD_NUMBER: _ClassVar[int]
    model_id: str
    display_name: str
    provider: str
    harness: str
    cost_tier: str
    input_price_micros_per_million: int
    output_price_micros_per_million: int
    cache_creation_price_micros_per_million: int
    cache_read_price_micros_per_million: int
    pricing_policy_id: str
    markup_basis_points: int
    def __init__(self, model_id: _Optional[str] = ..., display_name: _Optional[str] = ..., provider: _Optional[str] = ..., harness: _Optional[str] = ..., cost_tier: _Optional[str] = ..., input_price_micros_per_million: _Optional[int] = ..., output_price_micros_per_million: _Optional[int] = ..., cache_creation_price_micros_per_million: _Optional[int] = ..., cache_read_price_micros_per_million: _Optional[int] = ..., pricing_policy_id: _Optional[str] = ..., markup_basis_points: _Optional[int] = ...) -> None: ...

class PreviewAuthorizationInput(_message.Message):
    __slots__ = ("org_id", "expected_cost_cap_micros")
    ORG_ID_FIELD_NUMBER: _ClassVar[int]
    EXPECTED_COST_CAP_MICROS_FIELD_NUMBER: _ClassVar[int]
    org_id: str
    expected_cost_cap_micros: int
    def __init__(self, org_id: _Optional[str] = ..., expected_cost_cap_micros: _Optional[int] = ...) -> None: ...

class PreviewAuthorizationResponse(_message.Message):
    __slots__ = ("authorized", "denial_reason", "reserve_amount_micros")
    AUTHORIZED_FIELD_NUMBER: _ClassVar[int]
    DENIAL_REASON_FIELD_NUMBER: _ClassVar[int]
    RESERVE_AMOUNT_MICROS_FIELD_NUMBER: _ClassVar[int]
    authorized: bool
    denial_reason: str
    reserve_amount_micros: int
    def __init__(self, authorized: bool = ..., denial_reason: _Optional[str] = ..., reserve_amount_micros: _Optional[int] = ...) -> None: ...

class GetExecutionBillingSignalInput(_message.Message):
    __slots__ = ("execution_id",)
    EXECUTION_ID_FIELD_NUMBER: _ClassVar[int]
    execution_id: str
    def __init__(self, execution_id: _Optional[str] = ...) -> None: ...

class GetExecutionBillingSignalResponse(_message.Message):
    __slots__ = ("signal", "reason")
    SIGNAL_FIELD_NUMBER: _ClassVar[int]
    REASON_FIELD_NUMBER: _ClassVar[int]
    signal: _enum_pb2.ExecutionBillingSignal
    reason: str
    def __init__(self, signal: _Optional[_Union[_enum_pb2.ExecutionBillingSignal, str]] = ..., reason: _Optional[str] = ...) -> None: ...
