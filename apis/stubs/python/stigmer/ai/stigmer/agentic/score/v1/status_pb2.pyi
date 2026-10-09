from ai.stigmer.agentic.score.v1 import enum_pb2 as _enum_pb2
from ai.stigmer.commons.apiresource import status_pb2 as _status_pb2
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class ScoreStatus(_message.Message):
    __slots__ = ("state", "not_graded_reason", "audit")
    STATE_FIELD_NUMBER: _ClassVar[int]
    NOT_GRADED_REASON_FIELD_NUMBER: _ClassVar[int]
    AUDIT_FIELD_NUMBER: _ClassVar[int]
    state: _enum_pb2.ScoreState
    not_graded_reason: str
    audit: _status_pb2.ApiResourceAudit
    def __init__(self, state: _Optional[_Union[_enum_pb2.ScoreState, str]] = ..., not_graded_reason: _Optional[str] = ..., audit: _Optional[_Union[_status_pb2.ApiResourceAudit, _Mapping]] = ...) -> None: ...
