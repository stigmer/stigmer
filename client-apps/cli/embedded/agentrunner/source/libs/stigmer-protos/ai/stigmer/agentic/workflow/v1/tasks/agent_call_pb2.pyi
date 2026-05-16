from ai.stigmer.agentic.agentexecution.v1 import spec_pb2 as _spec_pb2
from ai.stigmer.agentic.session.v1 import enum_pb2 as _enum_pb2
from ai.stigmer.agentic.workflow.v1.tasks import common_pb2 as _common_pb2
from ai.stigmer.commons.apiresource import field_options_pb2 as _field_options_pb2
from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf import struct_pb2 as _struct_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class AgentCallTaskConfig(_message.Message):
    __slots__ = ("agent", "org", "message", "env", "config", "output", "harness")
    class EnvEntry(_message.Message):
        __slots__ = ("key", "value")
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: str
        def __init__(self, key: _Optional[str] = ..., value: _Optional[str] = ...) -> None: ...
    AGENT_FIELD_NUMBER: _ClassVar[int]
    ORG_FIELD_NUMBER: _ClassVar[int]
    MESSAGE_FIELD_NUMBER: _ClassVar[int]
    ENV_FIELD_NUMBER: _ClassVar[int]
    CONFIG_FIELD_NUMBER: _ClassVar[int]
    OUTPUT_FIELD_NUMBER: _ClassVar[int]
    HARNESS_FIELD_NUMBER: _ClassVar[int]
    agent: str
    org: str
    message: str
    env: _containers.ScalarMap[str, str]
    config: AgentExecutionConfig
    output: AgentCallOutputContract
    harness: _enum_pb2.Harness
    def __init__(self, agent: _Optional[str] = ..., org: _Optional[str] = ..., message: _Optional[str] = ..., env: _Optional[_Mapping[str, str]] = ..., config: _Optional[_Union[AgentExecutionConfig, _Mapping]] = ..., output: _Optional[_Union[AgentCallOutputContract, _Mapping]] = ..., harness: _Optional[_Union[_enum_pb2.Harness, str]] = ...) -> None: ...

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

class AgentExecutionConfig(_message.Message):
    __slots__ = ("model", "timeout", "temperature", "context_management", "max_cost_micros")
    MODEL_FIELD_NUMBER: _ClassVar[int]
    TIMEOUT_FIELD_NUMBER: _ClassVar[int]
    TEMPERATURE_FIELD_NUMBER: _ClassVar[int]
    CONTEXT_MANAGEMENT_FIELD_NUMBER: _ClassVar[int]
    MAX_COST_MICROS_FIELD_NUMBER: _ClassVar[int]
    model: str
    timeout: int
    temperature: float
    context_management: _spec_pb2.ContextManagementConfig
    max_cost_micros: int
    def __init__(self, model: _Optional[str] = ..., timeout: _Optional[int] = ..., temperature: _Optional[float] = ..., context_management: _Optional[_Union[_spec_pb2.ContextManagementConfig, _Mapping]] = ..., max_cost_micros: _Optional[int] = ...) -> None: ...
