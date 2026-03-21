from ai.stigmer.agentic.skill.v1 import status_pb2 as _status_pb2
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
    __slots__ = ("org", "artifact", "tag", "git_provenance")
    ORG_FIELD_NUMBER: _ClassVar[int]
    ARTIFACT_FIELD_NUMBER: _ClassVar[int]
    TAG_FIELD_NUMBER: _ClassVar[int]
    GIT_PROVENANCE_FIELD_NUMBER: _ClassVar[int]
    org: str
    artifact: bytes
    tag: str
    git_provenance: _status_pb2.GitProvenance
    def __init__(self, org: _Optional[str] = ..., artifact: _Optional[bytes] = ..., tag: _Optional[str] = ..., git_provenance: _Optional[_Union[_status_pb2.GitProvenance, _Mapping]] = ...) -> None: ...

class PushSkillFromExecutionArtifactRequest(_message.Message):
    __slots__ = ("org", "execution_id", "storage_key", "tag")
    ORG_FIELD_NUMBER: _ClassVar[int]
    EXECUTION_ID_FIELD_NUMBER: _ClassVar[int]
    STORAGE_KEY_FIELD_NUMBER: _ClassVar[int]
    TAG_FIELD_NUMBER: _ClassVar[int]
    org: str
    execution_id: str
    storage_key: str
    tag: str
    def __init__(self, org: _Optional[str] = ..., execution_id: _Optional[str] = ..., storage_key: _Optional[str] = ..., tag: _Optional[str] = ...) -> None: ...

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
