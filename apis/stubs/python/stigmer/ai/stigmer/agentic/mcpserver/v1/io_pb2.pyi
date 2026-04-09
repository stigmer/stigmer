from ai.stigmer.agentic.executioncontext.v1 import spec_pb2 as _spec_pb2
from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class McpServerId(_message.Message):
    __slots__ = ("value",)
    VALUE_FIELD_NUMBER: _ClassVar[int]
    value: str
    def __init__(self, value: _Optional[str] = ...) -> None: ...

class ConnectInput(_message.Message):
    __slots__ = ("mcp_server_id", "runtime_env")
    class RuntimeEnvEntry(_message.Message):
        __slots__ = ("key", "value")
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: _spec_pb2.ExecutionValue
        def __init__(self, key: _Optional[str] = ..., value: _Optional[_Union[_spec_pb2.ExecutionValue, _Mapping]] = ...) -> None: ...
    MCP_SERVER_ID_FIELD_NUMBER: _ClassVar[int]
    RUNTIME_ENV_FIELD_NUMBER: _ClassVar[int]
    mcp_server_id: str
    runtime_env: _containers.MessageMap[str, _spec_pb2.ExecutionValue]
    def __init__(self, mcp_server_id: _Optional[str] = ..., runtime_env: _Optional[_Mapping[str, _spec_pb2.ExecutionValue]] = ...) -> None: ...
