from ai.stigmer.agentic.plugin.v1 import hooks_pb2 as _hooks_pb2
from ai.stigmer.agentic.vault.v1 import declaration_pb2 as _declaration_pb2
from ai.stigmer.commons.apiresource import status_pb2 as _status_pb2
from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class PluginStatus(_message.Message):
    __slots__ = ("audit", "digest", "artifact_storage_key", "warnings", "hooks", "evals", "skills", "agents", "mcp_servers", "env")
    class EnvEntry(_message.Message):
        __slots__ = ("key", "value")
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: _declaration_pb2.EnvVarDeclaration
        def __init__(self, key: _Optional[str] = ..., value: _Optional[_Union[_declaration_pb2.EnvVarDeclaration, _Mapping]] = ...) -> None: ...
    AUDIT_FIELD_NUMBER: _ClassVar[int]
    DIGEST_FIELD_NUMBER: _ClassVar[int]
    ARTIFACT_STORAGE_KEY_FIELD_NUMBER: _ClassVar[int]
    WARNINGS_FIELD_NUMBER: _ClassVar[int]
    HOOKS_FIELD_NUMBER: _ClassVar[int]
    EVALS_FIELD_NUMBER: _ClassVar[int]
    SKILLS_FIELD_NUMBER: _ClassVar[int]
    AGENTS_FIELD_NUMBER: _ClassVar[int]
    MCP_SERVERS_FIELD_NUMBER: _ClassVar[int]
    ENV_FIELD_NUMBER: _ClassVar[int]
    audit: _status_pb2.ApiResourceAudit
    digest: str
    artifact_storage_key: str
    warnings: _containers.RepeatedCompositeFieldContainer[PluginWarning]
    hooks: _hooks_pb2.HookConfig
    evals: PluginEvalSuite
    skills: _containers.RepeatedCompositeFieldContainer[PluginSkill]
    agents: _containers.RepeatedCompositeFieldContainer[PluginAgent]
    mcp_servers: _containers.RepeatedCompositeFieldContainer[McpServerEntry]
    env: _containers.MessageMap[str, _declaration_pb2.EnvVarDeclaration]
    def __init__(self, audit: _Optional[_Union[_status_pb2.ApiResourceAudit, _Mapping]] = ..., digest: _Optional[str] = ..., artifact_storage_key: _Optional[str] = ..., warnings: _Optional[_Iterable[_Union[PluginWarning, _Mapping]]] = ..., hooks: _Optional[_Union[_hooks_pb2.HookConfig, _Mapping]] = ..., evals: _Optional[_Union[PluginEvalSuite, _Mapping]] = ..., skills: _Optional[_Iterable[_Union[PluginSkill, _Mapping]]] = ..., agents: _Optional[_Iterable[_Union[PluginAgent, _Mapping]]] = ..., mcp_servers: _Optional[_Iterable[_Union[McpServerEntry, _Mapping]]] = ..., env: _Optional[_Mapping[str, _declaration_pb2.EnvVarDeclaration]] = ...) -> None: ...

class PluginSkill(_message.Message):
    __slots__ = ("name", "description", "path")
    NAME_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    PATH_FIELD_NUMBER: _ClassVar[int]
    name: str
    description: str
    path: str
    def __init__(self, name: _Optional[str] = ..., description: _Optional[str] = ..., path: _Optional[str] = ...) -> None: ...

class PluginAgent(_message.Message):
    __slots__ = ("name", "description", "instructions", "tools", "disallowed_tools", "skills")
    NAME_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    INSTRUCTIONS_FIELD_NUMBER: _ClassVar[int]
    TOOLS_FIELD_NUMBER: _ClassVar[int]
    DISALLOWED_TOOLS_FIELD_NUMBER: _ClassVar[int]
    SKILLS_FIELD_NUMBER: _ClassVar[int]
    name: str
    description: str
    instructions: str
    tools: _containers.RepeatedScalarFieldContainer[str]
    disallowed_tools: _containers.RepeatedScalarFieldContainer[str]
    skills: _containers.RepeatedScalarFieldContainer[str]
    def __init__(self, name: _Optional[str] = ..., description: _Optional[str] = ..., instructions: _Optional[str] = ..., tools: _Optional[_Iterable[str]] = ..., disallowed_tools: _Optional[_Iterable[str]] = ..., skills: _Optional[_Iterable[str]] = ...) -> None: ...

class McpServerEntry(_message.Message):
    __slots__ = ("name", "stdio", "http", "env", "sign_in")
    NAME_FIELD_NUMBER: _ClassVar[int]
    STDIO_FIELD_NUMBER: _ClassVar[int]
    HTTP_FIELD_NUMBER: _ClassVar[int]
    ENV_FIELD_NUMBER: _ClassVar[int]
    SIGN_IN_FIELD_NUMBER: _ClassVar[int]
    name: str
    stdio: StdioMcpServer
    http: HttpMcpServer
    env: _containers.RepeatedScalarFieldContainer[str]
    sign_in: McpServerSignIn
    def __init__(self, name: _Optional[str] = ..., stdio: _Optional[_Union[StdioMcpServer, _Mapping]] = ..., http: _Optional[_Union[HttpMcpServer, _Mapping]] = ..., env: _Optional[_Iterable[str]] = ..., sign_in: _Optional[_Union[McpServerSignIn, _Mapping]] = ...) -> None: ...

class StdioMcpServer(_message.Message):
    __slots__ = ("command", "args")
    COMMAND_FIELD_NUMBER: _ClassVar[int]
    ARGS_FIELD_NUMBER: _ClassVar[int]
    command: str
    args: _containers.RepeatedScalarFieldContainer[str]
    def __init__(self, command: _Optional[str] = ..., args: _Optional[_Iterable[str]] = ...) -> None: ...

class HttpMcpServer(_message.Message):
    __slots__ = ("url", "headers", "timeout_seconds")
    class HeadersEntry(_message.Message):
        __slots__ = ("key", "value")
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: str
        def __init__(self, key: _Optional[str] = ..., value: _Optional[str] = ...) -> None: ...
    URL_FIELD_NUMBER: _ClassVar[int]
    HEADERS_FIELD_NUMBER: _ClassVar[int]
    TIMEOUT_SECONDS_FIELD_NUMBER: _ClassVar[int]
    url: str
    headers: _containers.ScalarMap[str, str]
    timeout_seconds: int
    def __init__(self, url: _Optional[str] = ..., headers: _Optional[_Mapping[str, str]] = ..., timeout_seconds: _Optional[int] = ...) -> None: ...

class McpServerSignIn(_message.Message):
    __slots__ = ("oauth_only",)
    OAUTH_ONLY_FIELD_NUMBER: _ClassVar[int]
    oauth_only: bool
    def __init__(self, oauth_only: bool = ...) -> None: ...

class PluginWarning(_message.Message):
    __slots__ = ("kind", "message", "path")
    KIND_FIELD_NUMBER: _ClassVar[int]
    MESSAGE_FIELD_NUMBER: _ClassVar[int]
    PATH_FIELD_NUMBER: _ClassVar[int]
    kind: str
    message: str
    path: str
    def __init__(self, kind: _Optional[str] = ..., message: _Optional[str] = ..., path: _Optional[str] = ...) -> None: ...

class PluginEvalSuite(_message.Message):
    __slots__ = ("dir", "case_count", "case_tags", "cases", "findings")
    DIR_FIELD_NUMBER: _ClassVar[int]
    CASE_COUNT_FIELD_NUMBER: _ClassVar[int]
    CASE_TAGS_FIELD_NUMBER: _ClassVar[int]
    CASES_FIELD_NUMBER: _ClassVar[int]
    FINDINGS_FIELD_NUMBER: _ClassVar[int]
    dir: str
    case_count: int
    case_tags: _containers.RepeatedScalarFieldContainer[str]
    cases: _containers.RepeatedCompositeFieldContainer[PluginEvalSuiteCase]
    findings: _containers.RepeatedCompositeFieldContainer[PluginWarning]
    def __init__(self, dir: _Optional[str] = ..., case_count: _Optional[int] = ..., case_tags: _Optional[_Iterable[str]] = ..., cases: _Optional[_Iterable[_Union[PluginEvalSuiteCase, _Mapping]]] = ..., findings: _Optional[_Iterable[_Union[PluginWarning, _Mapping]]] = ...) -> None: ...

class PluginEvalSuiteCase(_message.Message):
    __slots__ = ("case_name", "path", "case_tags", "unsupported")
    CASE_NAME_FIELD_NUMBER: _ClassVar[int]
    PATH_FIELD_NUMBER: _ClassVar[int]
    CASE_TAGS_FIELD_NUMBER: _ClassVar[int]
    UNSUPPORTED_FIELD_NUMBER: _ClassVar[int]
    case_name: str
    path: str
    case_tags: _containers.RepeatedScalarFieldContainer[str]
    unsupported: str
    def __init__(self, case_name: _Optional[str] = ..., path: _Optional[str] = ..., case_tags: _Optional[_Iterable[str]] = ..., unsupported: _Optional[str] = ...) -> None: ...
