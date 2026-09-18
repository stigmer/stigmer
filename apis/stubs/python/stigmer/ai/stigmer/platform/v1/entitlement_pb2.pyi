from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class Feature(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    feature_unspecified: _ClassVar[Feature]
    sso_enforcement: _ClassVar[Feature]
    platform_client: _ClassVar[Feature]
    byo_provider_keys: _ClassVar[Feature]
    channels: _ClassVar[Feature]
    sharing: _ClassVar[Feature]
feature_unspecified: Feature
sso_enforcement: Feature
platform_client: Feature
byo_provider_keys: Feature
channels: Feature
sharing: Feature

class Entitlements(_message.Message):
    __slots__ = ("limits", "features")
    LIMITS_FIELD_NUMBER: _ClassVar[int]
    FEATURES_FIELD_NUMBER: _ClassVar[int]
    limits: EntitlementLimits
    features: _containers.RepeatedScalarFieldContainer[Feature]
    def __init__(self, limits: _Optional[_Union[EntitlementLimits, _Mapping]] = ..., features: _Optional[_Iterable[_Union[Feature, str]]] = ...) -> None: ...

class EntitlementLimits(_message.Message):
    __slots__ = ("max_organizations", "max_users", "included_managed_organizations")
    MAX_ORGANIZATIONS_FIELD_NUMBER: _ClassVar[int]
    MAX_USERS_FIELD_NUMBER: _ClassVar[int]
    INCLUDED_MANAGED_ORGANIZATIONS_FIELD_NUMBER: _ClassVar[int]
    max_organizations: int
    max_users: int
    included_managed_organizations: int
    def __init__(self, max_organizations: _Optional[int] = ..., max_users: _Optional[int] = ..., included_managed_organizations: _Optional[int] = ...) -> None: ...
