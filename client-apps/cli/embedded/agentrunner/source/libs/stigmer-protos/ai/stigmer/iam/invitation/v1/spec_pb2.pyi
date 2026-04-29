import datetime

from ai.stigmer.iam.v1 import enum_pb2 as _enum_pb2
from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf import timestamp_pb2 as _timestamp_pb2
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class InvitationSpec(_message.Message):
    __slots__ = ("role", "max_redemptions", "expires_at", "label")
    ROLE_FIELD_NUMBER: _ClassVar[int]
    MAX_REDEMPTIONS_FIELD_NUMBER: _ClassVar[int]
    EXPIRES_AT_FIELD_NUMBER: _ClassVar[int]
    LABEL_FIELD_NUMBER: _ClassVar[int]
    role: _enum_pb2.IamRole
    max_redemptions: int
    expires_at: _timestamp_pb2.Timestamp
    label: str
    def __init__(self, role: _Optional[_Union[_enum_pb2.IamRole, str]] = ..., max_redemptions: _Optional[int] = ..., expires_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., label: _Optional[str] = ...) -> None: ...
