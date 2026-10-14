from ai.stigmer.iam.oauthapp.v1 import api_pb2 as _api_pb2
from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf import field_mask_pb2 as _field_mask_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class OAuthAppId(_message.Message):
    __slots__ = ("value",)
    VALUE_FIELD_NUMBER: _ClassVar[int]
    value: str
    def __init__(self, value: _Optional[str] = ...) -> None: ...

class OAuthApps(_message.Message):
    __slots__ = ("entries", "next_page_token")
    ENTRIES_FIELD_NUMBER: _ClassVar[int]
    NEXT_PAGE_TOKEN_FIELD_NUMBER: _ClassVar[int]
    entries: _containers.RepeatedCompositeFieldContainer[_api_pb2.OAuthApp]
    next_page_token: str
    def __init__(self, entries: _Optional[_Iterable[_Union[_api_pb2.OAuthApp, _Mapping]]] = ..., next_page_token: _Optional[str] = ...) -> None: ...

class ListOAuthAppsInput(_message.Message):
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

class UpdateOAuthAppInput(_message.Message):
    __slots__ = ("resource", "update_mask")
    RESOURCE_FIELD_NUMBER: _ClassVar[int]
    UPDATE_MASK_FIELD_NUMBER: _ClassVar[int]
    resource: _api_pb2.OAuthApp
    update_mask: _field_mask_pb2.FieldMask
    def __init__(self, resource: _Optional[_Union[_api_pb2.OAuthApp, _Mapping]] = ..., update_mask: _Optional[_Union[_field_mask_pb2.FieldMask, _Mapping]] = ...) -> None: ...
