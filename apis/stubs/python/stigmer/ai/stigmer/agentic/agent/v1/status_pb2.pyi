from ai.stigmer.commons.apiresource import status_pb2 as _status_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class AgentStatus(_message.Message):
    __slots__ = ("audit", "version_hash", "warnings")
    AUDIT_FIELD_NUMBER: _ClassVar[int]
    VERSION_HASH_FIELD_NUMBER: _ClassVar[int]
    WARNINGS_FIELD_NUMBER: _ClassVar[int]
    audit: _status_pb2.ApiResourceAudit
    version_hash: str
    warnings: _containers.RepeatedCompositeFieldContainer[AgentWarning]
    def __init__(self, audit: _Optional[_Union[_status_pb2.ApiResourceAudit, _Mapping]] = ..., version_hash: _Optional[str] = ..., warnings: _Optional[_Iterable[_Union[AgentWarning, _Mapping]]] = ...) -> None: ...

class AgentWarning(_message.Message):
    __slots__ = ("kind", "message", "skill")
    KIND_FIELD_NUMBER: _ClassVar[int]
    MESSAGE_FIELD_NUMBER: _ClassVar[int]
    SKILL_FIELD_NUMBER: _ClassVar[int]
    kind: str
    message: str
    skill: str
    def __init__(self, kind: _Optional[str] = ..., message: _Optional[str] = ..., skill: _Optional[str] = ...) -> None: ...
