from ai.stigmer.agentic.executioncontext.v1 import spec_pb2 as _spec_pb2
from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Mapping as _Mapping
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
