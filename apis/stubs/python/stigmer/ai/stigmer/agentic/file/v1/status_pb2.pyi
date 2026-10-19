from ai.stigmer.commons.apiresource import status_pb2 as _status_pb2
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class FileStatus(_message.Message):
    __slots__ = ("size_bytes", "session_id", "run_id", "audit")
    SIZE_BYTES_FIELD_NUMBER: _ClassVar[int]
    SESSION_ID_FIELD_NUMBER: _ClassVar[int]
    RUN_ID_FIELD_NUMBER: _ClassVar[int]
    AUDIT_FIELD_NUMBER: _ClassVar[int]
    size_bytes: int
    session_id: str
    run_id: str
    audit: _status_pb2.ApiResourceAudit
    def __init__(self, size_bytes: _Optional[int] = ..., session_id: _Optional[str] = ..., run_id: _Optional[str] = ..., audit: _Optional[_Union[_status_pb2.ApiResourceAudit, _Mapping]] = ...) -> None: ...
