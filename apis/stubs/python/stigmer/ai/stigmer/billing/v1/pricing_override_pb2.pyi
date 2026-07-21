import datetime

from google.protobuf import timestamp_pb2 as _timestamp_pb2
from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class ModelPricingOverrideStatus(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    model_pricing_override_status_unspecified: _ClassVar[ModelPricingOverrideStatus]
    pricing_override_pending_signoff: _ClassVar[ModelPricingOverrideStatus]
    pricing_override_active: _ClassVar[ModelPricingOverrideStatus]
    pricing_override_superseded: _ClassVar[ModelPricingOverrideStatus]
    pricing_override_rejected: _ClassVar[ModelPricingOverrideStatus]

class PricingRateField(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    pricing_rate_field_unspecified: _ClassVar[PricingRateField]
    pricing_rate_field_input: _ClassVar[PricingRateField]
    pricing_rate_field_output: _ClassVar[PricingRateField]
    pricing_rate_field_cache_write: _ClassVar[PricingRateField]
    pricing_rate_field_cache_read: _ClassVar[PricingRateField]
    pricing_rate_field_cursor_token_rate: _ClassVar[PricingRateField]
model_pricing_override_status_unspecified: ModelPricingOverrideStatus
pricing_override_pending_signoff: ModelPricingOverrideStatus
pricing_override_active: ModelPricingOverrideStatus
pricing_override_superseded: ModelPricingOverrideStatus
pricing_override_rejected: ModelPricingOverrideStatus
pricing_rate_field_unspecified: PricingRateField
pricing_rate_field_input: PricingRateField
pricing_rate_field_output: PricingRateField
pricing_rate_field_cache_write: PricingRateField
pricing_rate_field_cache_read: PricingRateField
pricing_rate_field_cursor_token_rate: PricingRateField

class PricingOverrideProvenance(_message.Message):
    __slots__ = ("source_provider", "window_from", "window_to", "observed_rate_micros_per_million", "effective_rate_at_derivation_micros_per_million", "delta_basis_points", "sample_tokens", "sample_cost_micros", "workflow_id", "derived_at")
    SOURCE_PROVIDER_FIELD_NUMBER: _ClassVar[int]
    WINDOW_FROM_FIELD_NUMBER: _ClassVar[int]
    WINDOW_TO_FIELD_NUMBER: _ClassVar[int]
    OBSERVED_RATE_MICROS_PER_MILLION_FIELD_NUMBER: _ClassVar[int]
    EFFECTIVE_RATE_AT_DERIVATION_MICROS_PER_MILLION_FIELD_NUMBER: _ClassVar[int]
    DELTA_BASIS_POINTS_FIELD_NUMBER: _ClassVar[int]
    SAMPLE_TOKENS_FIELD_NUMBER: _ClassVar[int]
    SAMPLE_COST_MICROS_FIELD_NUMBER: _ClassVar[int]
    WORKFLOW_ID_FIELD_NUMBER: _ClassVar[int]
    DERIVED_AT_FIELD_NUMBER: _ClassVar[int]
    source_provider: str
    window_from: str
    window_to: str
    observed_rate_micros_per_million: int
    effective_rate_at_derivation_micros_per_million: int
    delta_basis_points: int
    sample_tokens: int
    sample_cost_micros: int
    workflow_id: str
    derived_at: _timestamp_pb2.Timestamp
    def __init__(self, source_provider: _Optional[str] = ..., window_from: _Optional[str] = ..., window_to: _Optional[str] = ..., observed_rate_micros_per_million: _Optional[int] = ..., effective_rate_at_derivation_micros_per_million: _Optional[int] = ..., delta_basis_points: _Optional[int] = ..., sample_tokens: _Optional[int] = ..., sample_cost_micros: _Optional[int] = ..., workflow_id: _Optional[str] = ..., derived_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...

class ModelPricingOverride(_message.Message):
    __slots__ = ("override_id", "model_id", "provider", "harness", "variant", "rate_field", "rate_micros_per_million", "status", "provenance", "effective_at", "decided_by", "decided_at", "decision_note", "supersedes_override_id", "created_at")
    OVERRIDE_ID_FIELD_NUMBER: _ClassVar[int]
    MODEL_ID_FIELD_NUMBER: _ClassVar[int]
    PROVIDER_FIELD_NUMBER: _ClassVar[int]
    HARNESS_FIELD_NUMBER: _ClassVar[int]
    VARIANT_FIELD_NUMBER: _ClassVar[int]
    RATE_FIELD_FIELD_NUMBER: _ClassVar[int]
    RATE_MICROS_PER_MILLION_FIELD_NUMBER: _ClassVar[int]
    STATUS_FIELD_NUMBER: _ClassVar[int]
    PROVENANCE_FIELD_NUMBER: _ClassVar[int]
    EFFECTIVE_AT_FIELD_NUMBER: _ClassVar[int]
    DECIDED_BY_FIELD_NUMBER: _ClassVar[int]
    DECIDED_AT_FIELD_NUMBER: _ClassVar[int]
    DECISION_NOTE_FIELD_NUMBER: _ClassVar[int]
    SUPERSEDES_OVERRIDE_ID_FIELD_NUMBER: _ClassVar[int]
    CREATED_AT_FIELD_NUMBER: _ClassVar[int]
    override_id: str
    model_id: str
    provider: str
    harness: str
    variant: str
    rate_field: PricingRateField
    rate_micros_per_million: int
    status: ModelPricingOverrideStatus
    provenance: PricingOverrideProvenance
    effective_at: _timestamp_pb2.Timestamp
    decided_by: str
    decided_at: _timestamp_pb2.Timestamp
    decision_note: str
    supersedes_override_id: str
    created_at: _timestamp_pb2.Timestamp
    def __init__(self, override_id: _Optional[str] = ..., model_id: _Optional[str] = ..., provider: _Optional[str] = ..., harness: _Optional[str] = ..., variant: _Optional[str] = ..., rate_field: _Optional[_Union[PricingRateField, str]] = ..., rate_micros_per_million: _Optional[int] = ..., status: _Optional[_Union[ModelPricingOverrideStatus, str]] = ..., provenance: _Optional[_Union[PricingOverrideProvenance, _Mapping]] = ..., effective_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., decided_by: _Optional[str] = ..., decided_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., decision_note: _Optional[str] = ..., supersedes_override_id: _Optional[str] = ..., created_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...
