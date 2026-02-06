from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from typing import ClassVar as _ClassVar, Optional as _Optional

DESCRIPTOR: _descriptor.FileDescriptor

class SkillSpec(_message.Message):
    __slots__ = ("skill_md", "tag", "name", "description")
    SKILL_MD_FIELD_NUMBER: _ClassVar[int]
    TAG_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    skill_md: str
    tag: str
    name: str
    description: str
    def __init__(self, skill_md: _Optional[str] = ..., tag: _Optional[str] = ..., name: _Optional[str] = ..., description: _Optional[str] = ...) -> None: ...
