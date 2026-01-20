from ai.stigmer.commons.apiresource.apiresourcekind import api_resource_kind_pb2 as _api_resource_kind_pb2
from ai.stigmer.commons.apiresource import enum_pb2 as _enum_pb2
from ai.stigmer.commons.rpc import pagination_pb2 as _pagination_pb2
from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class ApiResourceId(_message.Message):
    __slots__ = ("value",)
    VALUE_FIELD_NUMBER: _ClassVar[int]
    value: str
    def __init__(self, value: _Optional[str] = ...) -> None: ...

class ApiResourceDeleteInput(_message.Message):
    __slots__ = ("resource_id", "version_message", "force")
    RESOURCE_ID_FIELD_NUMBER: _ClassVar[int]
    VERSION_MESSAGE_FIELD_NUMBER: _ClassVar[int]
    FORCE_FIELD_NUMBER: _ClassVar[int]
    resource_id: str
    version_message: str
    force: bool
    def __init__(self, resource_id: _Optional[str] = ..., version_message: _Optional[str] = ..., force: bool = ...) -> None: ...

class ApiResourceByOrgBySlugRequest(_message.Message):
    __slots__ = ("org", "slug")
    ORG_FIELD_NUMBER: _ClassVar[int]
    SLUG_FIELD_NUMBER: _ClassVar[int]
    org: str
    slug: str
    def __init__(self, org: _Optional[str] = ..., slug: _Optional[str] = ...) -> None: ...

class FindApiResourcesRequest(_message.Message):
    __slots__ = ("org", "kind", "page", "page_number", "page_size")
    ORG_FIELD_NUMBER: _ClassVar[int]
    KIND_FIELD_NUMBER: _ClassVar[int]
    PAGE_FIELD_NUMBER: _ClassVar[int]
    PAGE_NUMBER_FIELD_NUMBER: _ClassVar[int]
    PAGE_SIZE_FIELD_NUMBER: _ClassVar[int]
    org: str
    kind: str
    page: _pagination_pb2.PageInfo
    page_number: int
    page_size: int
    def __init__(self, org: _Optional[str] = ..., kind: _Optional[str] = ..., page: _Optional[_Union[_pagination_pb2.PageInfo, _Mapping]] = ..., page_number: _Optional[int] = ..., page_size: _Optional[int] = ...) -> None: ...

class ApiResourceReference(_message.Message):
    __slots__ = ("scope", "org", "kind", "slug")
    SCOPE_FIELD_NUMBER: _ClassVar[int]
    ORG_FIELD_NUMBER: _ClassVar[int]
    KIND_FIELD_NUMBER: _ClassVar[int]
    SLUG_FIELD_NUMBER: _ClassVar[int]
    scope: _enum_pb2.ApiResourceOwnerScope
    org: str
    kind: _api_resource_kind_pb2.ApiResourceKind
    slug: str
    def __init__(self, scope: _Optional[_Union[_enum_pb2.ApiResourceOwnerScope, str]] = ..., org: _Optional[str] = ..., kind: _Optional[_Union[_api_resource_kind_pb2.ApiResourceKind, str]] = ..., slug: _Optional[str] = ...) -> None: ...
