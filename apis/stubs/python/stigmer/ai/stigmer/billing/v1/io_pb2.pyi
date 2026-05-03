import datetime

from ai.stigmer.billing.v1 import credit_pb2 as _credit_pb2
from ai.stigmer.billing.v1 import enum_pb2 as _enum_pb2
from ai.stigmer.billing.v1 import policy_pb2 as _policy_pb2
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

class ReportLlmCallUsageInput(_message.Message):
    __slots__ = ("execution_id", "sequence", "model", "harness", "cost_tier", "provider_cost_micros", "input_tokens", "output_tokens", "cache_creation_tokens", "cache_read_tokens")
    EXECUTION_ID_FIELD_NUMBER: _ClassVar[int]
    SEQUENCE_FIELD_NUMBER: _ClassVar[int]
    MODEL_FIELD_NUMBER: _ClassVar[int]
    HARNESS_FIELD_NUMBER: _ClassVar[int]
    COST_TIER_FIELD_NUMBER: _ClassVar[int]
    PROVIDER_COST_MICROS_FIELD_NUMBER: _ClassVar[int]
    INPUT_TOKENS_FIELD_NUMBER: _ClassVar[int]
    OUTPUT_TOKENS_FIELD_NUMBER: _ClassVar[int]
    CACHE_CREATION_TOKENS_FIELD_NUMBER: _ClassVar[int]
    CACHE_READ_TOKENS_FIELD_NUMBER: _ClassVar[int]
    execution_id: str
    sequence: int
    model: str
    harness: str
    cost_tier: str
    provider_cost_micros: int
    input_tokens: int
    output_tokens: int
    cache_creation_tokens: int
    cache_read_tokens: int
    def __init__(self, execution_id: _Optional[str] = ..., sequence: _Optional[int] = ..., model: _Optional[str] = ..., harness: _Optional[str] = ..., cost_tier: _Optional[str] = ..., provider_cost_micros: _Optional[int] = ..., input_tokens: _Optional[int] = ..., output_tokens: _Optional[int] = ..., cache_creation_tokens: _Optional[int] = ..., cache_read_tokens: _Optional[int] = ...) -> None: ...

class ReportLlmCallUsageResponse(_message.Message):
    __slots__ = ("signal", "balance_after_micros", "billable_amount_micros", "rating")
    SIGNAL_FIELD_NUMBER: _ClassVar[int]
    BALANCE_AFTER_MICROS_FIELD_NUMBER: _ClassVar[int]
    BILLABLE_AMOUNT_MICROS_FIELD_NUMBER: _ClassVar[int]
    RATING_FIELD_NUMBER: _ClassVar[int]
    signal: _enum_pb2.ExecutionBillingSignal
    balance_after_micros: int
    billable_amount_micros: int
    rating: _policy_pb2.BillingUsageRating
    def __init__(self, signal: _Optional[_Union[_enum_pb2.ExecutionBillingSignal, str]] = ..., balance_after_micros: _Optional[int] = ..., billable_amount_micros: _Optional[int] = ..., rating: _Optional[_Union[_policy_pb2.BillingUsageRating, _Mapping]] = ...) -> None: ...

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
    __slots__ = ("org_id", "page", "type_filter", "start_time", "end_time")
    ORG_ID_FIELD_NUMBER: _ClassVar[int]
    PAGE_FIELD_NUMBER: _ClassVar[int]
    TYPE_FILTER_FIELD_NUMBER: _ClassVar[int]
    START_TIME_FIELD_NUMBER: _ClassVar[int]
    END_TIME_FIELD_NUMBER: _ClassVar[int]
    org_id: str
    page: _pagination_pb2.PageInfo
    type_filter: _containers.RepeatedScalarFieldContainer[_enum_pb2.LedgerEntryType]
    start_time: _timestamp_pb2.Timestamp
    end_time: _timestamp_pb2.Timestamp
    def __init__(self, org_id: _Optional[str] = ..., page: _Optional[_Union[_pagination_pb2.PageInfo, _Mapping]] = ..., type_filter: _Optional[_Iterable[_Union[_enum_pb2.LedgerEntryType, str]]] = ..., start_time: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., end_time: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...

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
