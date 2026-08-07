from ai.stigmer.agentic.agentexecution.v1 import invocation_pb2 as _invocation_pb2
from ai.stigmer.agentic.session.v1 import enum_pb2 as _enum_pb2
from ai.stigmer.agentic.session.v1 import workspace_pb2 as _workspace_pb2
from ai.stigmer.agentic.workflow.v1.tasks import common_pb2 as _common_pb2
from ai.stigmer.commons.apiresource import field_options_pb2 as _field_options_pb2
from ai.stigmer.commons.apiresource import io_pb2 as _io_pb2
from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf import struct_pb2 as _struct_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class AgentCallTaskConfig(_message.Message):
    __slots__ = ("agent", "message", "env", "run_config", "output", "harness", "workspace_entries", "environment_refs")
    class EnvEntry(_message.Message):
        __slots__ = ("key", "value")
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: str
        def __init__(self, key: _Optional[str] = ..., value: _Optional[str] = ...) -> None: ...
    AGENT_FIELD_NUMBER: _ClassVar[int]
    MESSAGE_FIELD_NUMBER: _ClassVar[int]
    ENV_FIELD_NUMBER: _ClassVar[int]
    RUN_CONFIG_FIELD_NUMBER: _ClassVar[int]
    OUTPUT_FIELD_NUMBER: _ClassVar[int]
    HARNESS_FIELD_NUMBER: _ClassVar[int]
    WORKSPACE_ENTRIES_FIELD_NUMBER: _ClassVar[int]
    ENVIRONMENT_REFS_FIELD_NUMBER: _ClassVar[int]
    agent: str
    message: str
    env: _containers.ScalarMap[str, str]
    run_config: _invocation_pb2.RunConfig
    output: AgentCallOutputContract
    harness: _enum_pb2.Harness
    workspace_entries: _containers.RepeatedCompositeFieldContainer[_workspace_pb2.WorkspaceEntry]
    environment_refs: _containers.RepeatedCompositeFieldContainer[_io_pb2.ApiResourceReference]
    def __init__(self, agent: _Optional[str] = ..., message: _Optional[str] = ..., env: _Optional[_Mapping[str, str]] = ..., run_config: _Optional[_Union[_invocation_pb2.RunConfig, _Mapping]] = ..., output: _Optional[_Union[AgentCallOutputContract, _Mapping]] = ..., harness: _Optional[_Union[_enum_pb2.Harness, str]] = ..., workspace_entries: _Optional[_Iterable[_Union[_workspace_pb2.WorkspaceEntry, _Mapping]]] = ..., environment_refs: _Optional[_Iterable[_Union[_io_pb2.ApiResourceReference, _Mapping]]] = ...) -> None: ...

class AgentCallOutputContract(_message.Message):
    __slots__ = ("schema", "on_invalid", "max_retries", "fallback_task")
    SCHEMA_FIELD_NUMBER: _ClassVar[int]
    ON_INVALID_FIELD_NUMBER: _ClassVar[int]
    MAX_RETRIES_FIELD_NUMBER: _ClassVar[int]
    FALLBACK_TASK_FIELD_NUMBER: _ClassVar[int]
    schema: _struct_pb2.Struct
    on_invalid: _common_pb2.OnInvalidOutputPolicy
    max_retries: int
    fallback_task: str
    def __init__(self, schema: _Optional[_Union[_struct_pb2.Struct, _Mapping]] = ..., on_invalid: _Optional[_Union[_common_pb2.OnInvalidOutputPolicy, str]] = ..., max_retries: _Optional[int] = ..., fallback_task: _Optional[str] = ...) -> None: ...
