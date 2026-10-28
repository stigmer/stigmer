import datetime

from google.protobuf import timestamp_pb2 as _timestamp_pb2
from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class ProviderKeyCheck(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    provider_key_check_unspecified: _ClassVar[ProviderKeyCheck]
    checked: _ClassVar[ProviderKeyCheck]
    unchecked: _ClassVar[ProviderKeyCheck]
provider_key_check_unspecified: ProviderKeyCheck
checked: ProviderKeyCheck
unchecked: ProviderKeyCheck

class ProviderKey(_message.Message):
    __slots__ = ("org", "provider", "key_hint", "created_by", "created_at", "updated_at", "last_used_at", "inherited_from_org", "base_url", "check")
    ORG_FIELD_NUMBER: _ClassVar[int]
    PROVIDER_FIELD_NUMBER: _ClassVar[int]
    KEY_HINT_FIELD_NUMBER: _ClassVar[int]
    CREATED_BY_FIELD_NUMBER: _ClassVar[int]
    CREATED_AT_FIELD_NUMBER: _ClassVar[int]
    UPDATED_AT_FIELD_NUMBER: _ClassVar[int]
    LAST_USED_AT_FIELD_NUMBER: _ClassVar[int]
    INHERITED_FROM_ORG_FIELD_NUMBER: _ClassVar[int]
    BASE_URL_FIELD_NUMBER: _ClassVar[int]
    CHECK_FIELD_NUMBER: _ClassVar[int]
    org: str
    provider: str
    key_hint: str
    created_by: str
    created_at: _timestamp_pb2.Timestamp
    updated_at: _timestamp_pb2.Timestamp
    last_used_at: _timestamp_pb2.Timestamp
    inherited_from_org: str
    base_url: str
    check: ProviderKeyCheck
    def __init__(self, org: _Optional[str] = ..., provider: _Optional[str] = ..., key_hint: _Optional[str] = ..., created_by: _Optional[str] = ..., created_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., updated_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., last_used_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., inherited_from_org: _Optional[str] = ..., base_url: _Optional[str] = ..., check: _Optional[_Union[ProviderKeyCheck, str]] = ...) -> None: ...
