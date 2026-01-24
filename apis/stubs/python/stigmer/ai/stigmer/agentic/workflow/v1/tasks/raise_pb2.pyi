from ai.stigmer.commons.apiresource import field_options_pb2 as _field_options_pb2
from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from typing import ClassVar as _ClassVar, Optional as _Optional

DESCRIPTOR: _descriptor.FileDescriptor

class RaiseTaskConfig(_message.Message):
    __slots__ = ("error", "message")
    ERROR_FIELD_NUMBER: _ClassVar[int]
    MESSAGE_FIELD_NUMBER: _ClassVar[int]
    error: str
    message: str
    def __init__(self, error: _Optional[str] = ..., message: _Optional[str] = ...) -> None: ...
