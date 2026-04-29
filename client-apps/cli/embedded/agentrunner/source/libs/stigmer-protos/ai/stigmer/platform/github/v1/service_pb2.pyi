from ai.stigmer.commons.rpc import method_options_pb2 as _method_options_pb2
from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from typing import ClassVar as _ClassVar, Optional as _Optional

DESCRIPTOR: _descriptor.FileDescriptor

class GetOAuthAuthorizeUrlRequest(_message.Message):
    __slots__ = ("redirect_uri",)
    REDIRECT_URI_FIELD_NUMBER: _ClassVar[int]
    redirect_uri: str
    def __init__(self, redirect_uri: _Optional[str] = ...) -> None: ...

class GetOAuthAuthorizeUrlResponse(_message.Message):
    __slots__ = ("authorize_url", "state")
    AUTHORIZE_URL_FIELD_NUMBER: _ClassVar[int]
    STATE_FIELD_NUMBER: _ClassVar[int]
    authorize_url: str
    state: str
    def __init__(self, authorize_url: _Optional[str] = ..., state: _Optional[str] = ...) -> None: ...

class ExchangeOAuthCodeRequest(_message.Message):
    __slots__ = ("code", "state", "redirect_uri")
    CODE_FIELD_NUMBER: _ClassVar[int]
    STATE_FIELD_NUMBER: _ClassVar[int]
    REDIRECT_URI_FIELD_NUMBER: _ClassVar[int]
    code: str
    state: str
    redirect_uri: str
    def __init__(self, code: _Optional[str] = ..., state: _Optional[str] = ..., redirect_uri: _Optional[str] = ...) -> None: ...

class ExchangeOAuthCodeResponse(_message.Message):
    __slots__ = ("access_token", "token_type", "scope")
    ACCESS_TOKEN_FIELD_NUMBER: _ClassVar[int]
    TOKEN_TYPE_FIELD_NUMBER: _ClassVar[int]
    SCOPE_FIELD_NUMBER: _ClassVar[int]
    access_token: str
    token_type: str
    scope: str
    def __init__(self, access_token: _Optional[str] = ..., token_type: _Optional[str] = ..., scope: _Optional[str] = ...) -> None: ...
