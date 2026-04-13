from ai.stigmer.agentic.executioncontext.v1 import spec_pb2 as _spec_pb2
from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class OAuthConnectionHealth(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    OAUTH_CONNECTION_HEALTH_UNSPECIFIED: _ClassVar[OAuthConnectionHealth]
    OAUTH_CONNECTION_HEALTH_HEALTHY: _ClassVar[OAuthConnectionHealth]
    OAUTH_CONNECTION_HEALTH_TOKEN_EXPIRED: _ClassVar[OAuthConnectionHealth]
    OAUTH_CONNECTION_HEALTH_TOKEN_EXPIRED_REFRESHABLE: _ClassVar[OAuthConnectionHealth]
    OAUTH_CONNECTION_HEALTH_NO_GRANT: _ClassVar[OAuthConnectionHealth]
OAUTH_CONNECTION_HEALTH_UNSPECIFIED: OAuthConnectionHealth
OAUTH_CONNECTION_HEALTH_HEALTHY: OAuthConnectionHealth
OAUTH_CONNECTION_HEALTH_TOKEN_EXPIRED: OAuthConnectionHealth
OAUTH_CONNECTION_HEALTH_TOKEN_EXPIRED_REFRESHABLE: OAuthConnectionHealth
OAUTH_CONNECTION_HEALTH_NO_GRANT: OAuthConnectionHealth

class McpServerId(_message.Message):
    __slots__ = ("value",)
    VALUE_FIELD_NUMBER: _ClassVar[int]
    value: str
    def __init__(self, value: _Optional[str] = ...) -> None: ...

class ConnectInput(_message.Message):
    __slots__ = ("mcp_server_id", "runtime_env", "org")
    class RuntimeEnvEntry(_message.Message):
        __slots__ = ("key", "value")
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: _spec_pb2.ExecutionValue
        def __init__(self, key: _Optional[str] = ..., value: _Optional[_Union[_spec_pb2.ExecutionValue, _Mapping]] = ...) -> None: ...
    MCP_SERVER_ID_FIELD_NUMBER: _ClassVar[int]
    RUNTIME_ENV_FIELD_NUMBER: _ClassVar[int]
    ORG_FIELD_NUMBER: _ClassVar[int]
    mcp_server_id: str
    runtime_env: _containers.MessageMap[str, _spec_pb2.ExecutionValue]
    org: str
    def __init__(self, mcp_server_id: _Optional[str] = ..., runtime_env: _Optional[_Mapping[str, _spec_pb2.ExecutionValue]] = ..., org: _Optional[str] = ...) -> None: ...

class InitiateOAuthConnectInput(_message.Message):
    __slots__ = ("mcp_server_id", "org")
    MCP_SERVER_ID_FIELD_NUMBER: _ClassVar[int]
    ORG_FIELD_NUMBER: _ClassVar[int]
    mcp_server_id: str
    org: str
    def __init__(self, mcp_server_id: _Optional[str] = ..., org: _Optional[str] = ...) -> None: ...

class InitiateOAuthConnectOutput(_message.Message):
    __slots__ = ("authorization_url", "state", "scopes", "provider_name")
    AUTHORIZATION_URL_FIELD_NUMBER: _ClassVar[int]
    STATE_FIELD_NUMBER: _ClassVar[int]
    SCOPES_FIELD_NUMBER: _ClassVar[int]
    PROVIDER_NAME_FIELD_NUMBER: _ClassVar[int]
    authorization_url: str
    state: str
    scopes: _containers.RepeatedScalarFieldContainer[str]
    provider_name: str
    def __init__(self, authorization_url: _Optional[str] = ..., state: _Optional[str] = ..., scopes: _Optional[_Iterable[str]] = ..., provider_name: _Optional[str] = ...) -> None: ...

class CompleteOAuthConnectInput(_message.Message):
    __slots__ = ("mcp_server_id", "authorization_code", "state")
    MCP_SERVER_ID_FIELD_NUMBER: _ClassVar[int]
    AUTHORIZATION_CODE_FIELD_NUMBER: _ClassVar[int]
    STATE_FIELD_NUMBER: _ClassVar[int]
    mcp_server_id: str
    authorization_code: str
    state: str
    def __init__(self, mcp_server_id: _Optional[str] = ..., authorization_code: _Optional[str] = ..., state: _Optional[str] = ...) -> None: ...

class CompleteOAuthConnectOutput(_message.Message):
    __slots__ = ("connected", "target_env_var", "token_lifetime_hint")
    CONNECTED_FIELD_NUMBER: _ClassVar[int]
    TARGET_ENV_VAR_FIELD_NUMBER: _ClassVar[int]
    TOKEN_LIFETIME_HINT_FIELD_NUMBER: _ClassVar[int]
    connected: bool
    target_env_var: str
    token_lifetime_hint: str
    def __init__(self, connected: bool = ..., target_env_var: _Optional[str] = ..., token_lifetime_hint: _Optional[str] = ...) -> None: ...

class GetOAuthGrantStatusInput(_message.Message):
    __slots__ = ("resource_id", "org")
    RESOURCE_ID_FIELD_NUMBER: _ClassVar[int]
    ORG_FIELD_NUMBER: _ClassVar[int]
    resource_id: str
    org: str
    def __init__(self, resource_id: _Optional[str] = ..., org: _Optional[str] = ...) -> None: ...

class GetOAuthGrantStatusOutput(_message.Message):
    __slots__ = ("connected", "access_token_expires_at", "target_env_var", "auth_method", "connection_health")
    CONNECTED_FIELD_NUMBER: _ClassVar[int]
    ACCESS_TOKEN_EXPIRES_AT_FIELD_NUMBER: _ClassVar[int]
    TARGET_ENV_VAR_FIELD_NUMBER: _ClassVar[int]
    AUTH_METHOD_FIELD_NUMBER: _ClassVar[int]
    CONNECTION_HEALTH_FIELD_NUMBER: _ClassVar[int]
    connected: bool
    access_token_expires_at: int
    target_env_var: str
    auth_method: str
    connection_health: OAuthConnectionHealth
    def __init__(self, connected: bool = ..., access_token_expires_at: _Optional[int] = ..., target_env_var: _Optional[str] = ..., auth_method: _Optional[str] = ..., connection_health: _Optional[_Union[OAuthConnectionHealth, str]] = ...) -> None: ...

class DisconnectOAuthInput(_message.Message):
    __slots__ = ("resource_id", "org")
    RESOURCE_ID_FIELD_NUMBER: _ClassVar[int]
    ORG_FIELD_NUMBER: _ClassVar[int]
    resource_id: str
    org: str
    def __init__(self, resource_id: _Optional[str] = ..., org: _Optional[str] = ...) -> None: ...

class DisconnectOAuthOutput(_message.Message):
    __slots__ = ("disconnected",)
    DISCONNECTED_FIELD_NUMBER: _ClassVar[int]
    disconnected: bool
    def __init__(self, disconnected: bool = ...) -> None: ...

class SetOrgOAuthAppInput(_message.Message):
    __slots__ = ("resource_id", "org", "client_id", "client_secret")
    RESOURCE_ID_FIELD_NUMBER: _ClassVar[int]
    ORG_FIELD_NUMBER: _ClassVar[int]
    CLIENT_ID_FIELD_NUMBER: _ClassVar[int]
    CLIENT_SECRET_FIELD_NUMBER: _ClassVar[int]
    resource_id: str
    org: str
    client_id: str
    client_secret: str
    def __init__(self, resource_id: _Optional[str] = ..., org: _Optional[str] = ..., client_id: _Optional[str] = ..., client_secret: _Optional[str] = ...) -> None: ...

class SetOrgOAuthAppOutput(_message.Message):
    __slots__ = ("oauth_app_id",)
    OAUTH_APP_ID_FIELD_NUMBER: _ClassVar[int]
    oauth_app_id: str
    def __init__(self, oauth_app_id: _Optional[str] = ...) -> None: ...

class GetOrgOAuthAppInput(_message.Message):
    __slots__ = ("resource_id", "org")
    RESOURCE_ID_FIELD_NUMBER: _ClassVar[int]
    ORG_FIELD_NUMBER: _ClassVar[int]
    resource_id: str
    org: str
    def __init__(self, resource_id: _Optional[str] = ..., org: _Optional[str] = ...) -> None: ...

class GetOrgOAuthAppOutput(_message.Message):
    __slots__ = ("has_override", "oauth_app_id", "client_id")
    HAS_OVERRIDE_FIELD_NUMBER: _ClassVar[int]
    OAUTH_APP_ID_FIELD_NUMBER: _ClassVar[int]
    CLIENT_ID_FIELD_NUMBER: _ClassVar[int]
    has_override: bool
    oauth_app_id: str
    client_id: str
    def __init__(self, has_override: bool = ..., oauth_app_id: _Optional[str] = ..., client_id: _Optional[str] = ...) -> None: ...

class DeleteOrgOAuthAppInput(_message.Message):
    __slots__ = ("resource_id", "org")
    RESOURCE_ID_FIELD_NUMBER: _ClassVar[int]
    ORG_FIELD_NUMBER: _ClassVar[int]
    resource_id: str
    org: str
    def __init__(self, resource_id: _Optional[str] = ..., org: _Optional[str] = ...) -> None: ...

class DeleteOrgOAuthAppOutput(_message.Message):
    __slots__ = ("deleted",)
    DELETED_FIELD_NUMBER: _ClassVar[int]
    deleted: bool
    def __init__(self, deleted: bool = ...) -> None: ...
