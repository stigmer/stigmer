from ai.stigmer.agentic.environment.v1 import spec_pb2 as _spec_pb2
from ai.stigmer.commons.apiresource import enum_pb2 as _enum_pb2
from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf import struct_pb2 as _struct_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class WorkflowSpec(_message.Message):
    __slots__ = ("description", "document", "tasks", "env_spec")
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    DOCUMENT_FIELD_NUMBER: _ClassVar[int]
    TASKS_FIELD_NUMBER: _ClassVar[int]
    ENV_SPEC_FIELD_NUMBER: _ClassVar[int]
    description: str
    document: WorkflowDocument
    tasks: _containers.RepeatedCompositeFieldContainer[WorkflowTask]
    env_spec: _spec_pb2.EnvironmentSpec
    def __init__(self, description: _Optional[str] = ..., document: _Optional[_Union[WorkflowDocument, _Mapping]] = ..., tasks: _Optional[_Iterable[_Union[WorkflowTask, _Mapping]]] = ..., env_spec: _Optional[_Union[_spec_pb2.EnvironmentSpec, _Mapping]] = ...) -> None: ...

class WorkflowDocument(_message.Message):
    __slots__ = ("dsl", "namespace", "name", "version", "description")
    DSL_FIELD_NUMBER: _ClassVar[int]
    NAMESPACE_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    VERSION_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    dsl: str
    namespace: str
    name: str
    version: str
    description: str
    def __init__(self, dsl: _Optional[str] = ..., namespace: _Optional[str] = ..., name: _Optional[str] = ..., version: _Optional[str] = ..., description: _Optional[str] = ...) -> None: ...

class WorkflowTask(_message.Message):
    __slots__ = ("name", "kind", "task_config", "export", "flow")
    NAME_FIELD_NUMBER: _ClassVar[int]
    KIND_FIELD_NUMBER: _ClassVar[int]
    TASK_CONFIG_FIELD_NUMBER: _ClassVar[int]
    EXPORT_FIELD_NUMBER: _ClassVar[int]
    FLOW_FIELD_NUMBER: _ClassVar[int]
    name: str
    kind: _enum_pb2.WorkflowTaskKind
    task_config: _struct_pb2.Struct
    export: Export
    flow: FlowControl
    def __init__(self, name: _Optional[str] = ..., kind: _Optional[_Union[_enum_pb2.WorkflowTaskKind, str]] = ..., task_config: _Optional[_Union[_struct_pb2.Struct, _Mapping]] = ..., export: _Optional[_Union[Export, _Mapping]] = ..., flow: _Optional[_Union[FlowControl, _Mapping]] = ...) -> None: ...

class Export(_message.Message):
    __slots__ = ()
    AS_FIELD_NUMBER: _ClassVar[int]
    def __init__(self, **kwargs) -> None: ...

class FlowControl(_message.Message):
    __slots__ = ("then",)
    THEN_FIELD_NUMBER: _ClassVar[int]
    then: str
    def __init__(self, then: _Optional[str] = ...) -> None: ...
