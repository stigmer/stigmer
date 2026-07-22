from ai.stigmer.agentic.environment.v1 import spec_pb2 as _spec_pb2
from ai.stigmer.commons.apiresource import field_options_pb2 as _field_options_pb2
from ai.stigmer.commons.apiresource import io_pb2 as _io_pb2
from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class AgentSpec(_message.Message):
    __slots__ = ("description", "icon_url", "instructions", "mcp_server_usages", "skill_refs", "sub_agents", "env", "datastore_usages")
    class EnvEntry(_message.Message):
        __slots__ = ("key", "value")
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: _spec_pb2.EnvVarDeclaration
        def __init__(self, key: _Optional[str] = ..., value: _Optional[_Union[_spec_pb2.EnvVarDeclaration, _Mapping]] = ...) -> None: ...
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    ICON_URL_FIELD_NUMBER: _ClassVar[int]
    INSTRUCTIONS_FIELD_NUMBER: _ClassVar[int]
    MCP_SERVER_USAGES_FIELD_NUMBER: _ClassVar[int]
    SKILL_REFS_FIELD_NUMBER: _ClassVar[int]
    SUB_AGENTS_FIELD_NUMBER: _ClassVar[int]
    ENV_FIELD_NUMBER: _ClassVar[int]
    DATASTORE_USAGES_FIELD_NUMBER: _ClassVar[int]
    description: str
    icon_url: str
    instructions: str
    mcp_server_usages: _containers.RepeatedCompositeFieldContainer[McpServerUsage]
    skill_refs: _containers.RepeatedCompositeFieldContainer[_io_pb2.ApiResourceReference]
    sub_agents: _containers.RepeatedCompositeFieldContainer[SubAgent]
    env: _containers.MessageMap[str, _spec_pb2.EnvVarDeclaration]
    datastore_usages: _containers.RepeatedCompositeFieldContainer[DatastoreUsage]
    def __init__(self, description: _Optional[str] = ..., icon_url: _Optional[str] = ..., instructions: _Optional[str] = ..., mcp_server_usages: _Optional[_Iterable[_Union[McpServerUsage, _Mapping]]] = ..., skill_refs: _Optional[_Iterable[_Union[_io_pb2.ApiResourceReference, _Mapping]]] = ..., sub_agents: _Optional[_Iterable[_Union[SubAgent, _Mapping]]] = ..., env: _Optional[_Mapping[str, _spec_pb2.EnvVarDeclaration]] = ..., datastore_usages: _Optional[_Iterable[_Union[DatastoreUsage, _Mapping]]] = ...) -> None: ...

class SubAgent(_message.Message):
    __slots__ = ("name", "description", "instructions", "mcp_access", "skill_refs", "model_override")
    NAME_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    INSTRUCTIONS_FIELD_NUMBER: _ClassVar[int]
    MCP_ACCESS_FIELD_NUMBER: _ClassVar[int]
    SKILL_REFS_FIELD_NUMBER: _ClassVar[int]
    MODEL_OVERRIDE_FIELD_NUMBER: _ClassVar[int]
    name: str
    description: str
    instructions: str
    mcp_access: _containers.RepeatedCompositeFieldContainer[McpAccess]
    skill_refs: _containers.RepeatedCompositeFieldContainer[_io_pb2.ApiResourceReference]
    model_override: str
    def __init__(self, name: _Optional[str] = ..., description: _Optional[str] = ..., instructions: _Optional[str] = ..., mcp_access: _Optional[_Iterable[_Union[McpAccess, _Mapping]]] = ..., skill_refs: _Optional[_Iterable[_Union[_io_pb2.ApiResourceReference, _Mapping]]] = ..., model_override: _Optional[str] = ...) -> None: ...

class McpServerUsage(_message.Message):
    __slots__ = ("mcp_server_ref", "enabled_tools", "tool_approval_overrides")
    MCP_SERVER_REF_FIELD_NUMBER: _ClassVar[int]
    ENABLED_TOOLS_FIELD_NUMBER: _ClassVar[int]
    TOOL_APPROVAL_OVERRIDES_FIELD_NUMBER: _ClassVar[int]
    mcp_server_ref: _io_pb2.ApiResourceReference
    enabled_tools: _containers.RepeatedScalarFieldContainer[str]
    tool_approval_overrides: _containers.RepeatedCompositeFieldContainer[ToolApprovalOverride]
    def __init__(self, mcp_server_ref: _Optional[_Union[_io_pb2.ApiResourceReference, _Mapping]] = ..., enabled_tools: _Optional[_Iterable[str]] = ..., tool_approval_overrides: _Optional[_Iterable[_Union[ToolApprovalOverride, _Mapping]]] = ...) -> None: ...

class DatastoreUsage(_message.Message):
    __slots__ = ("datastore_ref",)
    DATASTORE_REF_FIELD_NUMBER: _ClassVar[int]
    datastore_ref: _io_pb2.ApiResourceReference
    def __init__(self, datastore_ref: _Optional[_Union[_io_pb2.ApiResourceReference, _Mapping]] = ...) -> None: ...

class McpAccess(_message.Message):
    __slots__ = ("mcp_server", "enabled_tools")
    MCP_SERVER_FIELD_NUMBER: _ClassVar[int]
    ENABLED_TOOLS_FIELD_NUMBER: _ClassVar[int]
    mcp_server: str
    enabled_tools: _containers.RepeatedScalarFieldContainer[str]
    def __init__(self, mcp_server: _Optional[str] = ..., enabled_tools: _Optional[_Iterable[str]] = ...) -> None: ...

class ToolApprovalOverride(_message.Message):
    __slots__ = ("tool_name", "requires_approval", "message")
    TOOL_NAME_FIELD_NUMBER: _ClassVar[int]
    REQUIRES_APPROVAL_FIELD_NUMBER: _ClassVar[int]
    MESSAGE_FIELD_NUMBER: _ClassVar[int]
    tool_name: str
    requires_approval: bool
    message: str
    def __init__(self, tool_name: _Optional[str] = ..., requires_approval: bool = ..., message: _Optional[str] = ...) -> None: ...
