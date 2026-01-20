from ai.stigmer.agentic.workflow.v1 import spec_pb2 as _spec_pb2
from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class ForkTaskConfig(_message.Message):
    __slots__ = ("branches", "compete")
    BRANCHES_FIELD_NUMBER: _ClassVar[int]
    COMPETE_FIELD_NUMBER: _ClassVar[int]
    branches: _containers.RepeatedCompositeFieldContainer[ForkBranch]
    compete: bool
    def __init__(self, branches: _Optional[_Iterable[_Union[ForkBranch, _Mapping]]] = ..., compete: bool = ...) -> None: ...

class ForkBranch(_message.Message):
    __slots__ = ("name", "do")
    NAME_FIELD_NUMBER: _ClassVar[int]
    DO_FIELD_NUMBER: _ClassVar[int]
    name: str
    do: _containers.RepeatedCompositeFieldContainer[_spec_pb2.WorkflowTask]
    def __init__(self, name: _Optional[str] = ..., do: _Optional[_Iterable[_Union[_spec_pb2.WorkflowTask, _Mapping]]] = ...) -> None: ...
