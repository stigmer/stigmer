from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable
from typing import ClassVar as _ClassVar, Optional as _Optional

DESCRIPTOR: _descriptor.FileDescriptor

class IdentityProviderSpec(_message.Message):
    __slots__ = ("display_name", "jwks_uri", "allowed_issuers", "expected_audience", "rate_limit_budget", "userinfo_endpoint", "is_sso_provider", "oidc_client_id")
    DISPLAY_NAME_FIELD_NUMBER: _ClassVar[int]
    JWKS_URI_FIELD_NUMBER: _ClassVar[int]
    ALLOWED_ISSUERS_FIELD_NUMBER: _ClassVar[int]
    EXPECTED_AUDIENCE_FIELD_NUMBER: _ClassVar[int]
    RATE_LIMIT_BUDGET_FIELD_NUMBER: _ClassVar[int]
    USERINFO_ENDPOINT_FIELD_NUMBER: _ClassVar[int]
    IS_SSO_PROVIDER_FIELD_NUMBER: _ClassVar[int]
    OIDC_CLIENT_ID_FIELD_NUMBER: _ClassVar[int]
    display_name: str
    jwks_uri: str
    allowed_issuers: _containers.RepeatedScalarFieldContainer[str]
    expected_audience: str
    rate_limit_budget: int
    userinfo_endpoint: str
    is_sso_provider: bool
    oidc_client_id: str
    def __init__(self, display_name: _Optional[str] = ..., jwks_uri: _Optional[str] = ..., allowed_issuers: _Optional[_Iterable[str]] = ..., expected_audience: _Optional[str] = ..., rate_limit_budget: _Optional[int] = ..., userinfo_endpoint: _Optional[str] = ..., is_sso_provider: bool = ..., oidc_client_id: _Optional[str] = ...) -> None: ...
