from ai.stigmer.agentic.session.v1 import memory_pb2 as _memory_pb2
from ai.stigmer.agentic.session.v1 import spec_pb2 as _spec_pb2
from ai.stigmer.commons.apiresource import metadata_pb2 as _metadata_pb2
from ai.stigmer.commons.apiresource import status_pb2 as _status_pb2
from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class Session(_message.Message):
    __slots__ = ("api_version", "kind", "metadata", "spec", "status")
    API_VERSION_FIELD_NUMBER: _ClassVar[int]
    KIND_FIELD_NUMBER: _ClassVar[int]
    METADATA_FIELD_NUMBER: _ClassVar[int]
    SPEC_FIELD_NUMBER: _ClassVar[int]
    STATUS_FIELD_NUMBER: _ClassVar[int]
    api_version: str
    kind: str
    metadata: _metadata_pb2.ApiResourceMetadata
    spec: _spec_pb2.SessionSpec
    status: SessionStatus
    def __init__(self, api_version: _Optional[str] = ..., kind: _Optional[str] = ..., metadata: _Optional[_Union[_metadata_pb2.ApiResourceMetadata, _Mapping]] = ..., spec: _Optional[_Union[_spec_pb2.SessionSpec, _Mapping]] = ..., status: _Optional[_Union[SessionStatus, _Mapping]] = ...) -> None: ...

class SessionStatus(_message.Message):
    __slots__ = ("session_memory", "audit")
    SESSION_MEMORY_FIELD_NUMBER: _ClassVar[int]
    AUDIT_FIELD_NUMBER: _ClassVar[int]
    session_memory: _memory_pb2.SessionMemory
    audit: _status_pb2.ApiResourceAudit
    def __init__(self, session_memory: _Optional[_Union[_memory_pb2.SessionMemory, _Mapping]] = ..., audit: _Optional[_Union[_status_pb2.ApiResourceAudit, _Mapping]] = ...) -> None: ...
