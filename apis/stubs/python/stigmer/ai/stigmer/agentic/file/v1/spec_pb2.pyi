from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from typing import ClassVar as _ClassVar, Optional as _Optional

DESCRIPTOR: _descriptor.FileDescriptor

class FileSpec(_message.Message):
    __slots__ = ("filename", "mime_type")
    FILENAME_FIELD_NUMBER: _ClassVar[int]
    MIME_TYPE_FIELD_NUMBER: _ClassVar[int]
    filename: str
    mime_type: str
    def __init__(self, filename: _Optional[str] = ..., mime_type: _Optional[str] = ...) -> None: ...
