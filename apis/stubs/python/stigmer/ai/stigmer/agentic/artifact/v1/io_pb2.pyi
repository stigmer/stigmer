from ai.stigmer.agentic.artifact.v1 import api_pb2 as _api_pb2
from ai.stigmer.agentic.artifact.v1 import spec_pb2 as _spec_pb2
from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class ArtifactId(_message.Message):
    __slots__ = ("value",)
    VALUE_FIELD_NUMBER: _ClassVar[int]
    value: str
    def __init__(self, value: _Optional[str] = ...) -> None: ...

class ArtifactList(_message.Message):
    __slots__ = ("total_pages", "entries")
    TOTAL_PAGES_FIELD_NUMBER: _ClassVar[int]
    ENTRIES_FIELD_NUMBER: _ClassVar[int]
    total_pages: int
    entries: _containers.RepeatedCompositeFieldContainer[_api_pb2.Artifact]
    def __init__(self, total_pages: _Optional[int] = ..., entries: _Optional[_Iterable[_Union[_api_pb2.Artifact, _Mapping]]] = ...) -> None: ...

class CreateArtifactInput(_message.Message):
    __slots__ = ("spec", "content")
    SPEC_FIELD_NUMBER: _ClassVar[int]
    CONTENT_FIELD_NUMBER: _ClassVar[int]
    spec: _spec_pb2.ArtifactSpec
    content: bytes
    def __init__(self, spec: _Optional[_Union[_spec_pb2.ArtifactSpec, _Mapping]] = ..., content: _Optional[bytes] = ...) -> None: ...

class ListArtifactsByExecutionRequest(_message.Message):
    __slots__ = ("workflow_execution_id", "agent_execution_id", "page_size", "page_token")
    WORKFLOW_EXECUTION_ID_FIELD_NUMBER: _ClassVar[int]
    AGENT_EXECUTION_ID_FIELD_NUMBER: _ClassVar[int]
    PAGE_SIZE_FIELD_NUMBER: _ClassVar[int]
    PAGE_TOKEN_FIELD_NUMBER: _ClassVar[int]
    workflow_execution_id: str
    agent_execution_id: str
    page_size: int
    page_token: str
    def __init__(self, workflow_execution_id: _Optional[str] = ..., agent_execution_id: _Optional[str] = ..., page_size: _Optional[int] = ..., page_token: _Optional[str] = ...) -> None: ...

class GetArtifactContentRequest(_message.Message):
    __slots__ = ("artifact_id", "max_bytes")
    ARTIFACT_ID_FIELD_NUMBER: _ClassVar[int]
    MAX_BYTES_FIELD_NUMBER: _ClassVar[int]
    artifact_id: str
    max_bytes: int
    def __init__(self, artifact_id: _Optional[str] = ..., max_bytes: _Optional[int] = ...) -> None: ...

class GetArtifactContentResponse(_message.Message):
    __slots__ = ("content", "content_type", "total_size_bytes", "truncated")
    CONTENT_FIELD_NUMBER: _ClassVar[int]
    CONTENT_TYPE_FIELD_NUMBER: _ClassVar[int]
    TOTAL_SIZE_BYTES_FIELD_NUMBER: _ClassVar[int]
    TRUNCATED_FIELD_NUMBER: _ClassVar[int]
    content: bytes
    content_type: str
    total_size_bytes: int
    truncated: bool
    def __init__(self, content: _Optional[bytes] = ..., content_type: _Optional[str] = ..., total_size_bytes: _Optional[int] = ..., truncated: bool = ...) -> None: ...

class ArtifactDownloadUrl(_message.Message):
    __slots__ = ("url", "ttl_seconds", "size_bytes", "content_type")
    URL_FIELD_NUMBER: _ClassVar[int]
    TTL_SECONDS_FIELD_NUMBER: _ClassVar[int]
    SIZE_BYTES_FIELD_NUMBER: _ClassVar[int]
    CONTENT_TYPE_FIELD_NUMBER: _ClassVar[int]
    url: str
    ttl_seconds: int
    size_bytes: int
    content_type: str
    def __init__(self, url: _Optional[str] = ..., ttl_seconds: _Optional[int] = ..., size_bytes: _Optional[int] = ..., content_type: _Optional[str] = ...) -> None: ...
