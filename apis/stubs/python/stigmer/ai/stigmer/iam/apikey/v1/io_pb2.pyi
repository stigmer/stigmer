import datetime

from ai.stigmer.iam.apikey.v1 import api_pb2 as _api_pb2
from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf import field_mask_pb2 as _field_mask_pb2
from google.protobuf import timestamp_pb2 as _timestamp_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class ApiKeys(_message.Message):
    __slots__ = ("entries", "next_page_token")
    ENTRIES_FIELD_NUMBER: _ClassVar[int]
    NEXT_PAGE_TOKEN_FIELD_NUMBER: _ClassVar[int]
    entries: _containers.RepeatedCompositeFieldContainer[_api_pb2.ApiKey]
    next_page_token: str
    def __init__(self, entries: _Optional[_Iterable[_Union[_api_pb2.ApiKey, _Mapping]]] = ..., next_page_token: _Optional[str] = ...) -> None: ...

class ApiKeyId(_message.Message):
    __slots__ = ("value",)
    VALUE_FIELD_NUMBER: _ClassVar[int]
    value: str
    def __init__(self, value: _Optional[str] = ...) -> None: ...

class ApiKeyHash(_message.Message):
    __slots__ = ("value",)
    VALUE_FIELD_NUMBER: _ClassVar[int]
    value: str
    def __init__(self, value: _Optional[str] = ...) -> None: ...

class ListApiKeysInput(_message.Message):
    __slots__ = ("page_size", "page_token")
    PAGE_SIZE_FIELD_NUMBER: _ClassVar[int]
    PAGE_TOKEN_FIELD_NUMBER: _ClassVar[int]
    page_size: int
    page_token: str
    def __init__(self, page_size: _Optional[int] = ..., page_token: _Optional[str] = ...) -> None: ...

class ListApiKeysByAccountInput(_message.Message):
    __slots__ = ("account_id", "page_size", "page_token")
    ACCOUNT_ID_FIELD_NUMBER: _ClassVar[int]
    PAGE_SIZE_FIELD_NUMBER: _ClassVar[int]
    PAGE_TOKEN_FIELD_NUMBER: _ClassVar[int]
    account_id: str
    page_size: int
    page_token: str
    def __init__(self, account_id: _Optional[str] = ..., page_size: _Optional[int] = ..., page_token: _Optional[str] = ...) -> None: ...

class CreateServiceAccountKeyInput(_message.Message):
    __slots__ = ("service_account_id", "name", "expires_at", "never_expires")
    SERVICE_ACCOUNT_ID_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    EXPIRES_AT_FIELD_NUMBER: _ClassVar[int]
    NEVER_EXPIRES_FIELD_NUMBER: _ClassVar[int]
    service_account_id: str
    name: str
    expires_at: _timestamp_pb2.Timestamp
    never_expires: bool
    def __init__(self, service_account_id: _Optional[str] = ..., name: _Optional[str] = ..., expires_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., never_expires: bool = ...) -> None: ...

class UpdateApiKeyInput(_message.Message):
    __slots__ = ("resource", "update_mask")
    RESOURCE_FIELD_NUMBER: _ClassVar[int]
    UPDATE_MASK_FIELD_NUMBER: _ClassVar[int]
    resource: _api_pb2.ApiKey
    update_mask: _field_mask_pb2.FieldMask
    def __init__(self, resource: _Optional[_Union[_api_pb2.ApiKey, _Mapping]] = ..., update_mask: _Optional[_Union[_field_mask_pb2.FieldMask, _Mapping]] = ...) -> None: ...
