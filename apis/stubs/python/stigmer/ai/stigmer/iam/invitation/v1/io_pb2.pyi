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
    __slots__ = ("entries", "next_page_token")
    ENTRIES_FIELD_NUMBER: _ClassVar[int]
    NEXT_PAGE_TOKEN_FIELD_NUMBER: _ClassVar[int]
    entries: _containers.RepeatedCompositeFieldContainer[_api_pb2.Invitation]
    next_page_token: str
    def __init__(self, entries: _Optional[_Iterable[_Union[_api_pb2.Invitation, _Mapping]]] = ..., next_page_token: _Optional[str] = ...) -> None: ...

class ListInvitationsByOrgInput(_message.Message):
    __slots__ = ("org", "page_size", "page_token")
    ORG_FIELD_NUMBER: _ClassVar[int]
    PAGE_SIZE_FIELD_NUMBER: _ClassVar[int]
    PAGE_TOKEN_FIELD_NUMBER: _ClassVar[int]
    org: str
    page_size: int
    page_token: str
    def __init__(self, org: _Optional[str] = ..., page_size: _Optional[int] = ..., page_token: _Optional[str] = ...) -> None: ...

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
    __slots__ = ("org_name", "org_slug", "org_logo_url", "role", "expires_at", "label", "is_valid", "invalid_reason")
    ORG_NAME_FIELD_NUMBER: _ClassVar[int]
    ORG_SLUG_FIELD_NUMBER: _ClassVar[int]
    ORG_LOGO_URL_FIELD_NUMBER: _ClassVar[int]
    ROLE_FIELD_NUMBER: _ClassVar[int]
    EXPIRES_AT_FIELD_NUMBER: _ClassVar[int]
    LABEL_FIELD_NUMBER: _ClassVar[int]
    IS_VALID_FIELD_NUMBER: _ClassVar[int]
    INVALID_REASON_FIELD_NUMBER: _ClassVar[int]
    org_name: str
    org_slug: str
    org_logo_url: str
    role: _enum_pb2.IamRole
    expires_at: _timestamp_pb2.Timestamp
    label: str
    is_valid: bool
    invalid_reason: str
    def __init__(self, org_name: _Optional[str] = ..., org_slug: _Optional[str] = ..., org_logo_url: _Optional[str] = ..., role: _Optional[_Union[_enum_pb2.IamRole, str]] = ..., expires_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., label: _Optional[str] = ..., is_valid: bool = ..., invalid_reason: _Optional[str] = ...) -> None: ...
