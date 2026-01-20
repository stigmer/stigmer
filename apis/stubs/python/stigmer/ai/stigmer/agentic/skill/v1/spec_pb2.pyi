from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from typing import ClassVar as _ClassVar, Optional as _Optional

DESCRIPTOR: _descriptor.FileDescriptor

class SkillSpec(_message.Message):
    __slots__ = ("description", "markdown_content")
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    MARKDOWN_CONTENT_FIELD_NUMBER: _ClassVar[int]
    description: str
    markdown_content: str
    def __init__(self, description: _Optional[str] = ..., markdown_content: _Optional[str] = ...) -> None: ...
