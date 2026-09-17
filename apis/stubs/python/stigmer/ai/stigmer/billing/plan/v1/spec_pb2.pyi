from ai.stigmer.platform.v1 import entitlement_pb2 as _entitlement_pb2
from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class PlanInstrument(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    plan_instrument_unspecified: _ClassVar[PlanInstrument]
    subscription: _ClassVar[PlanInstrument]
    license: _ClassVar[PlanInstrument]
plan_instrument_unspecified: PlanInstrument
subscription: PlanInstrument
license: PlanInstrument

class PlanSpec(_message.Message):
    __slots__ = ("instrument", "entitlements", "terms", "description")
    INSTRUMENT_FIELD_NUMBER: _ClassVar[int]
    ENTITLEMENTS_FIELD_NUMBER: _ClassVar[int]
    TERMS_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    instrument: PlanInstrument
    entitlements: _entitlement_pb2.Entitlements
    terms: PlanTerms
    description: str
    def __init__(self, instrument: _Optional[_Union[PlanInstrument, str]] = ..., entitlements: _Optional[_Union[_entitlement_pb2.Entitlements, _Mapping]] = ..., terms: _Optional[_Union[PlanTerms, _Mapping]] = ..., description: _Optional[str] = ...) -> None: ...

class PlanTerms(_message.Message):
    __slots__ = ("monthly_minimum_micros", "usage_share_basis_points", "per_extra_organization_micros", "annual_price_micros")
    MONTHLY_MINIMUM_MICROS_FIELD_NUMBER: _ClassVar[int]
    USAGE_SHARE_BASIS_POINTS_FIELD_NUMBER: _ClassVar[int]
    PER_EXTRA_ORGANIZATION_MICROS_FIELD_NUMBER: _ClassVar[int]
    ANNUAL_PRICE_MICROS_FIELD_NUMBER: _ClassVar[int]
    monthly_minimum_micros: int
    usage_share_basis_points: int
    per_extra_organization_micros: int
    annual_price_micros: int
    def __init__(self, monthly_minimum_micros: _Optional[int] = ..., usage_share_basis_points: _Optional[int] = ..., per_extra_organization_micros: _Optional[int] = ..., annual_price_micros: _Optional[int] = ...) -> None: ...
