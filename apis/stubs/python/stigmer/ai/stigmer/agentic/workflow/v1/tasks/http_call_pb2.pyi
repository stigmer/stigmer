from ai.stigmer.commons.apiresource import field_options_pb2 as _field_options_pb2
from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf import struct_pb2 as _struct_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class HttpCallTaskConfig(_message.Message):
    __slots__ = ("method", "endpoint", "headers", "body", "timeout_seconds")
    class HeadersEntry(_message.Message):
        __slots__ = ("key", "value")
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: str
        def __init__(self, key: _Optional[str] = ..., value: _Optional[str] = ...) -> None: ...
    METHOD_FIELD_NUMBER: _ClassVar[int]
    ENDPOINT_FIELD_NUMBER: _ClassVar[int]
    HEADERS_FIELD_NUMBER: _ClassVar[int]
    BODY_FIELD_NUMBER: _ClassVar[int]
    TIMEOUT_SECONDS_FIELD_NUMBER: _ClassVar[int]
    method: str
    endpoint: HttpEndpoint
    headers: _containers.ScalarMap[str, str]
    body: _struct_pb2.Struct
    timeout_seconds: int
    def __init__(self, method: _Optional[str] = ..., endpoint: _Optional[_Union[HttpEndpoint, _Mapping]] = ..., headers: _Optional[_Mapping[str, str]] = ..., body: _Optional[_Union[_struct_pb2.Struct, _Mapping]] = ..., timeout_seconds: _Optional[int] = ...) -> None: ...

class HttpEndpoint(_message.Message):
    __slots__ = ("uri",)
    URI_FIELD_NUMBER: _ClassVar[int]
    uri: str
    def __init__(self, uri: _Optional[str] = ...) -> None: ...
