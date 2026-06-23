from ai.stigmer.agentic.agentexecution.v1 import enum_pb2 as _enum_pb2
from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class ExecutionArtifact(_message.Message):
    __slots__ = ("name", "sandbox_path", "kind", "size_bytes", "storage_key", "created_at", "expires_at", "entries", "content_hash")
    NAME_FIELD_NUMBER: _ClassVar[int]
    SANDBOX_PATH_FIELD_NUMBER: _ClassVar[int]
    KIND_FIELD_NUMBER: _ClassVar[int]
    SIZE_BYTES_FIELD_NUMBER: _ClassVar[int]
    STORAGE_KEY_FIELD_NUMBER: _ClassVar[int]
    CREATED_AT_FIELD_NUMBER: _ClassVar[int]
    EXPIRES_AT_FIELD_NUMBER: _ClassVar[int]
    ENTRIES_FIELD_NUMBER: _ClassVar[int]
    CONTENT_HASH_FIELD_NUMBER: _ClassVar[int]
    name: str
    sandbox_path: str
    kind: _enum_pb2.ExecutionArtifactKind
    size_bytes: int
    storage_key: str
    created_at: str
    expires_at: str
    entries: _containers.RepeatedScalarFieldContainer[str]
    content_hash: str
    def __init__(self, name: _Optional[str] = ..., sandbox_path: _Optional[str] = ..., kind: _Optional[_Union[_enum_pb2.ExecutionArtifactKind, str]] = ..., size_bytes: _Optional[int] = ..., storage_key: _Optional[str] = ..., created_at: _Optional[str] = ..., expires_at: _Optional[str] = ..., entries: _Optional[_Iterable[str]] = ..., content_hash: _Optional[str] = ...) -> None: ...
