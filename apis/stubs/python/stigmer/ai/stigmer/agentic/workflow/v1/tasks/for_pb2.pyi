from ai.stigmer.agentic.workflow.v1 import spec_pb2 as _spec_pb2
from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class ForTaskConfig(_message.Message):
    __slots__ = ("each", "do")
    EACH_FIELD_NUMBER: _ClassVar[int]
    IN_FIELD_NUMBER: _ClassVar[int]
    DO_FIELD_NUMBER: _ClassVar[int]
    each: str
    do: _containers.RepeatedCompositeFieldContainer[_spec_pb2.WorkflowTask]
    def __init__(self, each: _Optional[str] = ..., do: _Optional[_Iterable[_Union[_spec_pb2.WorkflowTask, _Mapping]]] = ..., **kwargs) -> None: ...
