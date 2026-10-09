from ai.stigmer.commons.rpc import method_options_pb2 as _method_options_pb2
from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class FetchExecutionValuesInput(_message.Message):
    __slots__ = ("execution_id",)
    EXECUTION_ID_FIELD_NUMBER: _ClassVar[int]
    execution_id: str
    def __init__(self, execution_id: _Optional[str] = ...) -> None: ...

class ExecutionValues(_message.Message):
    __slots__ = ("agent", "tools", "repositories")
    class AgentEntry(_message.Message):
        __slots__ = ("key", "value")
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: DeliveredValue
        def __init__(self, key: _Optional[str] = ..., value: _Optional[_Union[DeliveredValue, _Mapping]] = ...) -> None: ...
    AGENT_FIELD_NUMBER: _ClassVar[int]
    TOOLS_FIELD_NUMBER: _ClassVar[int]
    REPOSITORIES_FIELD_NUMBER: _ClassVar[int]
    agent: _containers.MessageMap[str, DeliveredValue]
    tools: _containers.RepeatedCompositeFieldContainer[ToolValues]
    repositories: _containers.RepeatedCompositeFieldContainer[RepositoryValues]
    def __init__(self, agent: _Optional[_Mapping[str, DeliveredValue]] = ..., tools: _Optional[_Iterable[_Union[ToolValues, _Mapping]]] = ..., repositories: _Optional[_Iterable[_Union[RepositoryValues, _Mapping]]] = ...) -> None: ...

class DeliveredValue(_message.Message):
    __slots__ = ("value", "is_secret")
    VALUE_FIELD_NUMBER: _ClassVar[int]
    IS_SECRET_FIELD_NUMBER: _ClassVar[int]
    value: str
    is_secret: bool
    def __init__(self, value: _Optional[str] = ..., is_secret: bool = ...) -> None: ...

class ToolValues(_message.Message):
    __slots__ = ("mcp_server_id", "url", "values")
    class ValuesEntry(_message.Message):
        __slots__ = ("key", "value")
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: DeliveredValue
        def __init__(self, key: _Optional[str] = ..., value: _Optional[_Union[DeliveredValue, _Mapping]] = ...) -> None: ...
    MCP_SERVER_ID_FIELD_NUMBER: _ClassVar[int]
    URL_FIELD_NUMBER: _ClassVar[int]
    VALUES_FIELD_NUMBER: _ClassVar[int]
    mcp_server_id: str
    url: str
    values: _containers.MessageMap[str, DeliveredValue]
    def __init__(self, mcp_server_id: _Optional[str] = ..., url: _Optional[str] = ..., values: _Optional[_Mapping[str, DeliveredValue]] = ...) -> None: ...

class RepositoryValues(_message.Message):
    __slots__ = ("name", "url", "token")
    NAME_FIELD_NUMBER: _ClassVar[int]
    URL_FIELD_NUMBER: _ClassVar[int]
    TOKEN_FIELD_NUMBER: _ClassVar[int]
    name: str
    url: str
    token: str
    def __init__(self, name: _Optional[str] = ..., url: _Optional[str] = ..., token: _Optional[str] = ...) -> None: ...
