from ai.stigmer.commons.apiresource import io_pb2 as _io_pb2
from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class WorkflowInstanceSpec(_message.Message):
    __slots__ = ("workflow_id", "description", "env_refs")
    WORKFLOW_ID_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    ENV_REFS_FIELD_NUMBER: _ClassVar[int]
    workflow_id: str
    description: str
    env_refs: _containers.RepeatedCompositeFieldContainer[_io_pb2.ApiResourceReference]
    def __init__(self, workflow_id: _Optional[str] = ..., description: _Optional[str] = ..., env_refs: _Optional[_Iterable[_Union[_io_pb2.ApiResourceReference, _Mapping]]] = ...) -> None: ...
