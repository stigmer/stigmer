import datetime

from ai.stigmer.commons.apiresource import status_pb2 as _status_pb2
from google.protobuf import timestamp_pb2 as _timestamp_pb2
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class ScheduleStatus(_message.Message):
    __slots__ = ("next_fire_at", "last_fire_at", "last_execution_id", "consecutive_failures", "paused_reason", "audit")
    NEXT_FIRE_AT_FIELD_NUMBER: _ClassVar[int]
    LAST_FIRE_AT_FIELD_NUMBER: _ClassVar[int]
    LAST_EXECUTION_ID_FIELD_NUMBER: _ClassVar[int]
    CONSECUTIVE_FAILURES_FIELD_NUMBER: _ClassVar[int]
    PAUSED_REASON_FIELD_NUMBER: _ClassVar[int]
    AUDIT_FIELD_NUMBER: _ClassVar[int]
    next_fire_at: _timestamp_pb2.Timestamp
    last_fire_at: _timestamp_pb2.Timestamp
    last_execution_id: str
    consecutive_failures: int
    paused_reason: str
    audit: _status_pb2.ApiResourceAudit
    def __init__(self, next_fire_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., last_fire_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., last_execution_id: _Optional[str] = ..., consecutive_failures: _Optional[int] = ..., paused_reason: _Optional[str] = ..., audit: _Optional[_Union[_status_pb2.ApiResourceAudit, _Mapping]] = ...) -> None: ...
