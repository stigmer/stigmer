from ai.stigmer.agentic.workflow.v1 import spec_pb2 as _spec_pb2
from ai.stigmer.commons.apiresource import field_options_pb2 as _field_options_pb2
from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class ForEachErrorPolicy(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    FOR_EACH_ERROR_POLICY_UNSPECIFIED: _ClassVar[ForEachErrorPolicy]
    FOR_EACH_FAIL_FAST: _ClassVar[ForEachErrorPolicy]
    FOR_EACH_CONTINUE: _ClassVar[ForEachErrorPolicy]
    FOR_EACH_SKIP: _ClassVar[ForEachErrorPolicy]
FOR_EACH_ERROR_POLICY_UNSPECIFIED: ForEachErrorPolicy
FOR_EACH_FAIL_FAST: ForEachErrorPolicy
FOR_EACH_CONTINUE: ForEachErrorPolicy
FOR_EACH_SKIP: ForEachErrorPolicy

class ForTaskConfig(_message.Message):
    __slots__ = ("each", "do", "max_parallelism", "batch_size", "on_error")
    EACH_FIELD_NUMBER: _ClassVar[int]
    IN_FIELD_NUMBER: _ClassVar[int]
    DO_FIELD_NUMBER: _ClassVar[int]
    MAX_PARALLELISM_FIELD_NUMBER: _ClassVar[int]
    BATCH_SIZE_FIELD_NUMBER: _ClassVar[int]
    ON_ERROR_FIELD_NUMBER: _ClassVar[int]
    each: str
    do: _containers.RepeatedCompositeFieldContainer[_spec_pb2.WorkflowTask]
    max_parallelism: int
    batch_size: int
    on_error: ForEachErrorPolicy
    def __init__(self, each: _Optional[str] = ..., do: _Optional[_Iterable[_Union[_spec_pb2.WorkflowTask, _Mapping]]] = ..., max_parallelism: _Optional[int] = ..., batch_size: _Optional[int] = ..., on_error: _Optional[_Union[ForEachErrorPolicy, str]] = ..., **kwargs) -> None: ...
