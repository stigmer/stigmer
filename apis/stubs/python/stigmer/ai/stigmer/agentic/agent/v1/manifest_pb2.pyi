from ai.stigmer.commons.sdk import metadata_pb2 as _metadata_pb2
from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class AgentManifest(_message.Message):
    __slots__ = ("sdk_metadata", "agents")
    SDK_METADATA_FIELD_NUMBER: _ClassVar[int]
    AGENTS_FIELD_NUMBER: _ClassVar[int]
    sdk_metadata: _metadata_pb2.SdkMetadata
    agents: _containers.RepeatedCompositeFieldContainer[AgentBlueprint]
    def __init__(self, sdk_metadata: _Optional[_Union[_metadata_pb2.SdkMetadata, _Mapping]] = ..., agents: _Optional[_Iterable[_Union[AgentBlueprint, _Mapping]]] = ...) -> None: ...

class AgentBlueprint(_message.Message):
    __slots__ = ("name", "instructions", "description", "icon_url", "skills", "mcp_servers", "sub_agents", "environment_variables")
    NAME_FIELD_NUMBER: _ClassVar[int]
    INSTRUCTIONS_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    ICON_URL_FIELD_NUMBER: _ClassVar[int]
    SKILLS_FIELD_NUMBER: _ClassVar[int]
    MCP_SERVERS_FIELD_NUMBER: _ClassVar[int]
    SUB_AGENTS_FIELD_NUMBER: _ClassVar[int]
    ENVIRONMENT_VARIABLES_FIELD_NUMBER: _ClassVar[int]
    name: str
    instructions: str
    description: str
    icon_url: str
    skills: _containers.RepeatedCompositeFieldContainer[ManifestSkill]
    mcp_servers: _containers.RepeatedCompositeFieldContainer[ManifestMcpServer]
    sub_agents: _containers.RepeatedCompositeFieldContainer[ManifestSubAgent]
    environment_variables: _containers.RepeatedCompositeFieldContainer[ManifestEnvironmentVariable]
    def __init__(self, name: _Optional[str] = ..., instructions: _Optional[str] = ..., description: _Optional[str] = ..., icon_url: _Optional[str] = ..., skills: _Optional[_Iterable[_Union[ManifestSkill, _Mapping]]] = ..., mcp_servers: _Optional[_Iterable[_Union[ManifestMcpServer, _Mapping]]] = ..., sub_agents: _Optional[_Iterable[_Union[ManifestSubAgent, _Mapping]]] = ..., environment_variables: _Optional[_Iterable[_Union[ManifestEnvironmentVariable, _Mapping]]] = ...) -> None: ...

class ManifestSkill(_message.Message):
    __slots__ = ("id", "platform", "org", "inline")
    ID_FIELD_NUMBER: _ClassVar[int]
    PLATFORM_FIELD_NUMBER: _ClassVar[int]
    ORG_FIELD_NUMBER: _ClassVar[int]
    INLINE_FIELD_NUMBER: _ClassVar[int]
    id: str
    platform: PlatformSkillReference
    org: OrgSkillReference
    inline: InlineSkillDefinition
    def __init__(self, id: _Optional[str] = ..., platform: _Optional[_Union[PlatformSkillReference, _Mapping]] = ..., org: _Optional[_Union[OrgSkillReference, _Mapping]] = ..., inline: _Optional[_Union[InlineSkillDefinition, _Mapping]] = ...) -> None: ...

class PlatformSkillReference(_message.Message):
    __slots__ = ("name",)
    NAME_FIELD_NUMBER: _ClassVar[int]
    name: str
    def __init__(self, name: _Optional[str] = ...) -> None: ...

class OrgSkillReference(_message.Message):
    __slots__ = ("name", "org")
    NAME_FIELD_NUMBER: _ClassVar[int]
    ORG_FIELD_NUMBER: _ClassVar[int]
    name: str
    org: str
    def __init__(self, name: _Optional[str] = ..., org: _Optional[str] = ...) -> None: ...

class InlineSkillDefinition(_message.Message):
    __slots__ = ("name", "description", "markdown_content")
    NAME_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    MARKDOWN_CONTENT_FIELD_NUMBER: _ClassVar[int]
    name: str
    description: str
    markdown_content: str
    def __init__(self, name: _Optional[str] = ..., description: _Optional[str] = ..., markdown_content: _Optional[str] = ...) -> None: ...

class ManifestMcpServer(_message.Message):
    __slots__ = ("name", "enabled_tools", "stdio", "http", "docker")
    NAME_FIELD_NUMBER: _ClassVar[int]
    ENABLED_TOOLS_FIELD_NUMBER: _ClassVar[int]
    STDIO_FIELD_NUMBER: _ClassVar[int]
    HTTP_FIELD_NUMBER: _ClassVar[int]
    DOCKER_FIELD_NUMBER: _ClassVar[int]
    name: str
    enabled_tools: _containers.RepeatedScalarFieldContainer[str]
    stdio: ManifestStdioServer
    http: ManifestHttpServer
    docker: ManifestDockerServer
    def __init__(self, name: _Optional[str] = ..., enabled_tools: _Optional[_Iterable[str]] = ..., stdio: _Optional[_Union[ManifestStdioServer, _Mapping]] = ..., http: _Optional[_Union[ManifestHttpServer, _Mapping]] = ..., docker: _Optional[_Union[ManifestDockerServer, _Mapping]] = ...) -> None: ...

class ManifestStdioServer(_message.Message):
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

class ManifestHttpServer(_message.Message):
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

class ManifestDockerServer(_message.Message):
    __slots__ = ("image", "args", "env_placeholders", "volumes", "ports", "network", "container_name")
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
    PORTS_FIELD_NUMBER: _ClassVar[int]
    NETWORK_FIELD_NUMBER: _ClassVar[int]
    CONTAINER_NAME_FIELD_NUMBER: _ClassVar[int]
    image: str
    args: _containers.RepeatedScalarFieldContainer[str]
    env_placeholders: _containers.ScalarMap[str, str]
    volumes: _containers.RepeatedCompositeFieldContainer[ManifestVolumeMount]
    ports: _containers.RepeatedCompositeFieldContainer[ManifestPortMapping]
    network: str
    container_name: str
    def __init__(self, image: _Optional[str] = ..., args: _Optional[_Iterable[str]] = ..., env_placeholders: _Optional[_Mapping[str, str]] = ..., volumes: _Optional[_Iterable[_Union[ManifestVolumeMount, _Mapping]]] = ..., ports: _Optional[_Iterable[_Union[ManifestPortMapping, _Mapping]]] = ..., network: _Optional[str] = ..., container_name: _Optional[str] = ...) -> None: ...

class ManifestVolumeMount(_message.Message):
    __slots__ = ("host_path", "container_path", "read_only")
    HOST_PATH_FIELD_NUMBER: _ClassVar[int]
    CONTAINER_PATH_FIELD_NUMBER: _ClassVar[int]
    READ_ONLY_FIELD_NUMBER: _ClassVar[int]
    host_path: str
    container_path: str
    read_only: bool
    def __init__(self, host_path: _Optional[str] = ..., container_path: _Optional[str] = ..., read_only: bool = ...) -> None: ...

class ManifestPortMapping(_message.Message):
    __slots__ = ("host_port", "container_port", "protocol")
    HOST_PORT_FIELD_NUMBER: _ClassVar[int]
    CONTAINER_PORT_FIELD_NUMBER: _ClassVar[int]
    PROTOCOL_FIELD_NUMBER: _ClassVar[int]
    host_port: int
    container_port: int
    protocol: str
    def __init__(self, host_port: _Optional[int] = ..., container_port: _Optional[int] = ..., protocol: _Optional[str] = ...) -> None: ...

class ManifestSubAgent(_message.Message):
    __slots__ = ("inline", "reference")
    INLINE_FIELD_NUMBER: _ClassVar[int]
    REFERENCE_FIELD_NUMBER: _ClassVar[int]
    inline: InlineSubAgentDefinition
    reference: ReferencedSubAgent
    def __init__(self, inline: _Optional[_Union[InlineSubAgentDefinition, _Mapping]] = ..., reference: _Optional[_Union[ReferencedSubAgent, _Mapping]] = ...) -> None: ...

class InlineSubAgentDefinition(_message.Message):
    __slots__ = ("name", "instructions", "description", "mcp_server_names", "tool_selections", "skills")
    NAME_FIELD_NUMBER: _ClassVar[int]
    INSTRUCTIONS_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    MCP_SERVER_NAMES_FIELD_NUMBER: _ClassVar[int]
    TOOL_SELECTIONS_FIELD_NUMBER: _ClassVar[int]
    SKILLS_FIELD_NUMBER: _ClassVar[int]
    name: str
    instructions: str
    description: str
    mcp_server_names: _containers.RepeatedScalarFieldContainer[str]
    tool_selections: _containers.RepeatedCompositeFieldContainer[ManifestToolSelection]
    skills: _containers.RepeatedCompositeFieldContainer[ManifestSkill]
    def __init__(self, name: _Optional[str] = ..., instructions: _Optional[str] = ..., description: _Optional[str] = ..., mcp_server_names: _Optional[_Iterable[str]] = ..., tool_selections: _Optional[_Iterable[_Union[ManifestToolSelection, _Mapping]]] = ..., skills: _Optional[_Iterable[_Union[ManifestSkill, _Mapping]]] = ...) -> None: ...

class ReferencedSubAgent(_message.Message):
    __slots__ = ("agent_instance_id",)
    AGENT_INSTANCE_ID_FIELD_NUMBER: _ClassVar[int]
    agent_instance_id: str
    def __init__(self, agent_instance_id: _Optional[str] = ...) -> None: ...

class ManifestToolSelection(_message.Message):
    __slots__ = ("mcp_server_name", "tools")
    MCP_SERVER_NAME_FIELD_NUMBER: _ClassVar[int]
    TOOLS_FIELD_NUMBER: _ClassVar[int]
    mcp_server_name: str
    tools: _containers.RepeatedScalarFieldContainer[str]
    def __init__(self, mcp_server_name: _Optional[str] = ..., tools: _Optional[_Iterable[str]] = ...) -> None: ...

class ManifestEnvironmentVariable(_message.Message):
    __slots__ = ("name", "description", "is_secret", "default_value", "required")
    NAME_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    IS_SECRET_FIELD_NUMBER: _ClassVar[int]
    DEFAULT_VALUE_FIELD_NUMBER: _ClassVar[int]
    REQUIRED_FIELD_NUMBER: _ClassVar[int]
    name: str
    description: str
    is_secret: bool
    default_value: str
    required: bool
    def __init__(self, name: _Optional[str] = ..., description: _Optional[str] = ..., is_secret: bool = ..., default_value: _Optional[str] = ..., required: bool = ...) -> None: ...
