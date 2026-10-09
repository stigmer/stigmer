from ai.stigmer.commons.rpc import method_options_pb2 as _method_options_pb2
from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from typing import ClassVar as _ClassVar, Optional as _Optional

DESCRIPTOR: _descriptor.FileDescriptor

class ConnectLinkTokenInput(_message.Message):
    __slots__ = ("token",)
    TOKEN_FIELD_NUMBER: _ClassVar[int]
    token: str
    def __init__(self, token: _Optional[str] = ...) -> None: ...

class ConnectLinkInfo(_message.Message):
    __slots__ = ("provider_name", "address", "organization_name")
    PROVIDER_NAME_FIELD_NUMBER: _ClassVar[int]
    ADDRESS_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_NAME_FIELD_NUMBER: _ClassVar[int]
    provider_name: str
    address: str
    organization_name: str
    def __init__(self, provider_name: _Optional[str] = ..., address: _Optional[str] = ..., organization_name: _Optional[str] = ...) -> None: ...

class StartConnectLinkOutput(_message.Message):
    __slots__ = ("authorization_url", "state")
    AUTHORIZATION_URL_FIELD_NUMBER: _ClassVar[int]
    STATE_FIELD_NUMBER: _ClassVar[int]
    authorization_url: str
    state: str
    def __init__(self, authorization_url: _Optional[str] = ..., state: _Optional[str] = ...) -> None: ...

class CompleteConnectLinkInput(_message.Message):
    __slots__ = ("token", "state", "code", "error")
    TOKEN_FIELD_NUMBER: _ClassVar[int]
    STATE_FIELD_NUMBER: _ClassVar[int]
    CODE_FIELD_NUMBER: _ClassVar[int]
    ERROR_FIELD_NUMBER: _ClassVar[int]
    token: str
    state: str
    code: str
    error: str
    def __init__(self, token: _Optional[str] = ..., state: _Optional[str] = ..., code: _Optional[str] = ..., error: _Optional[str] = ...) -> None: ...

class CompleteConnectLinkOutput(_message.Message):
    __slots__ = ("return_url",)
    RETURN_URL_FIELD_NUMBER: _ClassVar[int]
    return_url: str
    def __init__(self, return_url: _Optional[str] = ...) -> None: ...
