from ai.stigmer.agentic.executioncontext.v1 import spec_pb2 as _spec_pb2
from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class AgentExecutionSpec(_message.Message):
    __slots__ = ("session_id", "agent_id", "message", "execution_config", "runtime_env")
    class RuntimeEnvEntry(_message.Message):
        __slots__ = ("key", "value")
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: _spec_pb2.ExecutionValue
        def __init__(self, key: _Optional[str] = ..., value: _Optional[_Union[_spec_pb2.ExecutionValue, _Mapping]] = ...) -> None: ...
    SESSION_ID_FIELD_NUMBER: _ClassVar[int]
    AGENT_ID_FIELD_NUMBER: _ClassVar[int]
    MESSAGE_FIELD_NUMBER: _ClassVar[int]
    EXECUTION_CONFIG_FIELD_NUMBER: _ClassVar[int]
    RUNTIME_ENV_FIELD_NUMBER: _ClassVar[int]
    session_id: str
    agent_id: str
    message: str
    execution_config: ExecutionConfig
    runtime_env: _containers.MessageMap[str, _spec_pb2.ExecutionValue]
    def __init__(self, session_id: _Optional[str] = ..., agent_id: _Optional[str] = ..., message: _Optional[str] = ..., execution_config: _Optional[_Union[ExecutionConfig, _Mapping]] = ..., runtime_env: _Optional[_Mapping[str, _spec_pb2.ExecutionValue]] = ...) -> None: ...

class ExecutionConfig(_message.Message):
    __slots__ = ("model_name",)
    MODEL_NAME_FIELD_NUMBER: _ClassVar[int]
    model_name: str
    def __init__(self, model_name: _Optional[str] = ...) -> None: ...
