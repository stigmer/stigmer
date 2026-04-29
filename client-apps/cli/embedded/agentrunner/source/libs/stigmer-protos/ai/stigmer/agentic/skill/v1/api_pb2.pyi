from ai.stigmer.agentic.skill.v1 import spec_pb2 as _spec_pb2
from ai.stigmer.agentic.skill.v1 import status_pb2 as _status_pb2
from ai.stigmer.commons.apiresource import metadata_pb2 as _metadata_pb2
from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class Skill(_message.Message):
    __slots__ = ("api_version", "kind", "metadata", "spec", "status")
    API_VERSION_FIELD_NUMBER: _ClassVar[int]
    KIND_FIELD_NUMBER: _ClassVar[int]
    METADATA_FIELD_NUMBER: _ClassVar[int]
    SPEC_FIELD_NUMBER: _ClassVar[int]
    STATUS_FIELD_NUMBER: _ClassVar[int]
    api_version: str
    kind: str
    metadata: _metadata_pb2.ApiResourceMetadata
    spec: _spec_pb2.SkillSpec
    status: _status_pb2.SkillStatus
    def __init__(self, api_version: _Optional[str] = ..., kind: _Optional[str] = ..., metadata: _Optional[_Union[_metadata_pb2.ApiResourceMetadata, _Mapping]] = ..., spec: _Optional[_Union[_spec_pb2.SkillSpec, _Mapping]] = ..., status: _Optional[_Union[_status_pb2.SkillStatus, _Mapping]] = ...) -> None: ...

class SkillList(_message.Message):
    __slots__ = ("api_version", "kind", "items")
    API_VERSION_FIELD_NUMBER: _ClassVar[int]
    KIND_FIELD_NUMBER: _ClassVar[int]
    ITEMS_FIELD_NUMBER: _ClassVar[int]
    api_version: str
    kind: str
    items: _containers.RepeatedCompositeFieldContainer[Skill]
    def __init__(self, api_version: _Optional[str] = ..., kind: _Optional[str] = ..., items: _Optional[_Iterable[_Union[Skill, _Mapping]]] = ...) -> None: ...
