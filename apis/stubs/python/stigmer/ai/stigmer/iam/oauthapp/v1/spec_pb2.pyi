from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable
from typing import ClassVar as _ClassVar, Optional as _Optional

DESCRIPTOR: _descriptor.FileDescriptor

class OAuthAppSpec(_message.Message):
    __slots__ = ("provider", "client_id", "client_secret", "authorization_url", "token_url", "scopes", "userinfo_url")
    PROVIDER_FIELD_NUMBER: _ClassVar[int]
    CLIENT_ID_FIELD_NUMBER: _ClassVar[int]
    CLIENT_SECRET_FIELD_NUMBER: _ClassVar[int]
    AUTHORIZATION_URL_FIELD_NUMBER: _ClassVar[int]
    TOKEN_URL_FIELD_NUMBER: _ClassVar[int]
    SCOPES_FIELD_NUMBER: _ClassVar[int]
    USERINFO_URL_FIELD_NUMBER: _ClassVar[int]
    provider: str
    client_id: str
    client_secret: str
    authorization_url: str
    token_url: str
    scopes: _containers.RepeatedScalarFieldContainer[str]
    userinfo_url: str
    def __init__(self, provider: _Optional[str] = ..., client_id: _Optional[str] = ..., client_secret: _Optional[str] = ..., authorization_url: _Optional[str] = ..., token_url: _Optional[str] = ..., scopes: _Optional[_Iterable[str]] = ..., userinfo_url: _Optional[str] = ...) -> None: ...
