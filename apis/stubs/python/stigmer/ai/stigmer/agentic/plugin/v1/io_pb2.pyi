import datetime

from ai.stigmer.commons.apiresource.apiresourcekind import api_resource_kind_pb2 as _api_resource_kind_pb2
from ai.stigmer.commons.apiresource import enum_pb2 as _enum_pb2
from ai.stigmer.commons.apiresource import status_pb2 as _status_pb2
from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf import timestamp_pb2 as _timestamp_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class PluginId(_message.Message):
    __slots__ = ("value",)
    VALUE_FIELD_NUMBER: _ClassVar[int]
    value: str
    def __init__(self, value: _Optional[str] = ...) -> None: ...

class PushPluginRequest(_message.Message):
    __slots__ = ("org", "artifact", "artifact_upload_ref", "visibility", "message")
    ORG_FIELD_NUMBER: _ClassVar[int]
    ARTIFACT_FIELD_NUMBER: _ClassVar[int]
    ARTIFACT_UPLOAD_REF_FIELD_NUMBER: _ClassVar[int]
    VISIBILITY_FIELD_NUMBER: _ClassVar[int]
    MESSAGE_FIELD_NUMBER: _ClassVar[int]
    org: str
    artifact: bytes
    artifact_upload_ref: str
    visibility: _enum_pb2.ApiResourceVisibility
    message: str
    def __init__(self, org: _Optional[str] = ..., artifact: _Optional[bytes] = ..., artifact_upload_ref: _Optional[str] = ..., visibility: _Optional[_Union[_enum_pb2.ApiResourceVisibility, str]] = ..., message: _Optional[str] = ...) -> None: ...

class CreatePluginArtifactUploadUrlRequest(_message.Message):
    __slots__ = ("org", "size_bytes")
    ORG_FIELD_NUMBER: _ClassVar[int]
    SIZE_BYTES_FIELD_NUMBER: _ClassVar[int]
    org: str
    size_bytes: int
    def __init__(self, org: _Optional[str] = ..., size_bytes: _Optional[int] = ...) -> None: ...

class PluginArtifactUploadUrl(_message.Message):
    __slots__ = ("url", "artifact_upload_ref", "ttl_seconds")
    URL_FIELD_NUMBER: _ClassVar[int]
    ARTIFACT_UPLOAD_REF_FIELD_NUMBER: _ClassVar[int]
    TTL_SECONDS_FIELD_NUMBER: _ClassVar[int]
    url: str
    artifact_upload_ref: str
    ttl_seconds: int
    def __init__(self, url: _Optional[str] = ..., artifact_upload_ref: _Optional[str] = ..., ttl_seconds: _Optional[int] = ...) -> None: ...

class PluginMember(_message.Message):
    __slots__ = ("kind", "id", "slug", "name")
    KIND_FIELD_NUMBER: _ClassVar[int]
    ID_FIELD_NUMBER: _ClassVar[int]
    SLUG_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    kind: _api_resource_kind_pb2.ApiResourceKind
    id: str
    slug: str
    name: str
    def __init__(self, kind: _Optional[_Union[_api_resource_kind_pb2.ApiResourceKind, str]] = ..., id: _Optional[str] = ..., slug: _Optional[str] = ..., name: _Optional[str] = ...) -> None: ...

class ListPluginMembersResponse(_message.Message):
    __slots__ = ("members",)
    MEMBERS_FIELD_NUMBER: _ClassVar[int]
    members: _containers.RepeatedCompositeFieldContainer[PluginMember]
    def __init__(self, members: _Optional[_Iterable[_Union[PluginMember, _Mapping]]] = ...) -> None: ...

class ListPluginVersionsInput(_message.Message):
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

class PluginVersionEntry(_message.Message):
    __slots__ = ("digest", "pushed_at", "pushed_by", "tag", "is_current", "message", "artifact_storage_key")
    DIGEST_FIELD_NUMBER: _ClassVar[int]
    PUSHED_AT_FIELD_NUMBER: _ClassVar[int]
    PUSHED_BY_FIELD_NUMBER: _ClassVar[int]
    TAG_FIELD_NUMBER: _ClassVar[int]
    IS_CURRENT_FIELD_NUMBER: _ClassVar[int]
    MESSAGE_FIELD_NUMBER: _ClassVar[int]
    ARTIFACT_STORAGE_KEY_FIELD_NUMBER: _ClassVar[int]
    digest: str
    pushed_at: _timestamp_pb2.Timestamp
    pushed_by: _status_pb2.ApiResourceAuditActor
    tag: str
    is_current: bool
    message: str
    artifact_storage_key: str
    def __init__(self, digest: _Optional[str] = ..., pushed_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., pushed_by: _Optional[_Union[_status_pb2.ApiResourceAuditActor, _Mapping]] = ..., tag: _Optional[str] = ..., is_current: bool = ..., message: _Optional[str] = ..., artifact_storage_key: _Optional[str] = ...) -> None: ...

class ListPluginVersionsResponse(_message.Message):
    __slots__ = ("versions", "next_page_token", "total_count")
    VERSIONS_FIELD_NUMBER: _ClassVar[int]
    NEXT_PAGE_TOKEN_FIELD_NUMBER: _ClassVar[int]
    TOTAL_COUNT_FIELD_NUMBER: _ClassVar[int]
    versions: _containers.RepeatedCompositeFieldContainer[PluginVersionEntry]
    next_page_token: str
    total_count: int
    def __init__(self, versions: _Optional[_Iterable[_Union[PluginVersionEntry, _Mapping]]] = ..., next_page_token: _Optional[str] = ..., total_count: _Optional[int] = ...) -> None: ...
