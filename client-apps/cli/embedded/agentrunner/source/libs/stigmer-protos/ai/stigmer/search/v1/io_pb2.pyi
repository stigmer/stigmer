import datetime

from ai.stigmer.commons.apiresource.apiresourcekind import api_resource_kind_pb2 as _api_resource_kind_pb2
from ai.stigmer.commons.apiresource import enum_pb2 as _enum_pb2
from ai.stigmer.commons.rpc import pagination_pb2 as _pagination_pb2
from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf import timestamp_pb2 as _timestamp_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class SearchRequest(_message.Message):
    __slots__ = ("kinds", "query", "org", "exclude_public", "page", "cross_org_public")
    KINDS_FIELD_NUMBER: _ClassVar[int]
    QUERY_FIELD_NUMBER: _ClassVar[int]
    ORG_FIELD_NUMBER: _ClassVar[int]
    EXCLUDE_PUBLIC_FIELD_NUMBER: _ClassVar[int]
    PAGE_FIELD_NUMBER: _ClassVar[int]
    CROSS_ORG_PUBLIC_FIELD_NUMBER: _ClassVar[int]
    kinds: _containers.RepeatedScalarFieldContainer[_api_resource_kind_pb2.ApiResourceKind]
    query: str
    org: str
    exclude_public: bool
    page: _pagination_pb2.PageInfo
    cross_org_public: bool
    def __init__(self, kinds: _Optional[_Iterable[_Union[_api_resource_kind_pb2.ApiResourceKind, str]]] = ..., query: _Optional[str] = ..., org: _Optional[str] = ..., exclude_public: bool = ..., page: _Optional[_Union[_pagination_pb2.PageInfo, _Mapping]] = ..., cross_org_public: bool = ...) -> None: ...

class SearchResponse(_message.Message):
    __slots__ = ("entries", "counts_by_kind", "total_count", "total_pages")
    class CountsByKindEntry(_message.Message):
        __slots__ = ("key", "value")
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: int
        def __init__(self, key: _Optional[str] = ..., value: _Optional[int] = ...) -> None: ...
    ENTRIES_FIELD_NUMBER: _ClassVar[int]
    COUNTS_BY_KIND_FIELD_NUMBER: _ClassVar[int]
    TOTAL_COUNT_FIELD_NUMBER: _ClassVar[int]
    TOTAL_PAGES_FIELD_NUMBER: _ClassVar[int]
    entries: _containers.RepeatedCompositeFieldContainer[SearchResult]
    counts_by_kind: _containers.ScalarMap[str, int]
    total_count: int
    total_pages: int
    def __init__(self, entries: _Optional[_Iterable[_Union[SearchResult, _Mapping]]] = ..., counts_by_kind: _Optional[_Mapping[str, int]] = ..., total_count: _Optional[int] = ..., total_pages: _Optional[int] = ...) -> None: ...

class SearchResult(_message.Message):
    __slots__ = ("kind", "id", "name", "slug", "qualified_slug", "org", "description", "visibility", "tags", "created_at", "updated_at", "score", "icon_url")
    KIND_FIELD_NUMBER: _ClassVar[int]
    ID_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    SLUG_FIELD_NUMBER: _ClassVar[int]
    QUALIFIED_SLUG_FIELD_NUMBER: _ClassVar[int]
    ORG_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    VISIBILITY_FIELD_NUMBER: _ClassVar[int]
    TAGS_FIELD_NUMBER: _ClassVar[int]
    CREATED_AT_FIELD_NUMBER: _ClassVar[int]
    UPDATED_AT_FIELD_NUMBER: _ClassVar[int]
    SCORE_FIELD_NUMBER: _ClassVar[int]
    ICON_URL_FIELD_NUMBER: _ClassVar[int]
    kind: _api_resource_kind_pb2.ApiResourceKind
    id: str
    name: str
    slug: str
    qualified_slug: str
    org: str
    description: str
    visibility: _enum_pb2.ApiResourceVisibility
    tags: _containers.RepeatedScalarFieldContainer[str]
    created_at: _timestamp_pb2.Timestamp
    updated_at: _timestamp_pb2.Timestamp
    score: float
    icon_url: str
    def __init__(self, kind: _Optional[_Union[_api_resource_kind_pb2.ApiResourceKind, str]] = ..., id: _Optional[str] = ..., name: _Optional[str] = ..., slug: _Optional[str] = ..., qualified_slug: _Optional[str] = ..., org: _Optional[str] = ..., description: _Optional[str] = ..., visibility: _Optional[_Union[_enum_pb2.ApiResourceVisibility, str]] = ..., tags: _Optional[_Iterable[str]] = ..., created_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., updated_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., score: _Optional[float] = ..., icon_url: _Optional[str] = ...) -> None: ...
