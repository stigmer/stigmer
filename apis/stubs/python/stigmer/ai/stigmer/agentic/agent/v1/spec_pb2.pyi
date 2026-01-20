from ai.stigmer.agentic.environment.v1 import spec_pb2 as _spec_pb2
from ai.stigmer.commons.apiresource import io_pb2 as _io_pb2
from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class AgentSpec(_message.Message):
    __slots__ = ("description", "icon_url", "instructions", "mcp_servers", "skill_refs", "sub_agents", "env_spec")
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    ICON_URL_FIELD_NUMBER: _ClassVar[int]
    INSTRUCTIONS_FIELD_NUMBER: _ClassVar[int]
    MCP_SERVERS_FIELD_NUMBER: _ClassVar[int]
    SKILL_REFS_FIELD_NUMBER: _ClassVar[int]
    SUB_AGENTS_FIELD_NUMBER: _ClassVar[int]
    ENV_SPEC_FIELD_NUMBER: _ClassVar[int]
    description: str
    icon_url: str
    instructions: str
    mcp_servers: _containers.RepeatedCompositeFieldContainer[McpServerDefinition]
    skill_refs: _containers.RepeatedCompositeFieldContainer[_io_pb2.ApiResourceReference]
    sub_agents: _containers.RepeatedCompositeFieldContainer[SubAgent]
    env_spec: _spec_pb2.EnvironmentSpec
    def __init__(self, description: _Optional[str] = ..., icon_url: _Optional[str] = ..., instructions: _Optional[str] = ..., mcp_servers: _Optional[_Iterable[_Union[McpServerDefinition, _Mapping]]] = ..., skill_refs: _Optional[_Iterable[_Union[_io_pb2.ApiResourceReference, _Mapping]]] = ..., sub_agents: _Optional[_Iterable[_Union[SubAgent, _Mapping]]] = ..., env_spec: _Optional[_Union[_spec_pb2.EnvironmentSpec, _Mapping]] = ...) -> None: ...

class SubAgent(_message.Message):
    __slots__ = ("inline_spec", "agent_instance_refs")
    INLINE_SPEC_FIELD_NUMBER: _ClassVar[int]
    AGENT_INSTANCE_REFS_FIELD_NUMBER: _ClassVar[int]
    inline_spec: InlineSubAgentSpec
    agent_instance_refs: _io_pb2.ApiResourceReference
    def __init__(self, inline_spec: _Optional[_Union[InlineSubAgentSpec, _Mapping]] = ..., agent_instance_refs: _Optional[_Union[_io_pb2.ApiResourceReference, _Mapping]] = ...) -> None: ...

class InlineSubAgentSpec(_message.Message):
    __slots__ = ("name", "description", "instructions", "mcp_servers", "mcp_tool_selections", "skill_refs")
    class McpToolSelectionsEntry(_message.Message):
        __slots__ = ("key", "value")
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: McpToolSelection
        def __init__(self, key: _Optional[str] = ..., value: _Optional[_Union[McpToolSelection, _Mapping]] = ...) -> None: ...
    NAME_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    INSTRUCTIONS_FIELD_NUMBER: _ClassVar[int]
    MCP_SERVERS_FIELD_NUMBER: _ClassVar[int]
    MCP_TOOL_SELECTIONS_FIELD_NUMBER: _ClassVar[int]
    SKILL_REFS_FIELD_NUMBER: _ClassVar[int]
    name: str
    description: str
    instructions: str
    mcp_servers: _containers.RepeatedScalarFieldContainer[str]
    mcp_tool_selections: _containers.MessageMap[str, McpToolSelection]
    skill_refs: _containers.RepeatedCompositeFieldContainer[_io_pb2.ApiResourceReference]
    def __init__(self, name: _Optional[str] = ..., description: _Optional[str] = ..., instructions: _Optional[str] = ..., mcp_servers: _Optional[_Iterable[str]] = ..., mcp_tool_selections: _Optional[_Mapping[str, McpToolSelection]] = ..., skill_refs: _Optional[_Iterable[_Union[_io_pb2.ApiResourceReference, _Mapping]]] = ...) -> None: ...

class McpToolSelection(_message.Message):
    __slots__ = ("enabled_tools",)
    ENABLED_TOOLS_FIELD_NUMBER: _ClassVar[int]
    enabled_tools: _containers.RepeatedScalarFieldContainer[str]
    def __init__(self, enabled_tools: _Optional[_Iterable[str]] = ...) -> None: ...

class McpServerDefinition(_message.Message):
    __slots__ = ("name", "stdio", "http", "docker", "enabled_tools")
    NAME_FIELD_NUMBER: _ClassVar[int]
    STDIO_FIELD_NUMBER: _ClassVar[int]
    HTTP_FIELD_NUMBER: _ClassVar[int]
    DOCKER_FIELD_NUMBER: _ClassVar[int]
    ENABLED_TOOLS_FIELD_NUMBER: _ClassVar[int]
    name: str
    stdio: StdioServer
    http: HttpServer
    docker: DockerServer
    enabled_tools: _containers.RepeatedScalarFieldContainer[str]
    def __init__(self, name: _Optional[str] = ..., stdio: _Optional[_Union[StdioServer, _Mapping]] = ..., http: _Optional[_Union[HttpServer, _Mapping]] = ..., docker: _Optional[_Union[DockerServer, _Mapping]] = ..., enabled_tools: _Optional[_Iterable[str]] = ...) -> None: ...

class StdioServer(_message.Message):
    __slots__ = ("command", "args", "env_placeholders", "working_dir")
    class EnvPlaceholdersEntry(_message.Message):
        __slots__ = ("key", "value")
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: str
        def __init__(self, key: _Optional[str] = ..., value: _Optional[str] = ...) -> None: ...
    COMMAND_FIELD_NUMBER: _ClassVar[int]
    ARGS_FIELD_NUMBER: _ClassVar[int]
    ENV_PLACEHOLDERS_FIELD_NUMBER: _ClassVar[int]
    WORKING_DIR_FIELD_NUMBER: _ClassVar[int]
    command: str
    args: _containers.RepeatedScalarFieldContainer[str]
    env_placeholders: _containers.ScalarMap[str, str]
    working_dir: str
    def __init__(self, command: _Optional[str] = ..., args: _Optional[_Iterable[str]] = ..., env_placeholders: _Optional[_Mapping[str, str]] = ..., working_dir: _Optional[str] = ...) -> None: ...

class HttpServer(_message.Message):
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

class DockerServer(_message.Message):
    __slots__ = ("image", "args", "env_placeholders", "volumes", "network", "ports", "container_name")
    class EnvPlaceholdersEntry(_message.Message):
        __slots__ = ("key", "value")
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: str
        def __init__(self, key: _Optional[str] = ..., value: _Optional[str] = ...) -> None: ...
    IMAGE_FIELD_NUMBER: _ClassVar[int]
    ARGS_FIELD_NUMBER: _ClassVar[int]
    ENV_PLACEHOLDERS_FIELD_NUMBER: _ClassVar[int]
    VOLUMES_FIELD_NUMBER: _ClassVar[int]
    NETWORK_FIELD_NUMBER: _ClassVar[int]
    PORTS_FIELD_NUMBER: _ClassVar[int]
    CONTAINER_NAME_FIELD_NUMBER: _ClassVar[int]
    image: str
    args: _containers.RepeatedScalarFieldContainer[str]
    env_placeholders: _containers.ScalarMap[str, str]
    volumes: _containers.RepeatedCompositeFieldContainer[VolumeMount]
    network: str
    ports: _containers.RepeatedCompositeFieldContainer[PortMapping]
    container_name: str
    def __init__(self, image: _Optional[str] = ..., args: _Optional[_Iterable[str]] = ..., env_placeholders: _Optional[_Mapping[str, str]] = ..., volumes: _Optional[_Iterable[_Union[VolumeMount, _Mapping]]] = ..., network: _Optional[str] = ..., ports: _Optional[_Iterable[_Union[PortMapping, _Mapping]]] = ..., container_name: _Optional[str] = ...) -> None: ...

class VolumeMount(_message.Message):
    __slots__ = ("host_path", "container_path", "read_only")
    HOST_PATH_FIELD_NUMBER: _ClassVar[int]
    CONTAINER_PATH_FIELD_NUMBER: _ClassVar[int]
    READ_ONLY_FIELD_NUMBER: _ClassVar[int]
    host_path: str
    container_path: str
    read_only: bool
    def __init__(self, host_path: _Optional[str] = ..., container_path: _Optional[str] = ..., read_only: bool = ...) -> None: ...

class PortMapping(_message.Message):
    __slots__ = ("host_port", "container_port", "protocol")
    HOST_PORT_FIELD_NUMBER: _ClassVar[int]
    CONTAINER_PORT_FIELD_NUMBER: _ClassVar[int]
    PROTOCOL_FIELD_NUMBER: _ClassVar[int]
    host_port: int
    container_port: int
    protocol: str
    def __init__(self, host_port: _Optional[int] = ..., container_port: _Optional[int] = ..., protocol: _Optional[str] = ...) -> None: ...
