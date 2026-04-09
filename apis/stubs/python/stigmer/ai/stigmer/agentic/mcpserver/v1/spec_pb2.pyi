import datetime

from ai.stigmer.agentic.environment.v1 import spec_pb2 as _spec_pb2
from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf import timestamp_pb2 as _timestamp_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class McpServerSpec(_message.Message):
    __slots__ = ("description", "icon_url", "tags", "stdio", "http", "default_enabled_tools", "env_spec", "source", "pinned_tool_approvals")
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    ICON_URL_FIELD_NUMBER: _ClassVar[int]
    TAGS_FIELD_NUMBER: _ClassVar[int]
    STDIO_FIELD_NUMBER: _ClassVar[int]
    HTTP_FIELD_NUMBER: _ClassVar[int]
    DEFAULT_ENABLED_TOOLS_FIELD_NUMBER: _ClassVar[int]
    ENV_SPEC_FIELD_NUMBER: _ClassVar[int]
    SOURCE_FIELD_NUMBER: _ClassVar[int]
    PINNED_TOOL_APPROVALS_FIELD_NUMBER: _ClassVar[int]
    description: str
    icon_url: str
    tags: _containers.RepeatedScalarFieldContainer[str]
    stdio: StdioServerConfig
    http: HttpServerConfig
    default_enabled_tools: _containers.RepeatedScalarFieldContainer[str]
    env_spec: _spec_pb2.EnvironmentSpec
    source: McpServerSource
    pinned_tool_approvals: _containers.RepeatedCompositeFieldContainer[ToolApprovalPolicy]
    def __init__(self, description: _Optional[str] = ..., icon_url: _Optional[str] = ..., tags: _Optional[_Iterable[str]] = ..., stdio: _Optional[_Union[StdioServerConfig, _Mapping]] = ..., http: _Optional[_Union[HttpServerConfig, _Mapping]] = ..., default_enabled_tools: _Optional[_Iterable[str]] = ..., env_spec: _Optional[_Union[_spec_pb2.EnvironmentSpec, _Mapping]] = ..., source: _Optional[_Union[McpServerSource, _Mapping]] = ..., pinned_tool_approvals: _Optional[_Iterable[_Union[ToolApprovalPolicy, _Mapping]]] = ...) -> None: ...

class StdioServerConfig(_message.Message):
    __slots__ = ("command", "args", "working_dir")
    COMMAND_FIELD_NUMBER: _ClassVar[int]
    ARGS_FIELD_NUMBER: _ClassVar[int]
    WORKING_DIR_FIELD_NUMBER: _ClassVar[int]
    command: str
    args: _containers.RepeatedScalarFieldContainer[str]
    working_dir: str
    def __init__(self, command: _Optional[str] = ..., args: _Optional[_Iterable[str]] = ..., working_dir: _Optional[str] = ...) -> None: ...

class HttpServerConfig(_message.Message):
    __slots__ = ("url", "headers", "query_params", "timeout_seconds")
    class HeadersEntry(_message.Message):
        __slots__ = ("key", "value")
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: str
        def __init__(self, key: _Optional[str] = ..., value: _Optional[str] = ...) -> None: ...
    class QueryParamsEntry(_message.Message):
        __slots__ = ("key", "value")
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: str
        def __init__(self, key: _Optional[str] = ..., value: _Optional[str] = ...) -> None: ...
    URL_FIELD_NUMBER: _ClassVar[int]
    HEADERS_FIELD_NUMBER: _ClassVar[int]
    QUERY_PARAMS_FIELD_NUMBER: _ClassVar[int]
    TIMEOUT_SECONDS_FIELD_NUMBER: _ClassVar[int]
    url: str
    headers: _containers.ScalarMap[str, str]
    query_params: _containers.ScalarMap[str, str]
    timeout_seconds: int
    def __init__(self, url: _Optional[str] = ..., headers: _Optional[_Mapping[str, str]] = ..., query_params: _Optional[_Mapping[str, str]] = ..., timeout_seconds: _Optional[int] = ...) -> None: ...

class ToolApprovalPolicy(_message.Message):
    __slots__ = ("tool_name", "message")
    TOOL_NAME_FIELD_NUMBER: _ClassVar[int]
    MESSAGE_FIELD_NUMBER: _ClassVar[int]
    tool_name: str
    message: str
    def __init__(self, tool_name: _Optional[str] = ..., message: _Optional[str] = ...) -> None: ...

class McpServerSource(_message.Message):
    __slots__ = ("registry", "registry_name", "version", "repository_url", "last_synced_at", "github_stars")
    REGISTRY_FIELD_NUMBER: _ClassVar[int]
    REGISTRY_NAME_FIELD_NUMBER: _ClassVar[int]
    VERSION_FIELD_NUMBER: _ClassVar[int]
    REPOSITORY_URL_FIELD_NUMBER: _ClassVar[int]
    LAST_SYNCED_AT_FIELD_NUMBER: _ClassVar[int]
    GITHUB_STARS_FIELD_NUMBER: _ClassVar[int]
    registry: str
    registry_name: str
    version: str
    repository_url: str
    last_synced_at: _timestamp_pb2.Timestamp
    github_stars: int
    def __init__(self, registry: _Optional[str] = ..., registry_name: _Optional[str] = ..., version: _Optional[str] = ..., repository_url: _Optional[str] = ..., last_synced_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., github_stars: _Optional[int] = ...) -> None: ...
