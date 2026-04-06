import datetime

from ai.stigmer.iam.invitation.v1 import api_pb2 as _api_pb2
from ai.stigmer.iam.v1 import enum_pb2 as _enum_pb2
from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf import timestamp_pb2 as _timestamp_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class InvitationId(_message.Message):
    __slots__ = ("value",)
    VALUE_FIELD_NUMBER: _ClassVar[int]
    value: str
    def __init__(self, value: _Optional[str] = ...) -> None: ...

class Invitations(_message.Message):
    __slots__ = ("entries",)
    ENTRIES_FIELD_NUMBER: _ClassVar[int]
    entries: _containers.RepeatedCompositeFieldContainer[_api_pb2.Invitation]
    def __init__(self, entries: _Optional[_Iterable[_Union[_api_pb2.Invitation, _Mapping]]] = ...) -> None: ...

class ListInvitationsByOrgInput(_message.Message):
    __slots__ = ("org",)
    ORG_FIELD_NUMBER: _ClassVar[int]
    org: str
    def __init__(self, org: _Optional[str] = ...) -> None: ...

class InvitationTokenInput(_message.Message):
    __slots__ = ("token",)
    TOKEN_FIELD_NUMBER: _ClassVar[int]
    token: str
    def __init__(self, token: _Optional[str] = ...) -> None: ...

class RedeemInvitationInput(_message.Message):
    __slots__ = ("token",)
    TOKEN_FIELD_NUMBER: _ClassVar[int]
    token: str
    def __init__(self, token: _Optional[str] = ...) -> None: ...

class InvitationPreview(_message.Message):
    __slots__ = ("organization_name", "organization_slug", "organization_logo_url", "role", "expires_at", "label", "is_valid", "invalid_reason")
    ORGANIZATION_NAME_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_SLUG_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_LOGO_URL_FIELD_NUMBER: _ClassVar[int]
    ROLE_FIELD_NUMBER: _ClassVar[int]
    EXPIRES_AT_FIELD_NUMBER: _ClassVar[int]
    LABEL_FIELD_NUMBER: _ClassVar[int]
    IS_VALID_FIELD_NUMBER: _ClassVar[int]
    INVALID_REASON_FIELD_NUMBER: _ClassVar[int]
    organization_name: str
    organization_slug: str
    organization_logo_url: str
    role: _enum_pb2.IamRole
    expires_at: _timestamp_pb2.Timestamp
    label: str
    is_valid: bool
    invalid_reason: str
    def __init__(self, organization_name: _Optional[str] = ..., organization_slug: _Optional[str] = ..., organization_logo_url: _Optional[str] = ..., role: _Optional[_Union[_enum_pb2.IamRole, str]] = ..., expires_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., label: _Optional[str] = ..., is_valid: bool = ..., invalid_reason: _Optional[str] = ...) -> None: ...
