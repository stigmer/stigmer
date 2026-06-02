import datetime

from ai.stigmer.agentic.agent.v1 import spec_pb2 as _spec_pb2
from ai.stigmer.commons.apiresource import status_pb2 as _status_pb2
from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf import timestamp_pb2 as _timestamp_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class AgentVersionEntry(_message.Message):
    __slots__ = ("version_hash", "applied_at", "applied_by", "tag", "is_current", "message", "spec_snapshot", "git_provenance")
    VERSION_HASH_FIELD_NUMBER: _ClassVar[int]
    APPLIED_AT_FIELD_NUMBER: _ClassVar[int]
    APPLIED_BY_FIELD_NUMBER: _ClassVar[int]
    TAG_FIELD_NUMBER: _ClassVar[int]
    IS_CURRENT_FIELD_NUMBER: _ClassVar[int]
    MESSAGE_FIELD_NUMBER: _ClassVar[int]
    SPEC_SNAPSHOT_FIELD_NUMBER: _ClassVar[int]
    GIT_PROVENANCE_FIELD_NUMBER: _ClassVar[int]
    version_hash: str
    applied_at: _timestamp_pb2.Timestamp
    applied_by: _status_pb2.ApiResourceAuditActor
    tag: str
    is_current: bool
    message: str
    spec_snapshot: _spec_pb2.AgentSpec
    git_provenance: GitProvenance
    def __init__(self, version_hash: _Optional[str] = ..., applied_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., applied_by: _Optional[_Union[_status_pb2.ApiResourceAuditActor, _Mapping]] = ..., tag: _Optional[str] = ..., is_current: bool = ..., message: _Optional[str] = ..., spec_snapshot: _Optional[_Union[_spec_pb2.AgentSpec, _Mapping]] = ..., git_provenance: _Optional[_Union[GitProvenance, _Mapping]] = ...) -> None: ...

class GitProvenance(_message.Message):
    __slots__ = ("remote_url", "ref", "commit", "subdir")
    REMOTE_URL_FIELD_NUMBER: _ClassVar[int]
    REF_FIELD_NUMBER: _ClassVar[int]
    COMMIT_FIELD_NUMBER: _ClassVar[int]
    SUBDIR_FIELD_NUMBER: _ClassVar[int]
    remote_url: str
    ref: str
    commit: str
    subdir: str
    def __init__(self, remote_url: _Optional[str] = ..., ref: _Optional[str] = ..., commit: _Optional[str] = ..., subdir: _Optional[str] = ...) -> None: ...

class ListAgentVersionsInput(_message.Message):
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

class ListAgentVersionsResponse(_message.Message):
    __slots__ = ("versions", "next_page_token", "total_count")
    VERSIONS_FIELD_NUMBER: _ClassVar[int]
    NEXT_PAGE_TOKEN_FIELD_NUMBER: _ClassVar[int]
    TOTAL_COUNT_FIELD_NUMBER: _ClassVar[int]
    versions: _containers.RepeatedCompositeFieldContainer[AgentVersionEntry]
    next_page_token: str
    total_count: int
    def __init__(self, versions: _Optional[_Iterable[_Union[AgentVersionEntry, _Mapping]]] = ..., next_page_token: _Optional[str] = ..., total_count: _Optional[int] = ...) -> None: ...

class GetAgentVersionInput(_message.Message):
    __slots__ = ("agent_id", "version_hash")
    AGENT_ID_FIELD_NUMBER: _ClassVar[int]
    VERSION_HASH_FIELD_NUMBER: _ClassVar[int]
    agent_id: str
    version_hash: str
    def __init__(self, agent_id: _Optional[str] = ..., version_hash: _Optional[str] = ...) -> None: ...

class TagAgentVersionInput(_message.Message):
    __slots__ = ("agent_id", "version_hash", "tag")
    AGENT_ID_FIELD_NUMBER: _ClassVar[int]
    VERSION_HASH_FIELD_NUMBER: _ClassVar[int]
    TAG_FIELD_NUMBER: _ClassVar[int]
    agent_id: str
    version_hash: str
    tag: str
    def __init__(self, agent_id: _Optional[str] = ..., version_hash: _Optional[str] = ..., tag: _Optional[str] = ...) -> None: ...
