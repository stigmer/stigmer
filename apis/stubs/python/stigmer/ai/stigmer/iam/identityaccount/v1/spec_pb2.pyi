from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from typing import ClassVar as _ClassVar, Optional as _Optional

DESCRIPTOR: _descriptor.FileDescriptor

class IdentityAccountSpec(_message.Message):
    __slots__ = ("idp_id", "email", "first_name", "last_name", "picture_url", "is_machine_account")
    IDP_ID_FIELD_NUMBER: _ClassVar[int]
    EMAIL_FIELD_NUMBER: _ClassVar[int]
    FIRST_NAME_FIELD_NUMBER: _ClassVar[int]
    LAST_NAME_FIELD_NUMBER: _ClassVar[int]
    PICTURE_URL_FIELD_NUMBER: _ClassVar[int]
    IS_MACHINE_ACCOUNT_FIELD_NUMBER: _ClassVar[int]
    idp_id: str
    email: str
    first_name: str
    last_name: str
    picture_url: str
    is_machine_account: bool
    def __init__(self, idp_id: _Optional[str] = ..., email: _Optional[str] = ..., first_name: _Optional[str] = ..., last_name: _Optional[str] = ..., picture_url: _Optional[str] = ..., is_machine_account: bool = ...) -> None: ...
