from ai.stigmer.agentic.skill.v1 import spec_pb2 as _spec_pb2
from ai.stigmer.commons.apiresource import enum_pb2 as _enum_pb2
from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class SkillId(_message.Message):
    __slots__ = ("value",)
    VALUE_FIELD_NUMBER: _ClassVar[int]
    value: str
    def __init__(self, value: _Optional[str] = ...) -> None: ...

class PushSkillRequest(_message.Message):
    __slots__ = ("scope", "org", "artifact", "tag", "source")
    SCOPE_FIELD_NUMBER: _ClassVar[int]
    ORG_FIELD_NUMBER: _ClassVar[int]
    ARTIFACT_FIELD_NUMBER: _ClassVar[int]
    TAG_FIELD_NUMBER: _ClassVar[int]
    SOURCE_FIELD_NUMBER: _ClassVar[int]
    scope: _enum_pb2.ApiResourceOwnerScope
    org: str
    artifact: bytes
    tag: str
    source: _spec_pb2.SkillSource
    def __init__(self, scope: _Optional[_Union[_enum_pb2.ApiResourceOwnerScope, str]] = ..., org: _Optional[str] = ..., artifact: _Optional[bytes] = ..., tag: _Optional[str] = ..., source: _Optional[_Union[_spec_pb2.SkillSource, _Mapping]] = ...) -> None: ...

class GetArtifactRequest(_message.Message):
    __slots__ = ("artifact_storage_key",)
    ARTIFACT_STORAGE_KEY_FIELD_NUMBER: _ClassVar[int]
    artifact_storage_key: str
    def __init__(self, artifact_storage_key: _Optional[str] = ...) -> None: ...

class GetArtifactResponse(_message.Message):
    __slots__ = ("artifact",)
    ARTIFACT_FIELD_NUMBER: _ClassVar[int]
    artifact: bytes
    def __init__(self, artifact: _Optional[bytes] = ...) -> None: ...
