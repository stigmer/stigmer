from ai.stigmer.commons.apiresource import status_pb2 as _status_pb2
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class EvaluatorStatus(_message.Message):
    __slots__ = ("period", "spent_usd", "reserved_usd", "graded", "not_graded", "last_not_graded_reason", "audit")
    PERIOD_FIELD_NUMBER: _ClassVar[int]
    SPENT_USD_FIELD_NUMBER: _ClassVar[int]
    RESERVED_USD_FIELD_NUMBER: _ClassVar[int]
    GRADED_FIELD_NUMBER: _ClassVar[int]
    NOT_GRADED_FIELD_NUMBER: _ClassVar[int]
    LAST_NOT_GRADED_REASON_FIELD_NUMBER: _ClassVar[int]
    AUDIT_FIELD_NUMBER: _ClassVar[int]
    period: str
    spent_usd: float
    reserved_usd: float
    graded: int
    not_graded: int
    last_not_graded_reason: str
    audit: _status_pb2.ApiResourceAudit
    def __init__(self, period: _Optional[str] = ..., spent_usd: _Optional[float] = ..., reserved_usd: _Optional[float] = ..., graded: _Optional[int] = ..., not_graded: _Optional[int] = ..., last_not_graded_reason: _Optional[str] = ..., audit: _Optional[_Union[_status_pb2.ApiResourceAudit, _Mapping]] = ...) -> None: ...
