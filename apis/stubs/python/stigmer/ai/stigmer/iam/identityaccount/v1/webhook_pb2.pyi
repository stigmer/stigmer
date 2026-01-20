from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from typing import ClassVar as _ClassVar, Optional as _Optional

DESCRIPTOR: _descriptor.FileDescriptor

class Auth0Webhook(_message.Message):
    __slots__ = ("date", "type", "description", "client_id", "client_name", "ip", "user_agent", "user_id")
    DATE_FIELD_NUMBER: _ClassVar[int]
    TYPE_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    CLIENT_ID_FIELD_NUMBER: _ClassVar[int]
    CLIENT_NAME_FIELD_NUMBER: _ClassVar[int]
    IP_FIELD_NUMBER: _ClassVar[int]
    USER_AGENT_FIELD_NUMBER: _ClassVar[int]
    USER_ID_FIELD_NUMBER: _ClassVar[int]
    date: str
    type: str
    description: str
    client_id: str
    client_name: str
    ip: str
    user_agent: str
    user_id: str
    def __init__(self, date: _Optional[str] = ..., type: _Optional[str] = ..., description: _Optional[str] = ..., client_id: _Optional[str] = ..., client_name: _Optional[str] = ..., ip: _Optional[str] = ..., user_agent: _Optional[str] = ..., user_id: _Optional[str] = ...) -> None: ...
