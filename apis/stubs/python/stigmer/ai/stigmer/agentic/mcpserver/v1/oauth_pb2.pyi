from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from typing import ClassVar as _ClassVar, Optional as _Optional

DESCRIPTOR: _descriptor.FileDescriptor

class OAuthGrant(_message.Message):
    __slots__ = ("identity_account_id", "resource_id", "access_token_expires_at", "client_id", "auth_method", "token_endpoint", "access_token_env_var", "refresh_token_env_var", "environment_id", "resource_kind", "org_id")
    IDENTITY_ACCOUNT_ID_FIELD_NUMBER: _ClassVar[int]
    RESOURCE_ID_FIELD_NUMBER: _ClassVar[int]
    ACCESS_TOKEN_EXPIRES_AT_FIELD_NUMBER: _ClassVar[int]
    CLIENT_ID_FIELD_NUMBER: _ClassVar[int]
    AUTH_METHOD_FIELD_NUMBER: _ClassVar[int]
    TOKEN_ENDPOINT_FIELD_NUMBER: _ClassVar[int]
    ACCESS_TOKEN_ENV_VAR_FIELD_NUMBER: _ClassVar[int]
    REFRESH_TOKEN_ENV_VAR_FIELD_NUMBER: _ClassVar[int]
    ENVIRONMENT_ID_FIELD_NUMBER: _ClassVar[int]
    RESOURCE_KIND_FIELD_NUMBER: _ClassVar[int]
    ORG_ID_FIELD_NUMBER: _ClassVar[int]
    identity_account_id: str
    resource_id: str
    access_token_expires_at: int
    client_id: str
    auth_method: str
    token_endpoint: str
    access_token_env_var: str
    refresh_token_env_var: str
    environment_id: str
    resource_kind: str
    org_id: str
    def __init__(self, identity_account_id: _Optional[str] = ..., resource_id: _Optional[str] = ..., access_token_expires_at: _Optional[int] = ..., client_id: _Optional[str] = ..., auth_method: _Optional[str] = ..., token_endpoint: _Optional[str] = ..., access_token_env_var: _Optional[str] = ..., refresh_token_env_var: _Optional[str] = ..., environment_id: _Optional[str] = ..., resource_kind: _Optional[str] = ..., org_id: _Optional[str] = ...) -> None: ...

class OAuthAppOverride(_message.Message):
    __slots__ = ("resource_id", "resource_kind", "org_id", "oauth_app_id")
    RESOURCE_ID_FIELD_NUMBER: _ClassVar[int]
    RESOURCE_KIND_FIELD_NUMBER: _ClassVar[int]
    ORG_ID_FIELD_NUMBER: _ClassVar[int]
    OAUTH_APP_ID_FIELD_NUMBER: _ClassVar[int]
    resource_id: str
    resource_kind: str
    org_id: str
    oauth_app_id: str
    def __init__(self, resource_id: _Optional[str] = ..., resource_kind: _Optional[str] = ..., org_id: _Optional[str] = ..., oauth_app_id: _Optional[str] = ...) -> None: ...
