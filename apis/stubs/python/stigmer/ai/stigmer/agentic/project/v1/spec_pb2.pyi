from ai.stigmer.agentic.project.v1 import enum_pb2 as _enum_pb2
from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class ProjectSpec(_message.Message):
    __slots__ = ("runtime", "entry_point", "description")
    RUNTIME_FIELD_NUMBER: _ClassVar[int]
    ENTRY_POINT_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    runtime: _enum_pb2.ProjectRuntime
    entry_point: str
    description: str
    def __init__(self, runtime: _Optional[_Union[_enum_pb2.ProjectRuntime, str]] = ..., entry_point: _Optional[str] = ..., description: _Optional[str] = ...) -> None: ...
