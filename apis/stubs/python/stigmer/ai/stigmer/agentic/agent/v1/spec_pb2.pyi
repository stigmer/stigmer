from ai.stigmer.agentic.mcpserver.v1 import usage_pb2 as _usage_pb2
from ai.stigmer.agentic.plugin.v1 import hooks_pb2 as _hooks_pb2
from ai.stigmer.agentic.run.v1 import invocation_pb2 as _invocation_pb2
from ai.stigmer.agentic.session.v1 import enum_pb2 as _enum_pb2
from ai.stigmer.agentic.vault.v1 import declaration_pb2 as _declaration_pb2
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
    __slots__ = ("description", "icon_url", "instructions", "mcp_server_usages", "skill_refs", "sub_agents", "env", "tools", "disallowed_tools", "hooks", "run_config", "harness", "vaults")
    class EnvEntry(_message.Message):
        __slots__ = ("key", "value")
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: _declaration_pb2.EnvVarDeclaration
        def __init__(self, key: _Optional[str] = ..., value: _Optional[_Union[_declaration_pb2.EnvVarDeclaration, _Mapping]] = ...) -> None: ...
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    ICON_URL_FIELD_NUMBER: _ClassVar[int]
    INSTRUCTIONS_FIELD_NUMBER: _ClassVar[int]
    MCP_SERVER_USAGES_FIELD_NUMBER: _ClassVar[int]
    SKILL_REFS_FIELD_NUMBER: _ClassVar[int]
    SUB_AGENTS_FIELD_NUMBER: _ClassVar[int]
    ENV_FIELD_NUMBER: _ClassVar[int]
    TOOLS_FIELD_NUMBER: _ClassVar[int]
    DISALLOWED_TOOLS_FIELD_NUMBER: _ClassVar[int]
    HOOKS_FIELD_NUMBER: _ClassVar[int]
    RUN_CONFIG_FIELD_NUMBER: _ClassVar[int]
    HARNESS_FIELD_NUMBER: _ClassVar[int]
    VAULTS_FIELD_NUMBER: _ClassVar[int]
    description: str
    icon_url: str
    instructions: str
    mcp_server_usages: _containers.RepeatedCompositeFieldContainer[_usage_pb2.McpServerUsage]
    skill_refs: _containers.RepeatedCompositeFieldContainer[_io_pb2.ApiResourceReference]
    sub_agents: _containers.RepeatedCompositeFieldContainer[SubAgent]
    env: _containers.MessageMap[str, _declaration_pb2.EnvVarDeclaration]
    tools: _containers.RepeatedScalarFieldContainer[str]
    disallowed_tools: _containers.RepeatedScalarFieldContainer[str]
    hooks: _containers.RepeatedCompositeFieldContainer[HookSource]
    run_config: _invocation_pb2.RunConfig
    harness: _enum_pb2.Harness
    vaults: _containers.RepeatedCompositeFieldContainer[_io_pb2.ApiResourceReference]
    def __init__(self, description: _Optional[str] = ..., icon_url: _Optional[str] = ..., instructions: _Optional[str] = ..., mcp_server_usages: _Optional[_Iterable[_Union[_usage_pb2.McpServerUsage, _Mapping]]] = ..., skill_refs: _Optional[_Iterable[_Union[_io_pb2.ApiResourceReference, _Mapping]]] = ..., sub_agents: _Optional[_Iterable[_Union[SubAgent, _Mapping]]] = ..., env: _Optional[_Mapping[str, _declaration_pb2.EnvVarDeclaration]] = ..., tools: _Optional[_Iterable[str]] = ..., disallowed_tools: _Optional[_Iterable[str]] = ..., hooks: _Optional[_Iterable[_Union[HookSource, _Mapping]]] = ..., run_config: _Optional[_Union[_invocation_pb2.RunConfig, _Mapping]] = ..., harness: _Optional[_Union[_enum_pb2.Harness, str]] = ..., vaults: _Optional[_Iterable[_Union[_io_pb2.ApiResourceReference, _Mapping]]] = ...) -> None: ...

class HookSource(_message.Message):
    __slots__ = ("plugin", "inline")
    PLUGIN_FIELD_NUMBER: _ClassVar[int]
    INLINE_FIELD_NUMBER: _ClassVar[int]
    plugin: _io_pb2.ApiResourceReference
    inline: _hooks_pb2.HookConfig
    def __init__(self, plugin: _Optional[_Union[_io_pb2.ApiResourceReference, _Mapping]] = ..., inline: _Optional[_Union[_hooks_pb2.HookConfig, _Mapping]] = ...) -> None: ...

class SubAgent(_message.Message):
    __slots__ = ("name", "description", "instructions", "skill_refs", "model_override", "tools", "disallowed_tools")
    NAME_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    INSTRUCTIONS_FIELD_NUMBER: _ClassVar[int]
    SKILL_REFS_FIELD_NUMBER: _ClassVar[int]
    MODEL_OVERRIDE_FIELD_NUMBER: _ClassVar[int]
    TOOLS_FIELD_NUMBER: _ClassVar[int]
    DISALLOWED_TOOLS_FIELD_NUMBER: _ClassVar[int]
    name: str
    description: str
    instructions: str
    skill_refs: _containers.RepeatedCompositeFieldContainer[_io_pb2.ApiResourceReference]
    model_override: str
    tools: _containers.RepeatedScalarFieldContainer[str]
    disallowed_tools: _containers.RepeatedScalarFieldContainer[str]
    def __init__(self, name: _Optional[str] = ..., description: _Optional[str] = ..., instructions: _Optional[str] = ..., skill_refs: _Optional[_Iterable[_Union[_io_pb2.ApiResourceReference, _Mapping]]] = ..., model_override: _Optional[str] = ..., tools: _Optional[_Iterable[str]] = ..., disallowed_tools: _Optional[_Iterable[str]] = ...) -> None: ...
