from ai.stigmer.commons.apiresource import io_pb2 as _io_pb2
from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class AgentInstanceSpec(_message.Message):
    __slots__ = ("agent_id", "description", "environment_refs")
    AGENT_ID_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    ENVIRONMENT_REFS_FIELD_NUMBER: _ClassVar[int]
    agent_id: str
    description: str
    environment_refs: _containers.RepeatedCompositeFieldContainer[_io_pb2.ApiResourceReference]
    def __init__(self, agent_id: _Optional[str] = ..., description: _Optional[str] = ..., environment_refs: _Optional[_Iterable[_Union[_io_pb2.ApiResourceReference, _Mapping]]] = ...) -> None: ...
