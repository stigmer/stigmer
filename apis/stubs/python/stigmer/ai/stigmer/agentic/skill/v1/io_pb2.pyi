from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from typing import ClassVar as _ClassVar, Optional as _Optional

DESCRIPTOR: _descriptor.FileDescriptor

class SkillId(_message.Message):
    __slots__ = ("value",)
    VALUE_FIELD_NUMBER: _ClassVar[int]
    value: str
    def __init__(self, value: _Optional[str] = ...) -> None: ...

class PushSkillRequest(_message.Message):
    __slots__ = ("skill_id", "artifact", "tag")
    SKILL_ID_FIELD_NUMBER: _ClassVar[int]
    ARTIFACT_FIELD_NUMBER: _ClassVar[int]
    TAG_FIELD_NUMBER: _ClassVar[int]
    skill_id: str
    artifact: bytes
    tag: str
    def __init__(self, skill_id: _Optional[str] = ..., artifact: _Optional[bytes] = ..., tag: _Optional[str] = ...) -> None: ...

class PushSkillResponse(_message.Message):
    __slots__ = ("version_hash", "artifact_storage_key", "tag")
    VERSION_HASH_FIELD_NUMBER: _ClassVar[int]
    ARTIFACT_STORAGE_KEY_FIELD_NUMBER: _ClassVar[int]
    TAG_FIELD_NUMBER: _ClassVar[int]
    version_hash: str
    artifact_storage_key: str
    tag: str
    def __init__(self, version_hash: _Optional[str] = ..., artifact_storage_key: _Optional[str] = ..., tag: _Optional[str] = ...) -> None: ...

class GetSkillByTagRequest(_message.Message):
    __slots__ = ("name", "tag")
    NAME_FIELD_NUMBER: _ClassVar[int]
    TAG_FIELD_NUMBER: _ClassVar[int]
    name: str
    tag: str
    def __init__(self, name: _Optional[str] = ..., tag: _Optional[str] = ...) -> None: ...

class GetSkillByHashRequest(_message.Message):
    __slots__ = ("name", "version_hash")
    NAME_FIELD_NUMBER: _ClassVar[int]
    VERSION_HASH_FIELD_NUMBER: _ClassVar[int]
    name: str
    version_hash: str
    def __init__(self, name: _Optional[str] = ..., version_hash: _Optional[str] = ...) -> None: ...
