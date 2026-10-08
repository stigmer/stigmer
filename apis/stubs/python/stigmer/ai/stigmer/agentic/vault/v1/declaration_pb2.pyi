from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from typing import ClassVar as _ClassVar, Optional as _Optional

DESCRIPTOR: _descriptor.FileDescriptor

class EnvVarDeclaration(_message.Message):
    __slots__ = ("is_secret", "description", "optional", "value")
    IS_SECRET_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    OPTIONAL_FIELD_NUMBER: _ClassVar[int]
    VALUE_FIELD_NUMBER: _ClassVar[int]
    is_secret: bool
    description: str
    optional: bool
    value: str
    def __init__(self, is_secret: bool = ..., description: _Optional[str] = ..., optional: bool = ..., value: _Optional[str] = ...) -> None: ...
