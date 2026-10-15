from ai.stigmer.commons.apiresource import status_pb2 as _status_pb2
from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class EvalStatus(_message.Message):
    __slots__ = ("audit", "digest", "case_count", "case_tags", "cases", "findings", "mock_servers")
    AUDIT_FIELD_NUMBER: _ClassVar[int]
    DIGEST_FIELD_NUMBER: _ClassVar[int]
    CASE_COUNT_FIELD_NUMBER: _ClassVar[int]
    CASE_TAGS_FIELD_NUMBER: _ClassVar[int]
    CASES_FIELD_NUMBER: _ClassVar[int]
    FINDINGS_FIELD_NUMBER: _ClassVar[int]
    MOCK_SERVERS_FIELD_NUMBER: _ClassVar[int]
    audit: _status_pb2.ApiResourceAudit
    digest: str
    case_count: int
    case_tags: _containers.RepeatedScalarFieldContainer[str]
    cases: _containers.RepeatedCompositeFieldContainer[EvalCaseSummary]
    findings: _containers.RepeatedCompositeFieldContainer[EvalFinding]
    mock_servers: _containers.RepeatedScalarFieldContainer[str]
    def __init__(self, audit: _Optional[_Union[_status_pb2.ApiResourceAudit, _Mapping]] = ..., digest: _Optional[str] = ..., case_count: _Optional[int] = ..., case_tags: _Optional[_Iterable[str]] = ..., cases: _Optional[_Iterable[_Union[EvalCaseSummary, _Mapping]]] = ..., findings: _Optional[_Iterable[_Union[EvalFinding, _Mapping]]] = ..., mock_servers: _Optional[_Iterable[str]] = ...) -> None: ...

class EvalCaseSummary(_message.Message):
    __slots__ = ("case_name", "path", "case_tags", "unsupported")
    CASE_NAME_FIELD_NUMBER: _ClassVar[int]
    PATH_FIELD_NUMBER: _ClassVar[int]
    CASE_TAGS_FIELD_NUMBER: _ClassVar[int]
    UNSUPPORTED_FIELD_NUMBER: _ClassVar[int]
    case_name: str
    path: str
    case_tags: _containers.RepeatedScalarFieldContainer[str]
    unsupported: str
    def __init__(self, case_name: _Optional[str] = ..., path: _Optional[str] = ..., case_tags: _Optional[_Iterable[str]] = ..., unsupported: _Optional[str] = ...) -> None: ...

class EvalFinding(_message.Message):
    __slots__ = ("kind", "message", "path")
    KIND_FIELD_NUMBER: _ClassVar[int]
    MESSAGE_FIELD_NUMBER: _ClassVar[int]
    PATH_FIELD_NUMBER: _ClassVar[int]
    kind: str
    message: str
    path: str
    def __init__(self, kind: _Optional[str] = ..., message: _Optional[str] = ..., path: _Optional[str] = ...) -> None: ...
