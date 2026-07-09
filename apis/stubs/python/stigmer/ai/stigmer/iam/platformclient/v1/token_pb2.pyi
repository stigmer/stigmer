from ai.stigmer.commons.rpc import method_options_pb2 as _method_options_pb2
from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from typing import ClassVar as _ClassVar, Optional as _Optional

DESCRIPTOR: _descriptor.FileDescriptor

class MintUserTokenRequest(_message.Message):
    __slots__ = ("client_id", "client_secret", "user_id", "user_email", "user_name", "org_id")
    CLIENT_ID_FIELD_NUMBER: _ClassVar[int]
    CLIENT_SECRET_FIELD_NUMBER: _ClassVar[int]
    USER_ID_FIELD_NUMBER: _ClassVar[int]
    USER_EMAIL_FIELD_NUMBER: _ClassVar[int]
    USER_NAME_FIELD_NUMBER: _ClassVar[int]
    ORG_ID_FIELD_NUMBER: _ClassVar[int]
    client_id: str
    client_secret: str
    user_id: str
    user_email: str
    user_name: str
    org_id: str
    def __init__(self, client_id: _Optional[str] = ..., client_secret: _Optional[str] = ..., user_id: _Optional[str] = ..., user_email: _Optional[str] = ..., user_name: _Optional[str] = ..., org_id: _Optional[str] = ...) -> None: ...

class MintUserTokenResponse(_message.Message):
    __slots__ = ("access_token", "token_type", "expires_in")
    ACCESS_TOKEN_FIELD_NUMBER: _ClassVar[int]
    TOKEN_TYPE_FIELD_NUMBER: _ClassVar[int]
    EXPIRES_IN_FIELD_NUMBER: _ClassVar[int]
    access_token: str
    token_type: str
    expires_in: int
    def __init__(self, access_token: _Optional[str] = ..., token_type: _Optional[str] = ..., expires_in: _Optional[int] = ...) -> None: ...

class MintGuestTokenRequest(_message.Message):
    __slots__ = ("org", "slug", "guest_cookie_id")
    ORG_FIELD_NUMBER: _ClassVar[int]
    SLUG_FIELD_NUMBER: _ClassVar[int]
    GUEST_COOKIE_ID_FIELD_NUMBER: _ClassVar[int]
    org: str
    slug: str
    guest_cookie_id: str
    def __init__(self, org: _Optional[str] = ..., slug: _Optional[str] = ..., guest_cookie_id: _Optional[str] = ...) -> None: ...

class MintGuestTokenResponse(_message.Message):
    __slots__ = ("access_token", "token_type", "expires_in", "guest_cookie_id")
    ACCESS_TOKEN_FIELD_NUMBER: _ClassVar[int]
    TOKEN_TYPE_FIELD_NUMBER: _ClassVar[int]
    EXPIRES_IN_FIELD_NUMBER: _ClassVar[int]
    GUEST_COOKIE_ID_FIELD_NUMBER: _ClassVar[int]
    access_token: str
    token_type: str
    expires_in: int
    guest_cookie_id: str
    def __init__(self, access_token: _Optional[str] = ..., token_type: _Optional[str] = ..., expires_in: _Optional[int] = ..., guest_cookie_id: _Optional[str] = ...) -> None: ...
