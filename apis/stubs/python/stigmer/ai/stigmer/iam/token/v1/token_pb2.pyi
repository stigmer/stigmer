from ai.stigmer.commons.rpc import method_options_pb2 as _method_options_pb2
from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from typing import ClassVar as _ClassVar, Optional as _Optional

DESCRIPTOR: _descriptor.FileDescriptor

class MintUserTokenRequest(_message.Message):
    __slots__ = ("org", "user_id", "user_email", "user_name")
    ORG_FIELD_NUMBER: _ClassVar[int]
    USER_ID_FIELD_NUMBER: _ClassVar[int]
    USER_EMAIL_FIELD_NUMBER: _ClassVar[int]
    USER_NAME_FIELD_NUMBER: _ClassVar[int]
    org: str
    user_id: str
    user_email: str
    user_name: str
    def __init__(self, org: _Optional[str] = ..., user_id: _Optional[str] = ..., user_email: _Optional[str] = ..., user_name: _Optional[str] = ...) -> None: ...

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
    __slots__ = ("channel_id", "guest_cookie_id", "embed_origin", "link_token")
    CHANNEL_ID_FIELD_NUMBER: _ClassVar[int]
    GUEST_COOKIE_ID_FIELD_NUMBER: _ClassVar[int]
    EMBED_ORIGIN_FIELD_NUMBER: _ClassVar[int]
    LINK_TOKEN_FIELD_NUMBER: _ClassVar[int]
    channel_id: str
    guest_cookie_id: str
    embed_origin: str
    link_token: str
    def __init__(self, channel_id: _Optional[str] = ..., guest_cookie_id: _Optional[str] = ..., embed_origin: _Optional[str] = ..., link_token: _Optional[str] = ...) -> None: ...

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
