import datetime

from google.protobuf import timestamp_pb2 as _timestamp_pb2
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class BillingPolicy(_message.Message):
    __slots__ = ("policy_id", "harness", "cost_tier", "markup_basis_points", "minimum_charge_micros", "rounding_mode", "effective_at", "active")
    POLICY_ID_FIELD_NUMBER: _ClassVar[int]
    HARNESS_FIELD_NUMBER: _ClassVar[int]
    COST_TIER_FIELD_NUMBER: _ClassVar[int]
    MARKUP_BASIS_POINTS_FIELD_NUMBER: _ClassVar[int]
    MINIMUM_CHARGE_MICROS_FIELD_NUMBER: _ClassVar[int]
    ROUNDING_MODE_FIELD_NUMBER: _ClassVar[int]
    EFFECTIVE_AT_FIELD_NUMBER: _ClassVar[int]
    ACTIVE_FIELD_NUMBER: _ClassVar[int]
    policy_id: str
    harness: str
    cost_tier: str
    markup_basis_points: int
    minimum_charge_micros: int
    rounding_mode: str
    effective_at: _timestamp_pb2.Timestamp
    active: bool
    def __init__(self, policy_id: _Optional[str] = ..., harness: _Optional[str] = ..., cost_tier: _Optional[str] = ..., markup_basis_points: _Optional[int] = ..., minimum_charge_micros: _Optional[int] = ..., rounding_mode: _Optional[str] = ..., effective_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., active: bool = ...) -> None: ...

class BillingUsageRating(_message.Message):
    __slots__ = ("pricing_policy_id", "provider_cost_micros", "billable_amount_micros", "markup_basis_points", "model", "harness", "cost_tier")
    PRICING_POLICY_ID_FIELD_NUMBER: _ClassVar[int]
    PROVIDER_COST_MICROS_FIELD_NUMBER: _ClassVar[int]
    BILLABLE_AMOUNT_MICROS_FIELD_NUMBER: _ClassVar[int]
    MARKUP_BASIS_POINTS_FIELD_NUMBER: _ClassVar[int]
    MODEL_FIELD_NUMBER: _ClassVar[int]
    HARNESS_FIELD_NUMBER: _ClassVar[int]
    COST_TIER_FIELD_NUMBER: _ClassVar[int]
    pricing_policy_id: str
    provider_cost_micros: int
    billable_amount_micros: int
    markup_basis_points: int
    model: str
    harness: str
    cost_tier: str
    def __init__(self, pricing_policy_id: _Optional[str] = ..., provider_cost_micros: _Optional[int] = ..., billable_amount_micros: _Optional[int] = ..., markup_basis_points: _Optional[int] = ..., model: _Optional[str] = ..., harness: _Optional[str] = ..., cost_tier: _Optional[str] = ...) -> None: ...
