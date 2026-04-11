from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from typing import ClassVar as _ClassVar, Optional as _Optional

DESCRIPTOR: _descriptor.FileDescriptor

class OAuthGrant(_message.Message):
    __slots__ = ("identity_account_id", "mcp_server_id", "access_token_expires_at", "client_id", "auth_method", "token_endpoint", "access_token_env_var", "refresh_token_env_var", "environment_id")
    IDENTITY_ACCOUNT_ID_FIELD_NUMBER: _ClassVar[int]
    MCP_SERVER_ID_FIELD_NUMBER: _ClassVar[int]
    ACCESS_TOKEN_EXPIRES_AT_FIELD_NUMBER: _ClassVar[int]
    CLIENT_ID_FIELD_NUMBER: _ClassVar[int]
    AUTH_METHOD_FIELD_NUMBER: _ClassVar[int]
    TOKEN_ENDPOINT_FIELD_NUMBER: _ClassVar[int]
    ACCESS_TOKEN_ENV_VAR_FIELD_NUMBER: _ClassVar[int]
    REFRESH_TOKEN_ENV_VAR_FIELD_NUMBER: _ClassVar[int]
    ENVIRONMENT_ID_FIELD_NUMBER: _ClassVar[int]
    identity_account_id: str
    mcp_server_id: str
    access_token_expires_at: int
    client_id: str
    auth_method: str
    token_endpoint: str
    access_token_env_var: str
    refresh_token_env_var: str
    environment_id: str
    def __init__(self, identity_account_id: _Optional[str] = ..., mcp_server_id: _Optional[str] = ..., access_token_expires_at: _Optional[int] = ..., client_id: _Optional[str] = ..., auth_method: _Optional[str] = ..., token_endpoint: _Optional[str] = ..., access_token_env_var: _Optional[str] = ..., refresh_token_env_var: _Optional[str] = ..., environment_id: _Optional[str] = ...) -> None: ...
