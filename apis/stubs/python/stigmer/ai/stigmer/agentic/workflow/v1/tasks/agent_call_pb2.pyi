from ai.stigmer.commons.apiresource import enum_pb2 as _enum_pb2
from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class AgentCallTaskConfig(_message.Message):
    __slots__ = ("agent", "scope", "message", "env", "config")
    class EnvEntry(_message.Message):
        __slots__ = ("key", "value")
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: str
        def __init__(self, key: _Optional[str] = ..., value: _Optional[str] = ...) -> None: ...
    AGENT_FIELD_NUMBER: _ClassVar[int]
    SCOPE_FIELD_NUMBER: _ClassVar[int]
    MESSAGE_FIELD_NUMBER: _ClassVar[int]
    ENV_FIELD_NUMBER: _ClassVar[int]
    CONFIG_FIELD_NUMBER: _ClassVar[int]
    agent: str
    scope: _enum_pb2.ApiResourceOwnerScope
    message: str
    env: _containers.ScalarMap[str, str]
    config: AgentExecutionConfig
    def __init__(self, agent: _Optional[str] = ..., scope: _Optional[_Union[_enum_pb2.ApiResourceOwnerScope, str]] = ..., message: _Optional[str] = ..., env: _Optional[_Mapping[str, str]] = ..., config: _Optional[_Union[AgentExecutionConfig, _Mapping]] = ...) -> None: ...

class AgentExecutionConfig(_message.Message):
    __slots__ = ("model", "timeout", "temperature")
    MODEL_FIELD_NUMBER: _ClassVar[int]
    TIMEOUT_FIELD_NUMBER: _ClassVar[int]
    TEMPERATURE_FIELD_NUMBER: _ClassVar[int]
    model: str
    timeout: int
    temperature: float
    def __init__(self, model: _Optional[str] = ..., timeout: _Optional[int] = ..., temperature: _Optional[float] = ...) -> None: ...
