import datetime

from ai.stigmer.commons.apiresource import field_options_pb2 as _field_options_pb2
from ai.stigmer.iam.v1 import enum_pb2 as _enum_pb2
from google.protobuf import timestamp_pb2 as _timestamp_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class PlatformClientSpec(_message.Message):
    __slots__ = ("client_id", "client_secret_hash", "secret_fingerprint", "expires_at", "never_expires", "auto_provision_accounts", "auto_grant_on_org", "auto_grant_role", "allowed_origins")
    CLIENT_ID_FIELD_NUMBER: _ClassVar[int]
    CLIENT_SECRET_HASH_FIELD_NUMBER: _ClassVar[int]
    SECRET_FINGERPRINT_FIELD_NUMBER: _ClassVar[int]
    EXPIRES_AT_FIELD_NUMBER: _ClassVar[int]
    NEVER_EXPIRES_FIELD_NUMBER: _ClassVar[int]
    AUTO_PROVISION_ACCOUNTS_FIELD_NUMBER: _ClassVar[int]
    AUTO_GRANT_ON_ORG_FIELD_NUMBER: _ClassVar[int]
    AUTO_GRANT_ROLE_FIELD_NUMBER: _ClassVar[int]
    ALLOWED_ORIGINS_FIELD_NUMBER: _ClassVar[int]
    client_id: str
    client_secret_hash: str
    secret_fingerprint: str
    expires_at: _timestamp_pb2.Timestamp
    never_expires: bool
    auto_provision_accounts: bool
    auto_grant_on_org: bool
    auto_grant_role: _enum_pb2.IamRole
    allowed_origins: _containers.RepeatedScalarFieldContainer[str]
    def __init__(self, client_id: _Optional[str] = ..., client_secret_hash: _Optional[str] = ..., secret_fingerprint: _Optional[str] = ..., expires_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., never_expires: bool = ..., auto_provision_accounts: bool = ..., auto_grant_on_org: bool = ..., auto_grant_role: _Optional[_Union[_enum_pb2.IamRole, str]] = ..., allowed_origins: _Optional[_Iterable[str]] = ...) -> None: ...
