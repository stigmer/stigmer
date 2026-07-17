from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class ChannelAppSpec(_message.Message):
    __slots__ = ("slack", "whatsapp")
    SLACK_FIELD_NUMBER: _ClassVar[int]
    WHATSAPP_FIELD_NUMBER: _ClassVar[int]
    slack: SlackChannelAppConfig
    whatsapp: WhatsAppChannelAppConfig
    def __init__(self, slack: _Optional[_Union[SlackChannelAppConfig, _Mapping]] = ..., whatsapp: _Optional[_Union[WhatsAppChannelAppConfig, _Mapping]] = ...) -> None: ...

class SlackChannelAppConfig(_message.Message):
    __slots__ = ("client_id", "client_secret", "signing_secret")
    CLIENT_ID_FIELD_NUMBER: _ClassVar[int]
    CLIENT_SECRET_FIELD_NUMBER: _ClassVar[int]
    SIGNING_SECRET_FIELD_NUMBER: _ClassVar[int]
    client_id: str
    client_secret: str
    signing_secret: str
    def __init__(self, client_id: _Optional[str] = ..., client_secret: _Optional[str] = ..., signing_secret: _Optional[str] = ...) -> None: ...

class WhatsAppChannelAppConfig(_message.Message):
    __slots__ = ("app_id", "app_secret", "access_token", "verify_token")
    APP_ID_FIELD_NUMBER: _ClassVar[int]
    APP_SECRET_FIELD_NUMBER: _ClassVar[int]
    ACCESS_TOKEN_FIELD_NUMBER: _ClassVar[int]
    VERIFY_TOKEN_FIELD_NUMBER: _ClassVar[int]
    app_id: str
    app_secret: str
    access_token: str
    verify_token: str
    def __init__(self, app_id: _Optional[str] = ..., app_secret: _Optional[str] = ..., access_token: _Optional[str] = ..., verify_token: _Optional[str] = ...) -> None: ...
