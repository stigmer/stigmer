from ai.stigmer.agentic.environment.v1 import spec_pb2 as _spec_pb2
from ai.stigmer.commons.apiresource import field_options_pb2 as _field_options_pb2
from ai.stigmer.commons.apiresource import io_pb2 as _io_pb2
from ai.stigmer.iam.oauthapp.v1 import spec_pb2 as _spec_pb2_1
from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class McpServerSpec(_message.Message):
    __slots__ = ("description", "icon_url", "tags", "stdio", "http", "default_enabled_tools", "env", "pinned_tool_approvals", "repository_url", "github_stars", "auth")
    class EnvEntry(_message.Message):
        __slots__ = ("key", "value")
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: _spec_pb2.EnvVarDeclaration
        def __init__(self, key: _Optional[str] = ..., value: _Optional[_Union[_spec_pb2.EnvVarDeclaration, _Mapping]] = ...) -> None: ...
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    ICON_URL_FIELD_NUMBER: _ClassVar[int]
    TAGS_FIELD_NUMBER: _ClassVar[int]
    STDIO_FIELD_NUMBER: _ClassVar[int]
    HTTP_FIELD_NUMBER: _ClassVar[int]
    DEFAULT_ENABLED_TOOLS_FIELD_NUMBER: _ClassVar[int]
    ENV_FIELD_NUMBER: _ClassVar[int]
    PINNED_TOOL_APPROVALS_FIELD_NUMBER: _ClassVar[int]
    REPOSITORY_URL_FIELD_NUMBER: _ClassVar[int]
    GITHUB_STARS_FIELD_NUMBER: _ClassVar[int]
    AUTH_FIELD_NUMBER: _ClassVar[int]
    description: str
    icon_url: str
    tags: _containers.RepeatedScalarFieldContainer[str]
    stdio: StdioServerConfig
    http: HttpServerConfig
    default_enabled_tools: _containers.RepeatedScalarFieldContainer[str]
    env: _containers.MessageMap[str, _spec_pb2.EnvVarDeclaration]
    pinned_tool_approvals: _containers.RepeatedCompositeFieldContainer[ToolApprovalPolicy]
    repository_url: str
    github_stars: int
    auth: McpServerAuth
    def __init__(self, description: _Optional[str] = ..., icon_url: _Optional[str] = ..., tags: _Optional[_Iterable[str]] = ..., stdio: _Optional[_Union[StdioServerConfig, _Mapping]] = ..., http: _Optional[_Union[HttpServerConfig, _Mapping]] = ..., default_enabled_tools: _Optional[_Iterable[str]] = ..., env: _Optional[_Mapping[str, _spec_pb2.EnvVarDeclaration]] = ..., pinned_tool_approvals: _Optional[_Iterable[_Union[ToolApprovalPolicy, _Mapping]]] = ..., repository_url: _Optional[str] = ..., github_stars: _Optional[int] = ..., auth: _Optional[_Union[McpServerAuth, _Mapping]] = ...) -> None: ...

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

class McpServerAuth(_message.Message):
    __slots__ = ("oauth_app_ref", "target_env_var", "token_lifetime_hint", "scope_hints", "vendor_approval_status", "vendor_approval_docs_url")
    OAUTH_APP_REF_FIELD_NUMBER: _ClassVar[int]
    TARGET_ENV_VAR_FIELD_NUMBER: _ClassVar[int]
    TOKEN_LIFETIME_HINT_FIELD_NUMBER: _ClassVar[int]
    SCOPE_HINTS_FIELD_NUMBER: _ClassVar[int]
    VENDOR_APPROVAL_STATUS_FIELD_NUMBER: _ClassVar[int]
    VENDOR_APPROVAL_DOCS_URL_FIELD_NUMBER: _ClassVar[int]
    oauth_app_ref: _io_pb2.ApiResourceReference
    target_env_var: str
    token_lifetime_hint: str
    scope_hints: _containers.RepeatedScalarFieldContainer[str]
    vendor_approval_status: _spec_pb2_1.VendorApprovalStatus
    vendor_approval_docs_url: str
    def __init__(self, oauth_app_ref: _Optional[_Union[_io_pb2.ApiResourceReference, _Mapping]] = ..., target_env_var: _Optional[str] = ..., token_lifetime_hint: _Optional[str] = ..., scope_hints: _Optional[_Iterable[str]] = ..., vendor_approval_status: _Optional[_Union[_spec_pb2_1.VendorApprovalStatus, str]] = ..., vendor_approval_docs_url: _Optional[str] = ...) -> None: ...
