from ai.stigmer.commons.apiresource import status_pb2 as _status_pb2
from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class SkillState(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    SKILL_STATE_UNSPECIFIED: _ClassVar[SkillState]
    SKILL_STATE_UPLOADING: _ClassVar[SkillState]
    SKILL_STATE_READY: _ClassVar[SkillState]
    SKILL_STATE_FAILED: _ClassVar[SkillState]
SKILL_STATE_UNSPECIFIED: SkillState
SKILL_STATE_UPLOADING: SkillState
SKILL_STATE_READY: SkillState
SKILL_STATE_FAILED: SkillState

class SkillStatus(_message.Message):
    __slots__ = ("audit", "version_hash", "artifact_storage_key", "state")
    AUDIT_FIELD_NUMBER: _ClassVar[int]
    VERSION_HASH_FIELD_NUMBER: _ClassVar[int]
    ARTIFACT_STORAGE_KEY_FIELD_NUMBER: _ClassVar[int]
    STATE_FIELD_NUMBER: _ClassVar[int]
    audit: _status_pb2.ApiResourceAudit
    version_hash: str
    artifact_storage_key: str
    state: SkillState
    def __init__(self, audit: _Optional[_Union[_status_pb2.ApiResourceAudit, _Mapping]] = ..., version_hash: _Optional[str] = ..., artifact_storage_key: _Optional[str] = ..., state: _Optional[_Union[SkillState, str]] = ...) -> None: ...
