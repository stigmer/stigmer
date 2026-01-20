from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf import struct_pb2 as _struct_pb2
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class RunTaskConfig(_message.Message):
    __slots__ = ("workflow", "input")
    WORKFLOW_FIELD_NUMBER: _ClassVar[int]
    INPUT_FIELD_NUMBER: _ClassVar[int]
    workflow: str
    input: _struct_pb2.Struct
    def __init__(self, workflow: _Optional[str] = ..., input: _Optional[_Union[_struct_pb2.Struct, _Mapping]] = ...) -> None: ...
