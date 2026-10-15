import datetime

from ai.stigmer.agentic.eval.v1 import api_pb2 as _api_pb2
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

class EvalId(_message.Message):
    __slots__ = ("value",)
    VALUE_FIELD_NUMBER: _ClassVar[int]
    value: str
    def __init__(self, value: _Optional[str] = ...) -> None: ...

class PushEvalRequest(_message.Message):
    __slots__ = ("org", "slug", "name", "artifact", "artifact_upload_ref", "visibility", "message", "tag")
    ORG_FIELD_NUMBER: _ClassVar[int]
    SLUG_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    ARTIFACT_FIELD_NUMBER: _ClassVar[int]
    ARTIFACT_UPLOAD_REF_FIELD_NUMBER: _ClassVar[int]
    VISIBILITY_FIELD_NUMBER: _ClassVar[int]
    MESSAGE_FIELD_NUMBER: _ClassVar[int]
    TAG_FIELD_NUMBER: _ClassVar[int]
    org: str
    slug: str
    name: str
    artifact: bytes
    artifact_upload_ref: str
    visibility: _enum_pb2.ApiResourceVisibility
    message: str
    tag: str
    def __init__(self, org: _Optional[str] = ..., slug: _Optional[str] = ..., name: _Optional[str] = ..., artifact: _Optional[bytes] = ..., artifact_upload_ref: _Optional[str] = ..., visibility: _Optional[_Union[_enum_pb2.ApiResourceVisibility, str]] = ..., message: _Optional[str] = ..., tag: _Optional[str] = ...) -> None: ...

class CreateEvalArtifactUploadUrlRequest(_message.Message):
    __slots__ = ("org", "slug", "size_bytes")
    ORG_FIELD_NUMBER: _ClassVar[int]
    SLUG_FIELD_NUMBER: _ClassVar[int]
    SIZE_BYTES_FIELD_NUMBER: _ClassVar[int]
    org: str
    slug: str
    size_bytes: int
    def __init__(self, org: _Optional[str] = ..., slug: _Optional[str] = ..., size_bytes: _Optional[int] = ...) -> None: ...

class EvalArtifactUploadUrl(_message.Message):
    __slots__ = ("url", "artifact_upload_ref", "ttl_seconds")
    URL_FIELD_NUMBER: _ClassVar[int]
    ARTIFACT_UPLOAD_REF_FIELD_NUMBER: _ClassVar[int]
    TTL_SECONDS_FIELD_NUMBER: _ClassVar[int]
    url: str
    artifact_upload_ref: str
    ttl_seconds: int
    def __init__(self, url: _Optional[str] = ..., artifact_upload_ref: _Optional[str] = ..., ttl_seconds: _Optional[int] = ...) -> None: ...

class EvalArchive(_message.Message):
    __slots__ = ("artifact", "digest")
    ARTIFACT_FIELD_NUMBER: _ClassVar[int]
    DIGEST_FIELD_NUMBER: _ClassVar[int]
    artifact: bytes
    digest: str
    def __init__(self, artifact: _Optional[bytes] = ..., digest: _Optional[str] = ...) -> None: ...

class EvalArchiveDownloadUrl(_message.Message):
    __slots__ = ("url", "ttl_seconds", "size_bytes", "digest")
    URL_FIELD_NUMBER: _ClassVar[int]
    TTL_SECONDS_FIELD_NUMBER: _ClassVar[int]
    SIZE_BYTES_FIELD_NUMBER: _ClassVar[int]
    DIGEST_FIELD_NUMBER: _ClassVar[int]
    url: str
    ttl_seconds: int
    size_bytes: int
    digest: str
    def __init__(self, url: _Optional[str] = ..., ttl_seconds: _Optional[int] = ..., size_bytes: _Optional[int] = ..., digest: _Optional[str] = ...) -> None: ...

class ListEvalVersionsInput(_message.Message):
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

class EvalVersionEntry(_message.Message):
    __slots__ = ("digest", "pushed_at", "pushed_by", "tag", "is_current", "message")
    DIGEST_FIELD_NUMBER: _ClassVar[int]
    PUSHED_AT_FIELD_NUMBER: _ClassVar[int]
    PUSHED_BY_FIELD_NUMBER: _ClassVar[int]
    TAG_FIELD_NUMBER: _ClassVar[int]
    IS_CURRENT_FIELD_NUMBER: _ClassVar[int]
    MESSAGE_FIELD_NUMBER: _ClassVar[int]
    digest: str
    pushed_at: _timestamp_pb2.Timestamp
    pushed_by: _status_pb2.ApiResourceAuditActor
    tag: str
    is_current: bool
    message: str
    def __init__(self, digest: _Optional[str] = ..., pushed_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., pushed_by: _Optional[_Union[_status_pb2.ApiResourceAuditActor, _Mapping]] = ..., tag: _Optional[str] = ..., is_current: bool = ..., message: _Optional[str] = ...) -> None: ...

class ListEvalVersionsResponse(_message.Message):
    __slots__ = ("entries", "next_page_token")
    ENTRIES_FIELD_NUMBER: _ClassVar[int]
    NEXT_PAGE_TOKEN_FIELD_NUMBER: _ClassVar[int]
    entries: _containers.RepeatedCompositeFieldContainer[EvalVersionEntry]
    next_page_token: str
    def __init__(self, entries: _Optional[_Iterable[_Union[EvalVersionEntry, _Mapping]]] = ..., next_page_token: _Optional[str] = ...) -> None: ...

class ListEvalsRequest(_message.Message):
    __slots__ = ("org", "page_size", "page_token", "labels")
    class LabelsEntry(_message.Message):
        __slots__ = ("key", "value")
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: str
        def __init__(self, key: _Optional[str] = ..., value: _Optional[str] = ...) -> None: ...
    ORG_FIELD_NUMBER: _ClassVar[int]
    PAGE_SIZE_FIELD_NUMBER: _ClassVar[int]
    PAGE_TOKEN_FIELD_NUMBER: _ClassVar[int]
    LABELS_FIELD_NUMBER: _ClassVar[int]
    org: str
    page_size: int
    page_token: str
    labels: _containers.ScalarMap[str, str]
    def __init__(self, org: _Optional[str] = ..., page_size: _Optional[int] = ..., page_token: _Optional[str] = ..., labels: _Optional[_Mapping[str, str]] = ...) -> None: ...

class EvalList(_message.Message):
    __slots__ = ("entries", "next_page_token")
    ENTRIES_FIELD_NUMBER: _ClassVar[int]
    NEXT_PAGE_TOKEN_FIELD_NUMBER: _ClassVar[int]
    entries: _containers.RepeatedCompositeFieldContainer[_api_pb2.Eval]
    next_page_token: str
    def __init__(self, entries: _Optional[_Iterable[_Union[_api_pb2.Eval, _Mapping]]] = ..., next_page_token: _Optional[str] = ...) -> None: ...
