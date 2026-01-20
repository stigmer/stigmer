from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf import struct_pb2 as _struct_pb2
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class GrpcCallTaskConfig(_message.Message):
    __slots__ = ("service", "method", "request")
    SERVICE_FIELD_NUMBER: _ClassVar[int]
    METHOD_FIELD_NUMBER: _ClassVar[int]
    REQUEST_FIELD_NUMBER: _ClassVar[int]
    service: str
    method: str
    request: _struct_pb2.Struct
    def __init__(self, service: _Optional[str] = ..., method: _Optional[str] = ..., request: _Optional[_Union[_struct_pb2.Struct, _Mapping]] = ...) -> None: ...
