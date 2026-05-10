import datetime

from ai.stigmer.agentic.skill.v1 import status_pb2 as _status_pb2
from ai.stigmer.commons.apiresource import status_pb2 as _status_pb2_1
from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf import timestamp_pb2 as _timestamp_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class SkillId(_message.Message):
    __slots__ = ("value",)
    VALUE_FIELD_NUMBER: _ClassVar[int]
    value: str
    def __init__(self, value: _Optional[str] = ...) -> None: ...

class PushSkillRequest(_message.Message):
    __slots__ = ("org", "artifact", "tag", "git_provenance", "message")
    ORG_FIELD_NUMBER: _ClassVar[int]
    ARTIFACT_FIELD_NUMBER: _ClassVar[int]
    TAG_FIELD_NUMBER: _ClassVar[int]
    GIT_PROVENANCE_FIELD_NUMBER: _ClassVar[int]
    MESSAGE_FIELD_NUMBER: _ClassVar[int]
    org: str
    artifact: bytes
    tag: str
    git_provenance: _status_pb2.GitProvenance
    message: str
    def __init__(self, org: _Optional[str] = ..., artifact: _Optional[bytes] = ..., tag: _Optional[str] = ..., git_provenance: _Optional[_Union[_status_pb2.GitProvenance, _Mapping]] = ..., message: _Optional[str] = ...) -> None: ...

class PushSkillFromExecutionArtifactRequest(_message.Message):
    __slots__ = ("org", "execution_id", "storage_key", "tag")
    ORG_FIELD_NUMBER: _ClassVar[int]
    EXECUTION_ID_FIELD_NUMBER: _ClassVar[int]
    STORAGE_KEY_FIELD_NUMBER: _ClassVar[int]
    TAG_FIELD_NUMBER: _ClassVar[int]
    org: str
    execution_id: str
    storage_key: str
    tag: str
    def __init__(self, org: _Optional[str] = ..., execution_id: _Optional[str] = ..., storage_key: _Optional[str] = ..., tag: _Optional[str] = ...) -> None: ...

class GetArtifactRequest(_message.Message):
    __slots__ = ("artifact_storage_key",)
    ARTIFACT_STORAGE_KEY_FIELD_NUMBER: _ClassVar[int]
    artifact_storage_key: str
    def __init__(self, artifact_storage_key: _Optional[str] = ...) -> None: ...

class GetArtifactResponse(_message.Message):
    __slots__ = ("artifact",)
    ARTIFACT_FIELD_NUMBER: _ClassVar[int]
    artifact: bytes
    def __init__(self, artifact: _Optional[bytes] = ...) -> None: ...

class ListSkillVersionsInput(_message.Message):
    __slots__ = ("org", "slug", "page_token", "page_size")
    ORG_FIELD_NUMBER: _ClassVar[int]
    SLUG_FIELD_NUMBER: _ClassVar[int]
    PAGE_TOKEN_FIELD_NUMBER: _ClassVar[int]
    PAGE_SIZE_FIELD_NUMBER: _ClassVar[int]
    org: str
    slug: str
    page_token: str
    page_size: int
    def __init__(self, org: _Optional[str] = ..., slug: _Optional[str] = ..., page_token: _Optional[str] = ..., page_size: _Optional[int] = ...) -> None: ...

class SkillVersionEntry(_message.Message):
    __slots__ = ("version_hash", "pushed_at", "pushed_by", "tag", "is_current", "git_provenance", "message", "artifact_storage_key")
    VERSION_HASH_FIELD_NUMBER: _ClassVar[int]
    PUSHED_AT_FIELD_NUMBER: _ClassVar[int]
    PUSHED_BY_FIELD_NUMBER: _ClassVar[int]
    TAG_FIELD_NUMBER: _ClassVar[int]
    IS_CURRENT_FIELD_NUMBER: _ClassVar[int]
    GIT_PROVENANCE_FIELD_NUMBER: _ClassVar[int]
    MESSAGE_FIELD_NUMBER: _ClassVar[int]
    ARTIFACT_STORAGE_KEY_FIELD_NUMBER: _ClassVar[int]
    version_hash: str
    pushed_at: _timestamp_pb2.Timestamp
    pushed_by: _status_pb2_1.ApiResourceAuditActor
    tag: str
    is_current: bool
    git_provenance: _status_pb2.GitProvenance
    message: str
    artifact_storage_key: str
    def __init__(self, version_hash: _Optional[str] = ..., pushed_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., pushed_by: _Optional[_Union[_status_pb2_1.ApiResourceAuditActor, _Mapping]] = ..., tag: _Optional[str] = ..., is_current: bool = ..., git_provenance: _Optional[_Union[_status_pb2.GitProvenance, _Mapping]] = ..., message: _Optional[str] = ..., artifact_storage_key: _Optional[str] = ...) -> None: ...

class ListSkillVersionsResponse(_message.Message):
    __slots__ = ("versions", "next_page_token", "total_count")
    VERSIONS_FIELD_NUMBER: _ClassVar[int]
    NEXT_PAGE_TOKEN_FIELD_NUMBER: _ClassVar[int]
    TOTAL_COUNT_FIELD_NUMBER: _ClassVar[int]
    versions: _containers.RepeatedCompositeFieldContainer[SkillVersionEntry]
    next_page_token: str
    total_count: int
    def __init__(self, versions: _Optional[_Iterable[_Union[SkillVersionEntry, _Mapping]]] = ..., next_page_token: _Optional[str] = ..., total_count: _Optional[int] = ...) -> None: ...
