import datetime

from google.protobuf import timestamp_pb2 as _timestamp_pb2
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class ApiResourceAuditStatus(_message.Message):
    __slots__ = ("audit",)
    AUDIT_FIELD_NUMBER: _ClassVar[int]
    audit: ApiResourceAudit
    def __init__(self, audit: _Optional[_Union[ApiResourceAudit, _Mapping]] = ...) -> None: ...

class ApiResourceAudit(_message.Message):
    __slots__ = ("spec_audit", "status_audit")
    SPEC_AUDIT_FIELD_NUMBER: _ClassVar[int]
    STATUS_AUDIT_FIELD_NUMBER: _ClassVar[int]
    spec_audit: ApiResourceAuditInfo
    status_audit: ApiResourceAuditInfo
    def __init__(self, spec_audit: _Optional[_Union[ApiResourceAuditInfo, _Mapping]] = ..., status_audit: _Optional[_Union[ApiResourceAuditInfo, _Mapping]] = ...) -> None: ...

class ApiResourceAuditInfo(_message.Message):
    __slots__ = ("created_by", "created_at", "updated_by", "updated_at", "event")
    CREATED_BY_FIELD_NUMBER: _ClassVar[int]
    CREATED_AT_FIELD_NUMBER: _ClassVar[int]
    UPDATED_BY_FIELD_NUMBER: _ClassVar[int]
    UPDATED_AT_FIELD_NUMBER: _ClassVar[int]
    EVENT_FIELD_NUMBER: _ClassVar[int]
    created_by: ApiResourceAuditActor
    created_at: _timestamp_pb2.Timestamp
    updated_by: ApiResourceAuditActor
    updated_at: _timestamp_pb2.Timestamp
    event: str
    def __init__(self, created_by: _Optional[_Union[ApiResourceAuditActor, _Mapping]] = ..., created_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., updated_by: _Optional[_Union[ApiResourceAuditActor, _Mapping]] = ..., updated_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., event: _Optional[str] = ...) -> None: ...

class ApiResourceAuditActor(_message.Message):
    __slots__ = ("id", "avatar")
    ID_FIELD_NUMBER: _ClassVar[int]
    AVATAR_FIELD_NUMBER: _ClassVar[int]
    id: str
    avatar: str
    def __init__(self, id: _Optional[str] = ..., avatar: _Optional[str] = ...) -> None: ...
