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
    __slots__ = ("description", "icon_url", "instructions", "mcp_server_usages", "skill_refs", "sub_agents", "env_spec")
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    ICON_URL_FIELD_NUMBER: _ClassVar[int]
    INSTRUCTIONS_FIELD_NUMBER: _ClassVar[int]
    MCP_SERVER_USAGES_FIELD_NUMBER: _ClassVar[int]
    SKILL_REFS_FIELD_NUMBER: _ClassVar[int]
    SUB_AGENTS_FIELD_NUMBER: _ClassVar[int]
    ENV_SPEC_FIELD_NUMBER: _ClassVar[int]
    description: str
    icon_url: str
    instructions: str
    mcp_server_usages: _containers.RepeatedCompositeFieldContainer[McpServerUsage]
    skill_refs: _containers.RepeatedCompositeFieldContainer[_io_pb2.ApiResourceReference]
    sub_agents: _containers.RepeatedCompositeFieldContainer[SubAgent]
    env_spec: _spec_pb2.EnvironmentSpec
    def __init__(self, description: _Optional[str] = ..., icon_url: _Optional[str] = ..., instructions: _Optional[str] = ..., mcp_server_usages: _Optional[_Iterable[_Union[McpServerUsage, _Mapping]]] = ..., skill_refs: _Optional[_Iterable[_Union[_io_pb2.ApiResourceReference, _Mapping]]] = ..., sub_agents: _Optional[_Iterable[_Union[SubAgent, _Mapping]]] = ..., env_spec: _Optional[_Union[_spec_pb2.EnvironmentSpec, _Mapping]] = ...) -> None: ...

class SubAgent(_message.Message):
    __slots__ = ("name", "description", "instructions", "mcp_access", "skill_refs")
    NAME_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    INSTRUCTIONS_FIELD_NUMBER: _ClassVar[int]
    MCP_ACCESS_FIELD_NUMBER: _ClassVar[int]
    SKILL_REFS_FIELD_NUMBER: _ClassVar[int]
    name: str
    description: str
    instructions: str
    mcp_access: _containers.RepeatedCompositeFieldContainer[McpAccess]
    skill_refs: _containers.RepeatedCompositeFieldContainer[_io_pb2.ApiResourceReference]
    def __init__(self, name: _Optional[str] = ..., description: _Optional[str] = ..., instructions: _Optional[str] = ..., mcp_access: _Optional[_Iterable[_Union[McpAccess, _Mapping]]] = ..., skill_refs: _Optional[_Iterable[_Union[_io_pb2.ApiResourceReference, _Mapping]]] = ...) -> None: ...

class McpServerUsage(_message.Message):
    __slots__ = ("mcp_server_ref", "enabled_tools")
    MCP_SERVER_REF_FIELD_NUMBER: _ClassVar[int]
    ENABLED_TOOLS_FIELD_NUMBER: _ClassVar[int]
    mcp_server_ref: _io_pb2.ApiResourceReference
    enabled_tools: _containers.RepeatedScalarFieldContainer[str]
    def __init__(self, mcp_server_ref: _Optional[_Union[_io_pb2.ApiResourceReference, _Mapping]] = ..., enabled_tools: _Optional[_Iterable[str]] = ...) -> None: ...

class McpAccess(_message.Message):
    __slots__ = ("mcp_server", "enabled_tools")
    MCP_SERVER_FIELD_NUMBER: _ClassVar[int]
    ENABLED_TOOLS_FIELD_NUMBER: _ClassVar[int]
    mcp_server: str
    enabled_tools: _containers.RepeatedScalarFieldContainer[str]
    def __init__(self, mcp_server: _Optional[str] = ..., enabled_tools: _Optional[_Iterable[str]] = ...) -> None: ...
