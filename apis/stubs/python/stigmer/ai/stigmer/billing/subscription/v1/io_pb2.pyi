import datetime

from ai.stigmer.platform.v1 import entitlement_pb2 as _entitlement_pb2
from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf import timestamp_pb2 as _timestamp_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class PeriodEstimateLineKind(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    period_estimate_line_kind_unspecified: _ClassVar[PeriodEstimateLineKind]
    plan: _ClassVar[PeriodEstimateLineKind]
    commission_credit: _ClassVar[PeriodEstimateLineKind]
    managed_organizations: _ClassVar[PeriodEstimateLineKind]
period_estimate_line_kind_unspecified: PeriodEstimateLineKind
plan: PeriodEstimateLineKind
commission_credit: PeriodEstimateLineKind
managed_organizations: PeriodEstimateLineKind

class GetSubscriptionForOrgInput(_message.Message):
    __slots__ = ("org",)
    ORG_FIELD_NUMBER: _ClassVar[int]
    org: str
    def __init__(self, org: _Optional[str] = ...) -> None: ...

class GetEntitlementsInput(_message.Message):
    __slots__ = ("org",)
    ORG_FIELD_NUMBER: _ClassVar[int]
    org: str
    def __init__(self, org: _Optional[str] = ...) -> None: ...

class GetEntitlementsOutput(_message.Message):
    __slots__ = ("entitlements", "plan_id")
    ENTITLEMENTS_FIELD_NUMBER: _ClassVar[int]
    PLAN_ID_FIELD_NUMBER: _ClassVar[int]
    entitlements: _entitlement_pb2.Entitlements
    plan_id: str
    def __init__(self, entitlements: _Optional[_Union[_entitlement_pb2.Entitlements, _Mapping]] = ..., plan_id: _Optional[str] = ...) -> None: ...

class ChangePlanInput(_message.Message):
    __slots__ = ("org", "plan_id")
    ORG_FIELD_NUMBER: _ClassVar[int]
    PLAN_ID_FIELD_NUMBER: _ClassVar[int]
    org: str
    plan_id: str
    def __init__(self, org: _Optional[str] = ..., plan_id: _Optional[str] = ...) -> None: ...

class CancelSubscriptionInput(_message.Message):
    __slots__ = ("org",)
    ORG_FIELD_NUMBER: _ClassVar[int]
    org: str
    def __init__(self, org: _Optional[str] = ...) -> None: ...

class GetPeriodEstimateInput(_message.Message):
    __slots__ = ("org",)
    ORG_FIELD_NUMBER: _ClassVar[int]
    org: str
    def __init__(self, org: _Optional[str] = ...) -> None: ...

class PeriodEstimate(_message.Message):
    __slots__ = ("plan_id", "period_start", "period_end", "provider_cost_micros", "commission_collected_micros", "managed_organization_count", "lines", "total_micros")
    PLAN_ID_FIELD_NUMBER: _ClassVar[int]
    PERIOD_START_FIELD_NUMBER: _ClassVar[int]
    PERIOD_END_FIELD_NUMBER: _ClassVar[int]
    PROVIDER_COST_MICROS_FIELD_NUMBER: _ClassVar[int]
    COMMISSION_COLLECTED_MICROS_FIELD_NUMBER: _ClassVar[int]
    MANAGED_ORGANIZATION_COUNT_FIELD_NUMBER: _ClassVar[int]
    LINES_FIELD_NUMBER: _ClassVar[int]
    TOTAL_MICROS_FIELD_NUMBER: _ClassVar[int]
    plan_id: str
    period_start: _timestamp_pb2.Timestamp
    period_end: _timestamp_pb2.Timestamp
    provider_cost_micros: int
    commission_collected_micros: int
    managed_organization_count: int
    lines: _containers.RepeatedCompositeFieldContainer[PeriodEstimateLine]
    total_micros: int
    def __init__(self, plan_id: _Optional[str] = ..., period_start: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., period_end: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., provider_cost_micros: _Optional[int] = ..., commission_collected_micros: _Optional[int] = ..., managed_organization_count: _Optional[int] = ..., lines: _Optional[_Iterable[_Union[PeriodEstimateLine, _Mapping]]] = ..., total_micros: _Optional[int] = ...) -> None: ...

class PeriodEstimateLine(_message.Message):
    __slots__ = ("kind", "amount_micros")
    KIND_FIELD_NUMBER: _ClassVar[int]
    AMOUNT_MICROS_FIELD_NUMBER: _ClassVar[int]
    kind: PeriodEstimateLineKind
    amount_micros: int
    def __init__(self, kind: _Optional[_Union[PeriodEstimateLineKind, str]] = ..., amount_micros: _Optional[int] = ...) -> None: ...
