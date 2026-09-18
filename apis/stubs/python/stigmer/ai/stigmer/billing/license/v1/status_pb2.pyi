import datetime

from ai.stigmer.commons.apiresource import status_pb2 as _status_pb2
from google.protobuf import timestamp_pb2 as _timestamp_pb2
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class LicenseStatus(_message.Message):
    __slots__ = ("audit", "key_id", "issued_at", "ticket")
    AUDIT_FIELD_NUMBER: _ClassVar[int]
    KEY_ID_FIELD_NUMBER: _ClassVar[int]
    ISSUED_AT_FIELD_NUMBER: _ClassVar[int]
    TICKET_FIELD_NUMBER: _ClassVar[int]
    audit: _status_pb2.ApiResourceAudit
    key_id: str
    issued_at: _timestamp_pb2.Timestamp
    ticket: str
    def __init__(self, audit: _Optional[_Union[_status_pb2.ApiResourceAudit, _Mapping]] = ..., key_id: _Optional[str] = ..., issued_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., ticket: _Optional[str] = ...) -> None: ...
